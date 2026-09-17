import type { CreateLabelRequest, Label, UpdateLabelRequest } from '@raphasparda/ronin-shared';

import type { Database, DbExecutor } from '../../db/client';
import type { BoardRow, CardRow, LabelRow } from '../../db/schema';
import { AppError } from '../../lib/app-error';
import { lockBoardsShared } from '../boards/repository';
import { deleteCardLabel, findCardLabelIds, insertCardLabel } from '../cards/repository';
import {
  assertBoardWritable,
  CARD_BOARD_ARCHIVED_MESSAGE,
  cardTransaction,
  lockCard,
} from '../cards/service';

import {
  deleteLabelById,
  findBoardLabels,
  findLabelById,
  insertLabel,
  lockLabelById,
  updateLabelById,
} from './repository';

export const LABEL_NOT_FOUND_MESSAGE = 'Etiqueta não encontrada.';
export const LABEL_BOARD_NOT_FOUND_MESSAGE = 'Quadro não encontrado.';
export const LABEL_BOARD_MISMATCH_MESSAGE = 'Esta etiqueta pertence a outro quadro.';

export function toLabel(row: LabelRow): Label {
  return { id: row.id, boardId: row.boardId, name: row.name, color: row.color };
}

/** Etiquetas do quadro para o payload (`labels` por nome). */
export async function loadBoardLabels(db: DbExecutor, boardId: string): Promise<Label[]> {
  return (await findBoardLabels(db, boardId)).map(toLabel);
}

function labelNotFound(): AppError {
  return new AppError('NOT_FOUND', LABEL_NOT_FOUND_MESSAGE);
}

/**
 * Quadro com lock `FOR SHARE` (arquivar/excluir o quadro espera a ação) e gravável.
 * Inexistente → `notFound()`; arquivado → `409 BOARD_ARCHIVED`.
 */
async function lockBoardForContent(
  tx: DbExecutor,
  boardId: string,
  notFound: () => AppError,
): Promise<BoardRow> {
  const [board] = await lockBoardsShared(tx, [boardId]);
  if (!board) throw notFound();
  if (board.archivedAt !== null) throw new AppError('BOARD_ARCHIVED', CARD_BOARD_ARCHIVED_MESSAGE);
  return board;
}

/** Etiqueta para mutação: 404 → quadro gravável (`409 BOARD_ARCHIVED`) → etiqueta bloqueada. */
async function lockLabelForWrite(tx: DbExecutor, labelId: string): Promise<LabelRow> {
  const found = await findLabelById(tx, labelId);
  if (!found) throw labelNotFound();
  await lockBoardForContent(tx, found.boardId, labelNotFound);
  const label = await lockLabelById(tx, labelId);
  if (!label) throw labelNotFound();
  return label;
}

/** `POST /api/boards/:boardId/labels { name, color }`. Ordem: 404 → `409 BOARD_ARCHIVED`. */
export async function createLabel(
  db: Database,
  boardId: string,
  input: CreateLabelRequest,
  now: Date,
): Promise<Label> {
  return db.transaction(async (tx) => {
    await lockBoardForContent(
      tx,
      boardId,
      () => new AppError('NOT_FOUND', LABEL_BOARD_NOT_FOUND_MESSAGE),
    );
    const row = await insertLabel(tx, {
      boardId,
      name: input.name,
      color: input.color,
      createdAt: now,
      updatedAt: now,
    });
    return toLabel(row);
  });
}

/**
 * `PATCH /api/labels/:labelId { name?, color? }`. Ordem: 404 → `409 BOARD_ARCHIVED`.
 * Valores iguais aos atuais: 200 sem gravar.
 */
export async function updateLabel(
  db: Database,
  labelId: string,
  input: UpdateLabelRequest,
  now: Date,
): Promise<Label> {
  return db.transaction(async (tx) => {
    const label = await lockLabelForWrite(tx, labelId);
    const changes = {
      ...(input.name !== undefined && input.name !== label.name ? { name: input.name } : {}),
      ...(input.color !== undefined && input.color !== label.color ? { color: input.color } : {}),
    };
    if (Object.keys(changes).length === 0) return toLabel(label);
    return toLabel(await updateLabelById(tx, label.id, { ...changes, updatedAt: now }));
  });
}

/** `DELETE /api/labels/:labelId`: remove de todos os cards (cascata). 404 → `409 BOARD_ARCHIVED`. */
export async function deleteLabel(db: Database, labelId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const label = await lockLabelForWrite(tx, labelId);
    await deleteLabelById(tx, label.id);
  });
}

/**
 * Card bloqueado (quadro `FOR SHARE` → card `FOR UPDATE`) e etiqueta. Ordem: 404 (card, etiqueta)
 * → `409 BOARD_ARCHIVED`. O lock do card serializa com `move` entre quadros, então a comparação de
 * quadro vale até o commit; excluir a etiqueta em paralelo espera o `INSERT` (lock da FK).
 */
async function lockCardAndLabel(
  tx: DbExecutor,
  cardId: string,
  labelId: string,
): Promise<{ card: CardRow; label: LabelRow }> {
  const { card, boards } = await lockCard(tx, cardId, { lockLists: false });
  const label = await findLabelById(tx, labelId);
  if (!label) throw labelNotFound();
  assertBoardWritable(boards.get(card.boardId));
  return { card, label };
}

/**
 * `PUT /api/cards/:cardId/labels/:labelId`. Etiqueta de outro quadro → `409 LABEL_BOARD_MISMATCH`.
 * Idempotente; card arquivado é aceito (como no `PATCH` do card). Não gera atividade.
 * @returns `labelIds` do card, por nome da etiqueta.
 */
export async function applyLabel(db: Database, cardId: string, labelId: string): Promise<string[]> {
  return cardTransaction(db, async (tx) => {
    const { card, label } = await lockCardAndLabel(tx, cardId, labelId);
    if (label.boardId !== card.boardId) {
      throw new AppError('LABEL_BOARD_MISMATCH', LABEL_BOARD_MISMATCH_MESSAGE);
    }
    await insertCardLabel(tx, card.id, label.id);
    return findCardLabelIds(tx, card.id);
  });
}

/**
 * `DELETE /api/cards/:cardId/labels/:labelId`. Idempotente: etiqueta não aplicada (inclusive de
 * outro quadro) → 200 com as etiquetas atuais.
 */
export async function removeLabel(
  db: Database,
  cardId: string,
  labelId: string,
): Promise<string[]> {
  return cardTransaction(db, async (tx) => {
    const { card, label } = await lockCardAndLabel(tx, cardId, labelId);
    await deleteCardLabel(tx, card.id, label.id);
    return findCardLabelIds(tx, card.id);
  });
}
