import {
  comparePosition,
  DEFAULT_BOARD_LISTS,
  type Board,
  type BoardArchivedResponse,
  type BoardPayload,
  type CreateBoardResponse,
  type List,
  type Role,
} from '@raphasparda/ronin-shared';
import { generateNKeysBetween } from 'fractional-indexing';

import type { Database, DbExecutor } from '../../db/client';
import type { BoardRow, ListRow } from '../../db/schema';
import { AppError } from '../../lib/app-error';
import { toIso, toIsoOrNull } from '../../lib/dates';
import { FORBIDDEN_MESSAGE } from '../../plugins/session';
import type { R2Client } from '../../lib/r2';
import type { CardActor } from '../cards/access';
import { deleteCoverObject, type CoverReadContext } from '../cards/cover';
import { findBoardCoverKeys } from '../cards/repository';
import { loadArchivedCards, loadBoardCards } from '../cards/service';
import { loadBoardLabels } from '../labels/service';
import { findActiveLists, findArchivedLists, insertLists } from '../lists/repository';

import {
  deleteBoardById,
  findBoardById,
  findBoards,
  insertBoard,
  lockBoardById,
  updateBoardById,
} from './repository';

export const BOARD_NOT_FOUND_MESSAGE = 'Quadro não encontrado.';
export const BOARD_ARCHIVED_MESSAGE = 'Este quadro está arquivado (somente leitura).';
export const CONFIRMATION_MISMATCH_MESSAGE = 'O nome digitado não confere com o nome do quadro.';

