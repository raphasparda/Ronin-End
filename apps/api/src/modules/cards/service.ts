import {
  completionChangeOnMove,
  completionChangeOnRestore,
  type Activity,
  type ArchivedCard,
  type CardDetail,
  type CardMutationResult,
  type CardSummary,
  type Checklist,
  type Comment,
  type MoveCardRequest,
  type Role,
  type UpdateCardRequest,
} from '@kanban/shared';

import type { Database, DbExecutor } from '../../db/client';
import type { BoardRow, CardRow, ListRow } from '../../db/schema';
import { AppError } from '../../lib/app-error';
import { toIso, toIsoOrNull } from '../../lib/dates';
import { CARD_SIBLINGS, computePosition } from '../../lib/ordering';
import { dueInputToUtc } from '../../lib/time';
import { FORBIDDEN_MESSAGE } from '../../plugins/session';
import { listCardActivities, recordActivity } from '../activity/service';
import { findBoardById, lockBoardsShared } from '../boards/repository';
import { applyCompletionChange } from '../completion/service';
import { findListById, lockListById, lockListsByIds } from '../lists/repository';
import { onAssigned } from '../notifications/hooks';
import { findUserById, lockUserShared } from '../users/repository';
import { USER_NOT_FOUND_MESSAGE } from '../users/service';
import { getWorkspace } from '../workspace/service';

import {
  deleteCardAssignee,
  deleteCardById,
  deleteForeignCardLabels,
  findCardAssigneeIds,
  findCardAssigneePairs,
  findCardById,
  findCardChecklists,
  findCardComments,
  findCardLabelPairs,
  findCardSummaryRows,
  insertCardAssignee,
  insertCardRow,
  lockCardById,
  updateCardById,
  type CardSummaryRow,
  type CardSummaryScope,
} from './repository';

export const CARD_NOT_FOUND_MESSAGE = 'Card não encontrado.';
export const LIST_NOT_FOUND_MESSAGE = 'Lista não encontrada.';
export const CARD_BOARD_ARCHIVED_MESSAGE = 'Este quadro está arquivado (somente leitura).';
export const CARD_LIST_ARCHIVED_MESSAGE = 'Esta lista está arquivada.';
export const LIST_IS_DONE_LIST_MESSAGE =
  'Não é possível criar card direto na lista de conclusão. Crie em outra lista e mova para cá.';
export const CARD_ARCHIVED_MOVE_MESSAGE = 'Este card está arquivado. Restaure-o antes de mover.';
export const USER_NOT_ACTIVE_ASSIGN_MESSAGE =
  'Esta pessoa está desativada e não pode ser atribuída ao card.';

/** Contexto de quem executa a ação. */
export interface CardActionContext {
  actorId: string;
  now: Date;
}

// ---------------------------------------------------------------------------
// Leitura (faces e detalhe)
// ---------------------------------------------------------------------------

function groupBy<T>(pairs: T[], key: (pair: T) => string, value: (pair: T) => string) {
  const map = new Map<string, string[]>();
  for (const pair of pairs) {
    const k = key(pair);
    const list = map.get(k);
    if (list) list.push(value(pair));
    else map.set(k, [value(pair)]);
  }
  return map;
}

function toCardSummary(
  row: CardSummaryRow,
  labelIds: Map<string, string[]>,
  assigneeIds: Map<string, string[]>,
): CardSummary {
  return {
    id: row.id,
    boardId: row.boardId,
    listId: row.listId,
    title: row.title,
    position: row.position,
    status: row.status,
    completedAt: toIsoOrNull(row.completedAt),
    dueAt: toIsoOrNull(row.dueAt),
    dueHasTime: row.dueHasTime,
    priority: row.priority,
    labelIds: labelIds.get(row.id) ?? [],
    assigneeIds: assigneeIds.get(row.id) ?? [],
    checklist: { done: row.checklistDone, total: row.checklistTotal },
    commentCount: row.commentCount,
    hasDescription: row.hasDescription,
    archivedAt: toIsoOrNull(row.archivedAt),
  };
}

