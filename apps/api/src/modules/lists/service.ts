import {
  nextPaletteColor,
  type CreateListRequest,
  type List,
  type Placement,
  type UpdateListRequest,
  type UpdateListResponse,
} from '@kanban/shared';

import type { Database, DbExecutor } from '../../db/client';
import type { BoardRow, ListRow } from '../../db/schema';
import { AppError } from '../../lib/app-error';
import { computePosition, LIST_SIBLINGS } from '../../lib/ordering';
import { lockWritableBoard, toList } from '../boards/service';
import { completeOpenCardsInList } from '../completion/service';

import {
  clearDoneList,
  findActiveLists,
  findLastActiveList,
  findListById,
  insertList,
  lockListById,
  updateListById,
} from './repository';

export const LIST_NOT_FOUND_MESSAGE = 'Lista não encontrada.';
export const LIST_ARCHIVED_MESSAGE = 'Esta lista está arquivada.';

function notFound(): AppError {
  return new AppError('NOT_FOUND', LIST_NOT_FOUND_MESSAGE);
}

/**
 * Carrega a lista para uma mutação: 404 → quadro bloqueado e gravável (`409 BOARD_ARCHIVED`) →
 * lista bloqueada e relida. Ordem de locks: quadro → lista.
 */
async function lockListForWrite(
  tx: DbExecutor,
  listId: string,
): Promise<{ board: BoardRow; list: ListRow }> {
  const found = await findListById(tx, listId);
  if (!found) throw notFound();
  const board = await lockWritableBoard(tx, found.boardId);
  const list = await lockListById(tx, listId);
  if (!list) throw notFound();
  return { board, list };
}

/**
 * `POST /api/boards/:boardId/lists`. Cor ausente: próxima da paleta depois da cor da última lista
 * ativa (cíclico; sem listas ativas, a primeira). Posição pelo `placement` (padrão: fim).
 */
export async function createList(
  db: Database,
  boardId: string,
  input: CreateListRequest,
  now: Date,
): Promise<List> {
  return db.transaction(async (tx) => {
    await lockWritableBoard(tx, boardId);
    const color =
      input.color ?? nextPaletteColor((await findLastActiveList(tx, boardId))?.color ?? null);
    const position = await computePosition(tx, LIST_SIBLINGS, boardId, input.placement, null);
    const row = await insertList(tx, {
      boardId,
      name: input.name,
      color,
      position,
      createdAt: now,
      updatedAt: now,
    });
    return toList(row);
  });
}

export interface UpdateListContext {
  actorId: string;
  now: Date;
}

/**
 * `PATCH /api/lists/:listId { name?, color?, isDoneList? }` (api.md §10).
 * - `isDoneList: true` em lista arquivada → `409 LIST_ARCHIVED`;
 * - marcar desmarca a lista de conclusão anterior do quadro e conclui os cards abertos não
 *   arquivados desta lista (ADR 0010), tudo na mesma transação;
 * - desmarcar não reabre ninguém.
 * Responde com todas as listas ativas do quadro e os cards concluídos por esta ação.
 */
export async function updateList(
  db: Database,
  ctx: UpdateListContext,
  listId: string,
  input: UpdateListRequest,
): Promise<UpdateListResponse> {
  return db.transaction(async (tx) => {
    const { board, list } = await lockListForWrite(tx, listId);
    if (input.isDoneList === true && list.archivedAt !== null) {
      throw new AppError('LIST_ARCHIVED', LIST_ARCHIVED_MESSAGE);
    }

    const marking = input.isDoneList === true && !list.isDoneList;
    // O índice único parcial de `is_done_list` exige desmarcar a anterior antes de marcar esta.
    if (marking) await clearDoneList(tx, board.id, list.id, ctx.now);

    const changes = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.isDoneList !== undefined ? { isDoneList: input.isDoneList } : {}),
    };
    if (Object.keys(changes).length > 0) {
      await updateListById(tx, list.id, { ...changes, updatedAt: ctx.now });
    }

    const completedCardIds = marking
      ? await completeOpenCardsInList(tx, {
          boardId: board.id,
          listId: list.id,
          actorId: ctx.actorId,
          now: ctx.now,
        })
      : [];

    const lists = await findActiveLists(tx, board.id);
    return { lists: lists.map(toList), completedCardIds };
  });
}

/** `POST /api/lists/:listId/move { placement }` (mesmo quadro). Lista arquivada → 409. */
export async function moveList(
  db: Database,
  listId: string,
  placement: Placement,
  now: Date,
): Promise<List> {
  return db.transaction(async (tx) => {
    const { board, list } = await lockListForWrite(tx, listId);
    if (list.archivedAt !== null) throw new AppError('LIST_ARCHIVED', LIST_ARCHIVED_MESSAGE);
    const position = await computePosition(tx, LIST_SIBLINGS, board.id, placement, list.id);
    return toList(await updateListById(tx, list.id, { position, updatedAt: now }));
  });
}

/**
 * `POST /api/lists/:listId/archive`. Desmarca `isDoneList` no mesmo `UPDATE` (o banco recusa lista
 * de conclusão arquivada). Cards não mudam. Idempotente.
 */
export async function archiveList(db: Database, listId: string, now: Date): Promise<List> {
  return db.transaction(async (tx) => {
    const { list } = await lockListForWrite(tx, listId);
    if (list.archivedAt !== null) return toList(list);
    return toList(
      await updateListById(tx, list.id, { archivedAt: now, isDoneList: false, updatedAt: now }),
    );
  });
}

/** `POST /api/lists/:listId/restore`: volta no **fim** do quadro (nova posição). Idempotente. */
export async function restoreList(db: Database, listId: string, now: Date): Promise<List> {
  return db.transaction(async (tx) => {
    const { board, list } = await lockListForWrite(tx, listId);
    if (list.archivedAt === null) return toList(list);
    const position = await computePosition(tx, LIST_SIBLINGS, board.id, { type: 'end' }, list.id);
    return toList(
      await updateListById(tx, list.id, { archivedAt: null, position, updatedAt: now }),
    );
  });
}
