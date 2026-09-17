import type {
  Checklist,
  ChecklistItem,
  Placement,
  UpdateChecklistItemRequest,
} from '@raphasparda/ronin-shared';

import type { Database, DbExecutor } from '../../db/client';
import type { CardRow, ChecklistItemRow, ChecklistRow } from '../../db/schema';
import { AppError } from '../../lib/app-error';
import { toIso, toIsoOrNull } from '../../lib/dates';
import { CHECKLIST_ITEM_SIBLINGS, computePosition } from '../../lib/ordering';
import type { CardActor } from '../cards/access';
import { assertBoardWritable, cardTransaction, lockCard } from '../cards/service';

import {
  deleteChecklistById,
  deleteChecklistItemById,
  findChecklistById,
  findChecklistItemById,
  findChecklistItems,
  insertChecklist,
  insertChecklistItem,
  lockChecklistById,
  lockChecklistItemById,
  updateChecklistById,
  updateChecklistItemById,
} from './repository';

export const CHECKLIST_NOT_FOUND_MESSAGE = 'Checklist não encontrado.';
export const CHECKLIST_ITEM_NOT_FOUND_MESSAGE = 'Item não encontrado.';

/** Quem executa a ação e quando (o papel entra na checagem de acesso ao card, ADR 0015). */
export interface ChecklistActionContext {
  actor: CardActor;
  now: Date;
}

export function toChecklistItem(row: ChecklistItemRow): ChecklistItem {
  return {
    id: row.id,
    checklistId: row.checklistId,
    text: row.text,
    position: row.position,
    isChecked: row.isChecked,
    checkedBy: row.checkedBy,
    checkedAt: toIsoOrNull(row.checkedAt),
  };
}

async function toChecklist(db: DbExecutor, row: ChecklistRow): Promise<Checklist> {
  const items = await findChecklistItems(db, row.id);
  return {
    id: row.id,
    cardId: row.cardId,
    title: row.title,
    createdAt: toIso(row.createdAt),
    items: items.map(toChecklistItem),
  };
}

function checklistNotFound(): AppError {
  return new AppError('NOT_FOUND', CHECKLIST_NOT_FOUND_MESSAGE);
}

function itemNotFound(): AppError {
  return new AppError('NOT_FOUND', CHECKLIST_ITEM_NOT_FOUND_MESSAGE);
}

/**
 * Card do checklist bloqueado e com quadro gravável. Locks: quadro `FOR SHARE` → card
 * `FOR UPDATE` (mesma ordem das mutações de card; excluir o card espera a ação). Card arquivado é
 * aceito, como no `PATCH` do card; quadro arquivado → `409 BOARD_ARCHIVED`.
 */
async function lockWritableCard(
  tx: DbExecutor,
  cardId: string,
  actor: CardActor,
): Promise<CardRow> {
  const { card, boards } = await lockCard(tx, cardId, { actor, lockLists: false });
  assertBoardWritable(boards.get(card.boardId));
  return card;
}

/** Checklist para mutação: 404 → card bloqueado/gravável (409) → checklist bloqueado. */
async function lockChecklistForWrite(
  tx: DbExecutor,
  checklistId: string,
  actor: CardActor,
): Promise<ChecklistRow> {
  const found = await findChecklistById(tx, checklistId);
  if (!found) throw checklistNotFound();
  await lockWritableCard(tx, found.cardId, actor);
  const checklist = await lockChecklistById(tx, checklistId);
  if (!checklist) throw checklistNotFound();
  return checklist;
}

/** Item para mutação: 404 → card bloqueado/gravável (409) → checklist → item bloqueados. */
async function lockItemForWrite(
  tx: DbExecutor,
  itemId: string,
  actor: CardActor,
): Promise<{ checklist: ChecklistRow; item: ChecklistItemRow }> {
  const found = await findChecklistItemById(tx, itemId);
  if (!found) throw itemNotFound();
  const parent = await findChecklistById(tx, found.checklistId);
  if (!parent) throw itemNotFound();
  await lockWritableCard(tx, parent.cardId, actor);
  const checklist = await lockChecklistById(tx, parent.id);
  const item = await lockChecklistItemById(tx, itemId);
  if (!checklist || !item) throw itemNotFound();
  return { checklist, item };
}