async function loadSummaries(
  db: DbExecutor,
  scope: CardSummaryScope,
): Promise<{ row: CardSummaryRow; card: CardSummary }[]> {
  const rows = await findCardSummaryRows(db, scope);
  if (rows.length === 0) return [];
  // Sequencial: `db` pode ser uma transação (uma conexão só).
  const labelPairs = await findCardLabelPairs(db, scope);
  const assigneePairs = await findCardAssigneePairs(db, scope);
  const labelIds = groupBy(
    labelPairs,
    (p) => p.cardId,
    (p) => p.labelId,
  );
  const assigneeIds = groupBy(
    assigneePairs,
    (p) => p.cardId,
    (p) => p.userId,
  );
  return rows.map((row) => ({ row, card: toCardSummary(row, labelIds, assigneeIds) }));
}

/** Cards do payload do quadro: não arquivados, de listas não arquivadas, por `(listId, position)`. */
export async function loadBoardCards(db: DbExecutor, boardId: string): Promise<CardSummary[]> {
  return (await loadSummaries(db, { boardId, state: 'active' })).map(({ card }) => card);
}

/** Cards arquivados individualmente, com o contexto da lista, por `archivedAt` desc. */
export async function loadArchivedCards(db: DbExecutor, boardId: string): Promise<ArchivedCard[]> {
  return (await loadSummaries(db, { boardId, state: 'archived' })).map(({ row, card }) => ({
    ...card,
    listName: row.listName,
    listArchived: row.listArchived,
  }));
}

/** Face de um card (arquivado ou não). */
export async function loadCardSummary(db: DbExecutor, cardId: string): Promise<CardSummary> {
  const [found] = await loadSummaries(db, { cardId });
  if (!found) throw notFound();
  return found.card;
}

async function loadCardDetail(db: DbExecutor, cardId: string): Promise<CardDetail> {
  const card = await findCardById(db, cardId);
  if (!card) throw notFound();
  const summary = await loadCardSummary(db, cardId);
  const board = await findBoardById(db, card.boardId);
  const list = await findListById(db, card.listId);
  if (!board || !list) throw notFound();
  const { checklists, items } = await findCardChecklists(db, cardId);
  const commentRows = await findCardComments(db, cardId);

  const itemsByChecklist = new Map<string, Checklist['items']>();
  for (const item of items) {
    const bucket = itemsByChecklist.get(item.checklistId) ?? [];
    bucket.push({
      id: item.id,
      checklistId: item.checklistId,
      text: item.text,
      position: item.position,
      isChecked: item.isChecked,
      checkedBy: item.checkedBy,
      checkedAt: toIsoOrNull(item.checkedAt),
    });
    itemsByChecklist.set(item.checklistId, bucket);
  }

  return {
    ...summary,
    description: card.description,
    completedBy: card.completedBy,
    createdBy: card.createdBy,
    createdAt: toIso(card.createdAt),
    updatedAt: toIso(card.updatedAt),
    board: { id: board.id, name: board.name, archived: board.archivedAt !== null },
    list: {
      id: list.id,
      name: list.name,
      color: list.color,
      isDoneList: list.isDoneList,
      archived: list.archivedAt !== null,
    },
    checklists: checklists.map((checklist): Checklist => ({
      id: checklist.id,
      cardId: checklist.cardId,
      title: checklist.title,
      createdAt: toIso(checklist.createdAt),
      items: itemsByChecklist.get(checklist.id) ?? [],
    })),
    comments: commentRows.map((comment): Comment => ({
      id: comment.id,
      cardId: comment.cardId,
      authorId: comment.authorId,
      body: comment.body,
      editedAt: toIsoOrNull(comment.editedAt),
      createdAt: toIso(comment.createdAt),
    })),
  };
}

/** `GET /api/cards/:cardId`: detalhe (card arquivado também), num snapshot único. */
export async function getCardDetail(db: Database, cardId: string): Promise<CardDetail> {
  return db.transaction((tx) => loadCardDetail(tx, cardId), {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  });
}

