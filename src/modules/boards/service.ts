import {
  comparePosition,
  DEFAULT_BOARD_LISTS,
  type Board,
  type BoardArchivedResponse,
  type BoardDetail,
  type BoardListItem,
  type BoardPayload,
  type BoardVisibility,
  type CreateBoardResponse,
  type List,
  type LockedBoard,
} from '@raphasparda/ronin-shared';
import { generateNKeysBetween } from 'fractional-indexing';

import type { Database, DbExecutor } from '../../db/client';
import type { BoardRow, ListRow } from '../../db/schema';
import { AppError } from '../../lib/app-error';
import { toIso, toIsoOrNull } from '../../lib/dates';
import type { R2Client } from '../../lib/r2';
import { FORBIDDEN_MESSAGE } from '../../plugins/session';
import { loadArchivedCards, loadBoardCards } from '../cards/service';
import { loadBoardLabels } from '../labels/service';
import { findActiveLists, findArchivedLists, insertLists } from '../lists/repository';
import { findUserById } from '../users/repository';
import { USER_NOT_FOUND_MESSAGE } from '../users/service';
import { lockUserShared } from '../users/repository';

import { assertBoardAccess, type BoardActor } from './access';
import { deleteCoverObject, toBoardCover, type CoverReadContext } from './cover';
import {
  deleteBoardById,
  deleteBoardViewer,
  deleteBoardViewers,
  findBoardById,
  findBoardCover,
  findBoards,
  findBoardViewerIds,
  findBoardWithCover,
  insertBoard,
  insertBoardViewer,
  lockBoardById,
  updateBoardById,
  type BoardListRow,
  type BoardWithCoverRow,
} from './repository';

export const BOARD_NOT_FOUND_MESSAGE = 'Quadro não encontrado.';
export const BOARD_ARCHIVED_MESSAGE = 'Este quadro está arquivado (somente leitura).';
export const CONFIRMATION_MISMATCH_MESSAGE = 'O nome digitado não confere com o nome do quadro.';
export const BOARD_NOT_RESTRICTED_MESSAGE =
  'Este quadro é visível para a equipe. Restrinja o quadro antes de mexer na lista de acesso.';
export const USER_NOT_ACTIVE_VIEWER_MESSAGE =
  'Esta pessoa está desativada e não pode receber acesso ao quadro.';

/** Quem executa a ação, quando, e o bucket das capas (ADR 0016). */
export interface BoardActionContext {
  actor: BoardActor;
  now: Date;
  coverStorage: R2Client | null;
}