/** `POST /api/cards/:cardId/checklists { title }`. Ordem: 404 → `409 BOARD_ARCHIVED`. */
export async function createChecklist(
  db: Database,
  ctx: ChecklistActionContext,
  cardId: string,
  title: string,
): Promise<Checklist> {
  return cardTransaction(db, async (tx) => {
    const card = await lockWritableCard(tx, cardId, ctx.actor);
    const row = await insertChecklist(tx, {
      cardId: card.id,
      title,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    return toChecklist(tx, row);
  });
}

/** `PATCH /api/checklists/:checklistId { title }`. Mesmo título: 200 sem gravar. */
export async function renameChecklist(
  db: Database,
  ctx: ChecklistActionContext,
  checklistId: string,
  title: string,
): Promise<Checklist> {
  return cardTransaction(db, async (tx) => {
    const checklist = await lockChecklistForWrite(tx, checklistId, ctx.actor);
    if (checklist.title === title) return toChecklist(tx, checklist);
    const updated = await updateChecklistById(tx, checklist.id, { title, updatedAt: ctx.now });
    return toChecklist(tx, updated);
  });
}

/** `DELETE /api/checklists/:checklistId`: itens em cascata. */
export async function deleteChecklist(
  db: Database,
  actor: CardActor,
  checklistId: string,
): Promise<void> {
  await cardTransaction(db, async (tx) => {
    const checklist = await lockChecklistForWrite(tx, checklistId, actor);
    await deleteChecklistById(tx, checklist.id);
  });
}

/** `POST /api/checklists/:checklistId/items { text }`: cria no **fim**. */
export async function createChecklistItem(
  db: Database,
  ctx: ChecklistActionContext,
  checklistId: string,
  text: string,
): Promise<ChecklistItem> {
  return cardTransaction(db, async (tx) => {
    const checklist = await lockChecklistForWrite(tx, checklistId, ctx.actor);
    const position = await computePosition(
      tx,
      CHECKLIST_ITEM_SIBLINGS,
      checklist.id,
      { type: 'end' },
      null,
    );
    const row = await insertChecklistItem(tx, {
      checklistId: checklist.id,
      text,
      position,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    return toChecklistItem(row);
  });
}

/**
 * `PATCH /api/checklist-items/:itemId { text?, isChecked? }`. Marcar grava `checkedBy`/`checkedAt`
 * (marcar item já marcado mantém quem/quando marcou); desmarcar limpa os dois. Não gera atividade
 * nem altera o status do card (marcar todos os itens não conclui o card).
 */
export async function updateChecklistItem(
  db: Database,
  ctx: ChecklistActionContext,
  itemId: string,
  input: UpdateChecklistItemRequest,
): Promise<ChecklistItem> {
  return cardTransaction(db, async (tx) => {
    const { item } = await lockItemForWrite(tx, itemId, ctx.actor);
    const changes: Parameters<typeof updateChecklistItemById>[2] = {};
    if (input.text !== undefined && input.text !== item.text) changes.text = input.text;
    if (input.isChecked !== undefined && input.isChecked !== item.isChecked) {
      Object.assign(
        changes,
        input.isChecked
          ? { isChecked: true, checkedBy: ctx.actor.id, checkedAt: ctx.now }
          : { isChecked: false, checkedBy: null, checkedAt: null },
      );
    }
    if (Object.keys(changes).length === 0) return toChecklistItem(item);
    return toChecklistItem(
      await updateChecklistItemById(tx, item.id, { ...changes, updatedAt: ctx.now }),
    );
  });
}

/**
 * `POST /api/checklist-items/:itemId/move { placement }` (mesmo checklist, ADR 0004).
 * `after` com id que não é item deste checklist (ou o próprio item) → `409 INVALID_PLACEMENT`.
 */
export async function moveChecklistItem(
  db: Database,
  ctx: ChecklistActionContext,
  itemId: string,
  placement: Placement,
): Promise<ChecklistItem> {
  return cardTransaction(db, async (tx) => {
    const { checklist, item } = await lockItemForWrite(tx, itemId, ctx.actor);
    const position = await computePosition(
      tx,
      CHECKLIST_ITEM_SIBLINGS,
      checklist.id,
      placement,
      item.id,
    );
    return toChecklistItem(
      await updateChecklistItemById(tx, item.id, { position, updatedAt: ctx.now }),
    );
  });
}

/** `DELETE /api/checklist-items/:itemId`. */
export async function deleteChecklistItem(
  db: Database,
  actor: CardActor,
  itemId: string,
): Promise<void> {
  await cardTransaction(db, async (tx) => {
    const { item } = await lockItemForWrite(tx, itemId, actor);
    await deleteChecklistItemById(tx, item.id);
  });
}