/** `GET /api/cards/:cardId/activity`: até 500, mais recentes primeiro. */
export async function getCardActivity(db: Database, cardId: string): Promise<Activity[]> {
  return db.transaction(
    async (tx) => {
      if (!(await findCardById(tx, cardId))) throw notFound();
      return listCardActivities(tx, cardId);
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

// ---------------------------------------------------------------------------
// Locks e erros
// ---------------------------------------------------------------------------

function notFound(): AppError {
  return new AppError('NOT_FOUND', CARD_NOT_FOUND_MESSAGE);
}

function boardArchived(): AppError {
  return new AppError('BOARD_ARCHIVED', CARD_BOARD_ARCHIVED_MESSAGE);
}

function listArchived(): AppError {
  return new AppError('LIST_ARCHIVED', CARD_LIST_ARCHIVED_MESSAGE);
}

/** O card mudou de lista/quadro entre a leitura e o lock: a transação é refeita. */
class CardMovedConcurrently extends Error {
  constructor() {
    super('card movido por outra transação durante o lock');
    this.name = 'CardMovedConcurrently';
  }
}

const MAX_LOCK_ATTEMPTS = 5;

/** `db.transaction` que refaz a transação quando o card muda de lista durante o lock. */
export async function cardTransaction<T>(
  db: Database,
  fn: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(fn);
    } catch (err) {
      if (err instanceof CardMovedConcurrently && attempt < MAX_LOCK_ATTEMPTS) continue;
      throw err;
    }
  }
}

export interface LockedCard {
  card: CardRow;
  boards: Map<string, BoardRow>;
  lists: Map<string, ListRow>;
}

/**
 * Bloqueia, nesta ordem, os quadros envolvidos (`FOR SHARE`, por id), as listas envolvidas
 * (`FOR UPDATE`, por id; só se `lockLists`) e o card (`FOR UPDATE`). Mesma ordem em todas as
 * mutações de cards e compatível com as de listas (quadro → lista → card), então não há ciclo.
 * Card inexistente (ou excluído no meio) → 404. Se o card mudou de lista/quadro entre a leitura
 * e o lock, lança `CardMovedConcurrently` (a transação é refeita por `cardTransaction`).
 */
export async function lockCard(
  tx: DbExecutor,
  cardId: string,
  options: { lockLists: boolean; extraBoardIds?: string[]; extraListIds?: string[] },
): Promise<LockedCard> {
  const unlocked = await findCardById(tx, cardId);
  if (!unlocked) throw notFound();

  const boardRows = await lockBoardsShared(tx, [
    unlocked.boardId,
    ...(options.extraBoardIds ?? []),
  ]);
  const boards = new Map(boardRows.map((row) => [row.id, row]));
  if (!boards.has(unlocked.boardId)) throw notFound();

  const listRows = options.lockLists
    ? await lockListsByIds(tx, [unlocked.listId, ...(options.extraListIds ?? [])])
    : [];
  const lists = new Map(listRows.map((row) => [row.id, row]));

  const card = await lockCardById(tx, cardId);
  if (!card) throw notFound();
  if (card.listId !== unlocked.listId || card.boardId !== unlocked.boardId) {
    throw new CardMovedConcurrently();
  }
  return { card, boards, lists };
}

export function assertBoardWritable(board: BoardRow | undefined): BoardRow {
  if (!board) throw notFound();
  if (board.archivedAt !== null) throw boardArchived();
  return board;
}

// ---------------------------------------------------------------------------
// Mutações
// ---------------------------------------------------------------------------

/**
 * `POST /api/lists/:listId/cards { title }`: cria no **fim** da lista e registra `card_created`.
 * Ordem: 404 → `BOARD_ARCHIVED` → `LIST_ARCHIVED` → `LIST_IS_DONE_LIST`.
 */
export async function createCard(
  db: Database,
  ctx: CardActionContext,
  listId: string,
  title: string,
): Promise<CardSummary> {
  return db.transaction(async (tx) => {
    const found = await findListById(tx, listId);
    if (!found) throw new AppError('NOT_FOUND', LIST_NOT_FOUND_MESSAGE);
    const [board] = await lockBoardsShared(tx, [found.boardId]);
    assertBoardWritable(board);
    const list = await lockListById(tx, listId);
    if (!list) throw new AppError('NOT_FOUND', LIST_NOT_FOUND_MESSAGE);
    if (list.archivedAt !== null) throw listArchived();
    if (list.isDoneList) throw new AppError('LIST_IS_DONE_LIST', LIST_IS_DONE_LIST_MESSAGE);

    const position = await computePosition(tx, CARD_SIBLINGS, list.id, { type: 'end' }, null);
    const card = await insertCardRow(tx, {
      boardId: list.boardId,
      listId: list.id,
      title,
      position,
      createdBy: ctx.actorId,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    await recordActivity(tx, {
      cardId: card.id,
      boardId: card.boardId,
      actorId: ctx.actorId,
      now: ctx.now,
      type: 'card_created',
      data: { listId: list.id, listName: list.name },
    });
    return loadCardSummary(tx, card.id);
  });
}

/**
 * `PATCH /api/cards/:cardId { title?, description?, due?, priority? }` (api.md §11).
 * Atividades só quando o valor muda: `card_title_changed`, `card_due_changed`,
 * `card_priority_changed`. Descrição não gera atividade. Quadro arquivado → 409.
 */
export async function updateCard(
  db: Database,
  ctx: CardActionContext,
  cardId: string,
  input: UpdateCardRequest,
): Promise<CardDetail> {
  return cardTransaction(db, async (tx) => {
    const { card, boards } = await lockCard(tx, cardId, { lockLists: false });
    assertBoardWritable(boards.get(card.boardId));

    const changes: Parameters<typeof updateCardById>[2] = {};
    const base = { cardId: card.id, boardId: card.boardId, actorId: ctx.actorId, now: ctx.now };

    if (input.title !== undefined && input.title !== card.title) {
      changes.title = input.title;
      await recordActivity(tx, {
        ...base,
        type: 'card_title_changed',
        data: { from: card.title, to: input.title },
      });
    }

    if (input.description !== undefined && input.description !== card.description) {
      changes.description = input.description;
    }

    if (input.due !== undefined) {
      const next =
        input.due === null
          ? { dueAt: null, dueHasTime: false }
          : dueInputToUtc(input.due, (await getWorkspace(tx)).timezone);
      const sameInstant = (next.dueAt?.getTime() ?? null) === (card.dueAt?.getTime() ?? null);
      if (!sameInstant || next.dueHasTime !== card.dueHasTime) {
        changes.dueAt = next.dueAt;
        changes.dueHasTime = next.dueHasTime;
        await recordActivity(tx, {
          ...base,
          type: 'card_due_changed',
          data: {
            from: toIsoOrNull(card.dueAt),
            to: toIsoOrNull(next.dueAt),
            hasTime: next.dueHasTime,
          },
        });
      }
    }

    if (input.priority !== undefined && input.priority !== card.priority) {
      changes.priority = input.priority;
      await recordActivity(tx, {
        ...base,
        type: 'card_priority_changed',
        data: { from: card.priority, to: input.priority },
      });
    }

    if (Object.keys(changes).length > 0) {
      await updateCardById(tx, card.id, { ...changes, updatedAt: ctx.now });
    }
    return loadCardDetail(tx, card.id);
  });
}

/**
 * `POST /api/cards/:cardId/move { toListId, placement }` (api.md §11, ADR 0004/0010).
 * Ordem das checagens: 404 (card, lista) → `BOARD_ARCHIVED` (origem, destino) →
 * `LIST_ARCHIVED` (destino) → `CONFLICT` (card arquivado) → `INVALID_PLACEMENT`.
 * - Entre quadros: `list_id` e `board_id` no mesmo `UPDATE`; etiquetas de outro quadro removidas.
 * - `card_moved` só se a lista mudou; conclusão/reabertura pela matriz de §4.2.
 */
export async function moveCard(
  db: Database,
  ctx: CardActionContext,
  cardId: string,
  input: MoveCardRequest,
): Promise<CardMutationResult> {
  return cardTransaction(db, async (tx) => {
    if (!(await findCardById(tx, cardId))) throw notFound();
    const targetRef = await findListById(tx, input.toListId);
    if (!targetRef) throw new AppError('NOT_FOUND', LIST_NOT_FOUND_MESSAGE);

    const { card, boards, lists } = await lockCard(tx, cardId, {
      lockLists: true,
      extraBoardIds: [targetRef.boardId],
      extraListIds: [targetRef.id],
    });
    const sourceBoard = assertBoardWritable(boards.get(card.boardId));
    const targetBoard = boards.get(targetRef.boardId);
    if (!targetBoard) throw new AppError('NOT_FOUND', LIST_NOT_FOUND_MESSAGE);
    assertBoardWritable(targetBoard);
    const target = lists.get(targetRef.id);
    const source = lists.get(card.listId);
    if (!target || !source) throw new AppError('NOT_FOUND', LIST_NOT_FOUND_MESSAGE);
    if (target.archivedAt !== null) throw listArchived();
    if (card.archivedAt !== null) throw new AppError('CONFLICT', CARD_ARCHIVED_MOVE_MESSAGE);

    const position = await computePosition(tx, CARD_SIBLINGS, target.id, input.placement, card.id);

    const crossBoard = target.boardId !== card.boardId;
    const removedLabelIds = crossBoard
      ? await deleteForeignCardLabels(tx, card.id, target.boardId)
      : [];

    const moved = await updateCardById(tx, card.id, {
      listId: target.id,
      boardId: target.boardId,
      position,
      updatedAt: ctx.now,
    });

    const base = { cardId: card.id, boardId: target.boardId, actorId: ctx.actorId, now: ctx.now };
    if (source.id !== target.id) {
      await recordActivity(tx, {
        ...base,
        type: 'card_moved',
        data: {
          fromListId: source.id,
          fromListName: source.name,
          toListId: target.id,
          toListName: target.name,
          fromBoardId: sourceBoard.id,
          fromBoardName: sourceBoard.name,
          toBoardId: targetBoard.id,
          toBoardName: targetBoard.name,
        },
      });
    }

    const completionChange = completionChangeOnMove({
      status: card.status,
      fromListIsDone: source.isDoneList,
      toListIsDone: target.isDoneList,
    });
    if (completionChange !== null) {
      await applyCompletionChange(tx, {
        card: moved,
        change: completionChange,
        actorId: ctx.actorId,
        now: ctx.now,
      });
    }

    return {
      card: await loadCardSummary(tx, card.id),
      completionChange,
      removedLabelIds,
    };
  });
}

/** `POST /api/cards/:cardId/archive`: registra `card_archived`. Idempotente. Status não muda. */
export async function archiveCard(
  db: Database,
  ctx: CardActionContext,
  cardId: string,
): Promise<CardSummary> {
  return cardTransaction(db, async (tx) => {
    const { card, boards } = await lockCard(tx, cardId, { lockLists: true });
    assertBoardWritable(boards.get(card.boardId));
    if (card.archivedAt === null) {
      await updateCardById(tx, card.id, { archivedAt: ctx.now, updatedAt: ctx.now });
      await recordActivity(tx, {
        cardId: card.id,
        boardId: card.boardId,
        actorId: ctx.actorId,
        now: ctx.now,
        type: 'card_archived',
        data: {},
      });
    }
    return loadCardSummary(tx, card.id);
  });
}

/**
 * `POST /api/cards/:cardId/restore`: volta no **fim** da lista original e registra
 * `card_restored`; se a lista é de conclusão e o card está aberto, também conclui
 * (`card_completed`, RN12). Card não arquivado → 200 sem mudança (idempotente, checado antes da
 * lista). Lista arquivada → `409 LIST_ARCHIVED`.
 */
export async function restoreCard(
  db: Database,
  ctx: CardActionContext,
  cardId: string,
): Promise<CardSummary> {
  return cardTransaction(db, async (tx) => {
    const { card, boards, lists } = await lockCard(tx, cardId, { lockLists: true });
    assertBoardWritable(boards.get(card.boardId));
    if (card.archivedAt === null) return loadCardSummary(tx, card.id);
    const list = lists.get(card.listId);
    if (!list) throw notFound();
    if (list.archivedAt !== null) throw listArchived();

    const position = await computePosition(tx, CARD_SIBLINGS, list.id, { type: 'end' }, card.id);
    const restored = await updateCardById(tx, card.id, {
      archivedAt: null,
      position,
      updatedAt: ctx.now,
    });
    await recordActivity(tx, {
      cardId: card.id,
      boardId: card.boardId,
      actorId: ctx.actorId,
      now: ctx.now,
      type: 'card_restored',
      data: {},
    });
    const change = completionChangeOnRestore({ status: card.status, listIsDone: list.isDoneList });
    if (change !== null) {
      await applyCompletionChange(tx, {
        card: restored,
        change,
        actorId: ctx.actorId,
        now: ctx.now,
      });
    }
    return loadCardSummary(tx, card.id);
  });
}

/**
 * `DELETE /api/cards/:cardId` (Admin): exclusão definitiva em cascata.
 * Ordem: 404 → 403 (papel) → `409 BOARD_ARCHIVED` (quadro arquivado é somente leitura, I10).
 */
export async function deleteCard(
  db: Database,
  actor: { role: Role },
  cardId: string,
): Promise<void> {
  await cardTransaction(db, async (tx) => {
    const { card, boards } = await lockCard(tx, cardId, { lockLists: false });
    if (actor.role !== 'admin') throw new AppError('FORBIDDEN', FORBIDDEN_MESSAGE);
    assertBoardWritable(boards.get(card.boardId));
    await deleteCardById(tx, card.id);
  });
}

// ---------------------------------------------------------------------------
// Responsáveis (C4)
// ---------------------------------------------------------------------------

/**
 * `PUT /api/cards/:cardId/assignees/:userId` (api.md §11). Ordem: 404 (card, usuário) →
 * `409 BOARD_ARCHIVED` → `409 USER_NOT_ACTIVE`. Card arquivado é aceito (como no `PATCH`).
 * Atribuição nova: atividade `card_assignee_added` e gancho `onAssigned` (notificação na Fatia 7).
 * Já atribuído: 200 sem atividade (idempotente), inclusive se o usuário foi desativado depois.
 * O usuário fica com lock `FOR SHARE` até o fim, então desativar em paralelo não "fura" a regra.
 */
export async function assignCard(
  db: Database,
  ctx: CardActionContext,
  cardId: string,
  userId: string,
): Promise<string[]> {
  return cardTransaction(db, async (tx) => {
    const { card, boards } = await lockCard(tx, cardId, { lockLists: false });
    if (!(await findUserById(tx, userId))) throw new AppError('NOT_FOUND', USER_NOT_FOUND_MESSAGE);
    assertBoardWritable(boards.get(card.boardId));

    const current = await findCardAssigneeIds(tx, card.id);
    if (current.includes(userId)) return current;

    const user = await lockUserShared(tx, userId);
    if (!user) throw new AppError('NOT_FOUND', USER_NOT_FOUND_MESSAGE);
    if (user.status !== 'active' || user.anonymizedAt !== null) {
      throw new AppError('USER_NOT_ACTIVE', USER_NOT_ACTIVE_ASSIGN_MESSAGE);
    }

    const inserted = await insertCardAssignee(tx, {
      cardId: card.id,
      userId,
      assignedBy: ctx.actorId,
      now: ctx.now,
    });
    if (inserted) {
      await recordActivity(tx, {
        cardId: card.id,
        boardId: card.boardId,
        actorId: ctx.actorId,
        now: ctx.now,
        type: 'card_assignee_added',
        data: { userId },
      });
      await onAssigned(tx, { cardId: card.id, userId, actorId: ctx.actorId, now: ctx.now });
    }
    return findCardAssigneeIds(tx, card.id);
  });
}

/**
 * `DELETE /api/cards/:cardId/assignees/:userId`: remove (qualquer status de usuário). Ordem: 404
 * (card, usuário) → `409 BOARD_ARCHIVED`. Se existia: `card_assignee_removed`. Idempotente.
 */
export async function unassignCard(
  db: Database,
  ctx: CardActionContext,
  cardId: string,
  userId: string,
): Promise<string[]> {
  return cardTransaction(db, async (tx) => {
    const { card, boards } = await lockCard(tx, cardId, { lockLists: false });
    if (!(await findUserById(tx, userId))) throw new AppError('NOT_FOUND', USER_NOT_FOUND_MESSAGE);
    assertBoardWritable(boards.get(card.boardId));

    if (await deleteCardAssignee(tx, card.id, userId)) {
      await recordActivity(tx, {
        cardId: card.id,
        boardId: card.boardId,
        actorId: ctx.actorId,
        now: ctx.now,
        type: 'card_assignee_removed',
        data: { userId },
      });
    }
    return findCardAssigneeIds(tx, card.id);
  });
}