/** Quadro que a pessoa pode abrir, com visibilidade e capa assinada (ADR 0015/0016). */
export function toBoard(
  row: BoardRow,
  cover: { objectKey: string | null; width: number | null; height: number | null },
  covers: CoverReadContext,
): Board {
  return {
    locked: false,
    id: row.id,
    name: row.name,
    visibility: row.visibility,
    cover: toBoardCover(cover, covers),
    archivedAt: toIsoOrNull(row.archivedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/** Quadro restrito para quem não tem acesso: só id e nome (ADR 0015). */
function toLockedBoard(row: Pick<BoardRow, 'id' | 'name'>): LockedBoard {
  return { id: row.id, name: row.name, locked: true };
}

const NO_COVER = { objectKey: null, width: null, height: null };

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

/** Quadro `team` não tem lista de acesso para mexer (api.md §9). */
function boardNotRestricted(): AppError {
  return new AppError('BOARD_NOT_RESTRICTED', BOARD_NOT_RESTRICTED_MESSAGE);
}

/** `{ board }` a partir da linha já lida (quadro + capa), com a lista de acesso. */
async function toBoardDetail(
  db: DbExecutor,
  row: BoardWithCoverRow,
  covers: CoverReadContext,
): Promise<BoardDetail> {
  return {
    ...toBoard(
      row,
      { objectKey: row.coverObjectKey, width: row.coverWidth, height: row.coverHeight },
      covers,
    ),
    viewerIds: row.visibility === 'restricted' ? await findBoardViewerIds(db, row.id) : [],
  };
}

/** Quadro aberto com a lista de acesso e a capa assinada (`{ board }` de toda rota de quadro). */
export async function loadBoardDetail(
  db: DbExecutor,
  boardId: string,
  covers: CoverReadContext,
): Promise<BoardDetail> {
  const row = await findBoardWithCover(db, boardId);
  if (!row) throw notFound();
  return toBoardDetail(db, row, covers);
}

/**
 * Bloqueia o quadro (`FOR UPDATE`) na transação corrente; inexistente → 404; restrito sem acesso →
 * `403 BOARD_RESTRICTED` (ordem 404 → 403 → 409, api.md §3). A checagem roda sobre a linha já
 * bloqueada: restringir o quadro em paralelo não deixa passar mutação.
 */
export async function lockBoard(
  tx: DbExecutor,
  boardId: string,
  actor: BoardActor,
): Promise<BoardRow> {
  const board = await lockBoardById(tx, boardId);
  if (!board) throw notFound();
  await assertBoardAccess(tx, board, actor);
  return board;
}

/** Quadro arquivado é somente leitura (I10): mutação de conteúdo → `409 BOARD_ARCHIVED`. */
export function assertBoardWritable(board: BoardRow | undefined): BoardRow {
  if (!board) throw notFound();
  if (board.archivedAt !== null) throw new AppError('BOARD_ARCHIVED', BOARD_ARCHIVED_MESSAGE);
  return board;
}

/**
 * `assertBoardWritable` (I10) com lock: bloqueia o quadro, checa o acesso e recusa mutação de
 * conteúdo em quadro arquivado. Toda mutação de listas passa por aqui, o que também serializa o
 * cálculo de posição das listas do quadro (ADR 0004).
 */
export async function lockWritableBoard(
  tx: DbExecutor,
  boardId: string,
  actor: BoardActor,
): Promise<BoardRow> {
  return assertBoardWritable(await lockBoard(tx, boardId, actor));
}

/** Item da lista de quadros: o quadro inteiro ou o cadeado (ADR 0015). */
function toBoardListItem(row: BoardListRow, covers: CoverReadContext): BoardListItem {
  if (!row.accessible) return toLockedBoard(row);
  return toBoard(
    row,
    { objectKey: row.coverObjectKey, width: row.coverWidth, height: row.coverHeight },
    covers,
  );
}

/** `GET /api/boards?archived=`: quadro restrito sem acesso entra como `LockedBoard`. */
export async function listBoards(
  db: DbExecutor,
  archived: boolean,
  actor: BoardActor,
  covers: CoverReadContext,
): Promise<BoardListItem[]> {
  return (await findBoards(db, archived, actor)).map((row) => toBoardListItem(row, covers));
}

/**
 * `POST /api/boards`: quadro e listas padrão "A fazer" (`blue`), "Fazendo" (`orange`) e
 * "Concluído" (`green`, lista de conclusão), na mesma transação. Nasce visível para a equipe.
 */
export async function createBoard(
  db: Database,
  ctx: BoardActionContext,
  name: string,
): Promise<CreateBoardResponse> {
  return db.transaction(async (tx) => {
    const board = await insertBoard(tx, {
      name,
      createdBy: ctx.actor.id,
      createdAt: ctx.now,
      updatedAt: ctx.now,
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
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })),
    );
    const lists = [...rows].sort((a, b) => comparePosition(a.position, b.position)).map(toList);
    return { board: { ...toBoard(board, NO_COVER, coverContext(ctx)), viewerIds: [] }, lists };
  });
}

function coverContext(ctx: BoardActionContext): CoverReadContext {
  return { storage: ctx.coverStorage, now: ctx.now };
}

/**
 * `GET /api/boards/:boardId`: payload do quadro (arquivado também). Leitura num snapshot único
 * (`REPEATABLE READ`, somente leitura) para listas e cards não divergirem entre as consultas.
 * Quadro restrito sem acesso → `403 BOARD_RESTRICTED`.
 */
export async function getBoardPayload(
  db: Database,
  boardId: string,
  actor: BoardActor,
  covers: CoverReadContext,
): Promise<BoardPayload> {
  return db.transaction(
    async (tx) => {
      // Quadro e capa numa consulta só: o payload fica em 6 consultas (api.md §18.9 item 72).
      const row = await findBoardWithCover(tx, boardId);
      if (!row) throw notFound();
      await assertBoardAccess(tx, row, actor);
      const board = await toBoardDetail(tx, row, covers);
      const lists = await findActiveLists(tx, boardId);
      const cards = await loadBoardCards(tx, boardId);
      const labels = await loadBoardLabels(tx, boardId);
      return { board, lists: lists.map(toList), cards, labels };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

/** `PATCH /api/boards/:boardId { name }`. Arquivado → 409. */
export async function renameBoard(
  db: Database,
  ctx: BoardActionContext,
  boardId: string,
  name: string,
): Promise<BoardDetail> {
  return db.transaction(async (tx) => {
    const board = await lockWritableBoard(tx, boardId, ctx.actor);
    if (board.name !== name) await updateBoardById(tx, boardId, { name, updatedAt: ctx.now });
    return loadBoardDetail(tx, boardId, coverContext(ctx));
  });
}

/** `POST /api/boards/:boardId/archive`. Idempotente. */
export async function archiveBoard(
  db: Database,
  ctx: BoardActionContext,
  boardId: string,
): Promise<BoardDetail> {
  return db.transaction(async (tx) => {
    const board = await lockBoard(tx, boardId, ctx.actor);
    if (board.archivedAt === null) {
      await updateBoardById(tx, boardId, { archivedAt: ctx.now, updatedAt: ctx.now });
    }
    return loadBoardDetail(tx, boardId, coverContext(ctx));
  });
}

/** `POST /api/boards/:boardId/restore`. Idempotente. */
export async function restoreBoard(
  db: Database,
  ctx: BoardActionContext,
  boardId: string,
): Promise<BoardDetail> {
  return db.transaction(async (tx) => {
    const board = await lockBoard(tx, boardId, ctx.actor);
    if (board.archivedAt !== null) {
      await updateBoardById(tx, boardId, { archivedAt: null, updatedAt: ctx.now });
    }
    return loadBoardDetail(tx, boardId, coverContext(ctx));
  });
}

/**
 * `DELETE /api/boards/:boardId` (Admin). Ordem de api.md §3: 404 → `403 BOARD_RESTRICTED` → 403
 * (papel) → confirmação (`400 CONFIRMATION_MISMATCH`, comparação exata após o `trim` do schema).
 * Exclusão em cascata; o objeto da capa sai do R2 depois do commit.
 */
export async function deleteBoard(
  db: Database,
  actor: BoardActor,
  boardId: string,
  confirmName: string,
  storage: R2Client | null = null,
  log?: { warn: (obj: object, msg: string) => void },
): Promise<void> {
  const objectKey = await db.transaction(async (tx) => {
    const board = await lockBoard(tx, boardId, actor);
    if (actor.role !== 'admin') throw new AppError('FORBIDDEN', FORBIDDEN_MESSAGE);
    if (board.name !== confirmName) {
      throw new AppError('CONFIRMATION_MISMATCH', CONFIRMATION_MISMATCH_MESSAGE);
    }
    const cover = await findBoardCover(tx, boardId);
    await deleteBoardById(tx, boardId);
    return cover?.objectKey ?? null;
  });
  // Cascata no banco já levou as linhas; o objeto sai depois do commit (falha vira órfão).
  if (objectKey) await deleteCoverObject(storage, objectKey, log);
}

/** `GET /api/boards/:boardId/archived`. Quadro restrito sem acesso → `403 BOARD_RESTRICTED`. */
export async function getBoardArchived(
  db: Database,
  boardId: string,
  actor: BoardActor,
): Promise<BoardArchivedResponse> {
  return db.transaction(
    async (tx) => {
      const board = await findBoardById(tx, boardId);
      if (!board) throw notFound();
      await assertBoardAccess(tx, board, actor);
      const lists = await findArchivedLists(tx, boardId);
      const cards = await loadArchivedCards(tx, boardId);
      return { lists: lists.map(toList), cards };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

// ---------------------------------------------------------------------------
// Visibilidade e lista de acesso (Fatia 11, ADR 0015)
// ---------------------------------------------------------------------------

/**
 * `PUT /api/boards/:boardId/visibility { visibility }` (api.md §9). Idempotente.
 * - `restricted`: o **ator** e o **criador do quadro** entram na lista de acesso na mesma transação
 *   (RN30); criador anonimizado fica de fora (RN38);
 * - `team`: a lista é apagada (`viewerIds` volta a `[]`).
 * Ordem: 400 → 404 → `403 BOARD_RESTRICTED` → `409 BOARD_ARCHIVED`.
 */
export async function setBoardVisibility(
  db: Database,
  ctx: BoardActionContext,
  boardId: string,
  visibility: BoardVisibility,
): Promise<BoardDetail> {
  return db.transaction(async (tx) => {
    const board = await lockWritableBoard(tx, boardId, ctx.actor);
    if (board.visibility === visibility) return loadBoardDetail(tx, boardId, coverContext(ctx));

    await updateBoardById(tx, boardId, { visibility, updatedAt: ctx.now });
    if (visibility === 'restricted') {
      // RN30: a lista inicial é o ator + o criador do quadro — as pessoas que já estavam ali e têm
      // contexto. Não existe "responsável de quadro"; o resto entra pela rota de viewers.
      const creator = await findUserById(tx, board.createdBy);
      const initial = [
        ctx.actor.id,
        ...(creator && creator.anonymizedAt === null ? [creator.id] : []),
      ];
      for (const userId of initial) {
        await insertBoardViewer(tx, { boardId, userId, addedBy: ctx.actor.id, now: ctx.now });
      }
    } else {
      await deleteBoardViewers(tx, boardId);
    }
    return loadBoardDetail(tx, boardId, coverContext(ctx));
  });
}

/**
 * `PUT /api/boards/:boardId/viewers/:userId` (api.md §9). Idempotente.
 * Ordem: 404 (quadro, usuário) → `403 BOARD_RESTRICTED` → `409 BOARD_ARCHIVED` →
 * `409 BOARD_NOT_RESTRICTED` → `409 USER_NOT_ACTIVE` (RN37).
 */
export async function addBoardViewer(
  db: Database,
  ctx: BoardActionContext,
  boardId: string,
  userId: string,
): Promise<string[]> {
  return db.transaction(async (tx) => {
    const board = await lockBoard(tx, boardId, ctx.actor);
    if (!(await findUserById(tx, userId))) throw new AppError('NOT_FOUND', USER_NOT_FOUND_MESSAGE);
    assertBoardWritable(board);
    if (board.visibility !== 'restricted') throw boardNotRestricted();

    const current = await findBoardViewerIds(tx, boardId);
    if (current.includes(userId)) return current;

    // `FOR SHARE` no usuário: desativar em paralelo espera ou é visto (mesma regra da atribuição).
    const user = await lockUserShared(tx, userId);
    if (!user) throw new AppError('NOT_FOUND', USER_NOT_FOUND_MESSAGE);
    if (user.status !== 'active' || user.anonymizedAt !== null) {
      throw new AppError('USER_NOT_ACTIVE', USER_NOT_ACTIVE_VIEWER_MESSAGE);
    }

    await insertBoardViewer(tx, { boardId, userId, addedBy: ctx.actor.id, now: ctx.now });
    return findBoardViewerIds(tx, boardId);
  });
}

/**
 * `DELETE /api/boards/:boardId/viewers/:userId` (api.md §9): remove da lista de acesso, inclusive a
 * si mesmo (quem se remove perde o acesso ao quadro na hora; a UI confirma antes). Idempotente; não
 * há regra de "último viewer" (Admin sempre alcança o quadro).
 */
export async function removeBoardViewer(
  db: Database,
  ctx: BoardActionContext,
  boardId: string,
  userId: string,
): Promise<string[]> {
  return db.transaction(async (tx) => {
    const board = await lockBoard(tx, boardId, ctx.actor);
    if (!(await findUserById(tx, userId))) throw new AppError('NOT_FOUND', USER_NOT_FOUND_MESSAGE);
    assertBoardWritable(board);
    if (board.visibility !== 'restricted') throw boardNotRestricted();

    await deleteBoardViewer(tx, boardId, userId);
    return findBoardViewerIds(tx, boardId);
  });
}