export function toBoard(row: BoardRow): Board {
  return {
    id: row.id,
    name: row.name,
    archivedAt: toIsoOrNull(row.archivedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function toList(row: ListRow): List {
  return {
    id: row.id,
    boardId: row.boardId,
    name: row.name,
    position: row.position,
    isDoneList: row.isDoneList,
    color: row.color,
    archivedAt: toIsoOrNull(row.archivedAt),
  };
}

function notFound(): AppError {
  return new AppError('NOT_FOUND', BOARD_NOT_FOUND_MESSAGE);
}

async function getBoardOrThrow(db: DbExecutor, boardId: string): Promise<BoardRow> {
  const board = await findBoardById(db, boardId);
  if (!board) throw notFound();
  return board;
}

/** Bloqueia o quadro (`FOR UPDATE`) na transação corrente; inexistente → 404. */
export async function lockBoard(tx: DbExecutor, boardId: string): Promise<BoardRow> {
  const board = await lockBoardById(tx, boardId);
  if (!board) throw notFound();
  return board;
}

/**
 * `assertBoardWritable` (I10): bloqueia o quadro e recusa mutação de conteúdo em quadro arquivado
 * (`409 BOARD_ARCHIVED`). Toda mutação de listas passa por aqui, o que também serializa o cálculo
 * de posição das listas do quadro (ADR 0004).
 */
export async function lockWritableBoard(tx: DbExecutor, boardId: string): Promise<BoardRow> {
  const board = await lockBoard(tx, boardId);
  if (board.archivedAt !== null) throw new AppError('BOARD_ARCHIVED', BOARD_ARCHIVED_MESSAGE);
  return board;
}

/** `GET /api/boards?archived=`. */
export async function listBoards(db: DbExecutor, archived: boolean): Promise<Board[]> {
  return (await findBoards(db, archived)).map(toBoard);
}

/**
 * `POST /api/boards`: quadro e listas padrão "A fazer" (`blue`), "Fazendo" (`orange`) e
 * "Concluído" (`green`, lista de conclusão), na mesma transação.
 */
export async function createBoard(
  db: Database,
  actorId: string,
  name: string,
  now: Date,
): Promise<CreateBoardResponse> {
  return db.transaction(async (tx) => {
    const board = await insertBoard(tx, {
      name,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    });
    const positions = generateNKeysBetween(null, null, DEFAULT_BOARD_LISTS.length);
    const rows = await insertLists(
      tx,
      DEFAULT_BOARD_LISTS.map((list, index) => ({
        boardId: board.id,
        name: list.name,
        color: list.color,
        isDoneList: list.isDoneList,
        position: positions[index] as string,
        createdAt: now,
        updatedAt: now,
      })),
    );
    const lists = [...rows].sort((a, b) => comparePosition(a.position, b.position)).map(toList);
    return { board: toBoard(board), lists };
  });
}

/**
 * `GET /api/boards/:boardId`: payload do quadro (arquivado também). Leitura num snapshot único
 * (`REPEATABLE READ`, somente leitura) para listas e cards não divergirem entre as consultas.
 */
export async function getBoardPayload(
  db: Database,
  boardId: string,
  actor: CardActor,
  covers: CoverReadContext,
): Promise<BoardPayload> {
  return db.transaction(
    async (tx) => {
      const board = await getBoardOrThrow(tx, boardId);
      const lists = await findActiveLists(tx, boardId);
      const cards = await loadBoardCards(tx, boardId, actor, covers);
      const labels = await loadBoardLabels(tx, boardId);
      return { board: toBoard(board), lists: lists.map(toList), cards, labels };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

/** `PATCH /api/boards/:boardId { name }`. Arquivado → 409. */
export async function renameBoard(
  db: Database,
  boardId: string,
  name: string,
  now: Date,
): Promise<Board> {
  return db.transaction(async (tx) => {
    const board = await lockWritableBoard(tx, boardId);
    if (board.name === name) return toBoard(board);
    return toBoard(await updateBoardById(tx, boardId, { name, updatedAt: now }));
  });
}

/** `POST /api/boards/:boardId/archive`. Idempotente. */
export async function archiveBoard(db: Database, boardId: string, now: Date): Promise<Board> {
  return db.transaction(async (tx) => {
    const board = await lockBoard(tx, boardId);
    if (board.archivedAt !== null) return toBoard(board);
    return toBoard(await updateBoardById(tx, boardId, { archivedAt: now, updatedAt: now }));
  });
}

/** `POST /api/boards/:boardId/restore`. Idempotente. */
export async function restoreBoard(db: Database, boardId: string, now: Date): Promise<Board> {
  return db.transaction(async (tx) => {
    const board = await lockBoard(tx, boardId);
    if (board.archivedAt === null) return toBoard(board);
    return toBoard(await updateBoardById(tx, boardId, { archivedAt: null, updatedAt: now }));
  });
}

/**
 * `DELETE /api/boards/:boardId` (Admin). Ordem de api.md §3: 404 → 403 (papel) → confirmação
 * (`400 CONFIRMATION_MISMATCH`, comparação exata após o `trim` do schema). Exclusão em cascata.
 */
export async function deleteBoard(
  db: Database,
  actor: { role: Role },
  boardId: string,
  confirmName: string,
  storage: R2Client | null = null,
  log?: { warn: (obj: object, msg: string) => void },
): Promise<void> {
  const objectKeys = await db.transaction(async (tx) => {
    const board = await lockBoard(tx, boardId);
    if (actor.role !== 'admin') throw new AppError('FORBIDDEN', FORBIDDEN_MESSAGE);
    if (board.name !== confirmName) {
      throw new AppError('CONFIRMATION_MISMATCH', CONFIRMATION_MISMATCH_MESSAGE);
    }
    const keys = await findBoardCoverKeys(tx, boardId);
    await deleteBoardById(tx, boardId);
    return keys;
  });
  // Cascata no banco já levou as linhas; os objetos saem depois do commit (falha vira órfão).
  for (const objectKey of objectKeys) await deleteCoverObject(storage, objectKey, log);
}

/** `GET /api/boards/:boardId/archived`. */
export async function getBoardArchived(
  db: Database,
  boardId: string,
  actor: CardActor,
  covers: CoverReadContext,
): Promise<BoardArchivedResponse> {
  return db.transaction(
    async (tx) => {
      await getBoardOrThrow(tx, boardId);
      const lists = await findArchivedLists(tx, boardId);
      const cards = await loadArchivedCards(tx, boardId, actor, covers);
      return { lists: lists.map(toList), cards };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
