import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import type { DbExecutor } from '../../db/client';
import {
  boardCovers,
  boards,
  boardViewers,
  type BoardCoverRow,
  type BoardRow,
  type NewBoardRow,
} from '../../db/schema';

import { boardAccessCondition, type BoardActor } from './access';

/** Quadro com o que a listagem precisa: acesso do ator e a capa (sem a URL, que é assinada depois). */
export type BoardListRow = BoardRow & {
  /** `false` = quadro restrito sem acesso: a resposta vira `LockedBoard` (ADR 0015). */
  accessible: boolean;
  /** Capa (ADR 0016): `null` sem capa — e sempre `null` em quadro bloqueado (o join é condicionado). */
  coverObjectKey: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
};

const listColumns = {
  id: boards.id,
  name: boards.name,
  visibility: boards.visibility,
  archivedAt: boards.archivedAt,
  createdBy: boards.createdBy,
  createdAt: boards.createdAt,
  updatedAt: boards.updatedAt,
};

/**
 * Quadros ativos ou arquivados, por nome, com o acesso do ator e a capa.
 * O acesso entra no próprio join da capa: quadro bloqueado não traz nem a chave do objeto (RN26).
 */
export async function findBoards(
  db: DbExecutor,
  archived: boolean,
  actor: BoardActor,
): Promise<BoardListRow[]> {
  const access = boardAccessCondition(db, actor);
  return db
    .select({
      ...listColumns,
      accessible: sql<boolean>`(${access})`.mapWith(Boolean),
      coverObjectKey: boardCovers.objectKey,
      coverWidth: boardCovers.width,
      coverHeight: boardCovers.height,
    })
    .from(boards)
    .leftJoin(boardCovers, and(eq(boardCovers.boardId, boards.id), access))
    .where(archived ? isNotNull(boards.archivedAt) : isNull(boards.archivedAt))
    .orderBy(asc(boards.name), asc(boards.id));
}

export async function insertBoard(db: DbExecutor, values: NewBoardRow): Promise<BoardRow> {
  const [row] = await db.insert(boards).values(values).returning();
  if (!row) throw new Error('insert em boards não retornou linha');
  return row;
}

export async function findBoardById(db: DbExecutor, id: string): Promise<BoardRow | undefined> {
  const [row] = await db.select().from(boards).where(eq(boards.id, id)).limit(1);
  return row;
}

/** Quadro com a capa (`LEFT JOIN`) numa consulta só: é o que toda resposta `{ board }` precisa. */
export type BoardWithCoverRow = BoardRow & {
  coverObjectKey: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
};

export async function findBoardWithCover(
  db: DbExecutor,
  id: string,
): Promise<BoardWithCoverRow | undefined> {
  const [row] = await db
    .select({
      ...listColumns,
      coverObjectKey: boardCovers.objectKey,
      coverWidth: boardCovers.width,
      coverHeight: boardCovers.height,
    })
    .from(boards)
    .leftJoin(boardCovers, eq(boardCovers.boardId, boards.id))
    .where(eq(boards.id, id))
    .limit(1);
  return row;
}

/** Quadro com lock de linha: serializa mutações e o cálculo de posição das listas (ADR 0004). */
export async function lockBoardById(db: DbExecutor, id: string): Promise<BoardRow | undefined> {
  const [row] = await db.select().from(boards).where(eq(boards.id, id)).limit(1).for('update');
  return row;
}

export async function updateBoardById(
  db: DbExecutor,
  id: string,
  values: Partial<Pick<NewBoardRow, 'name' | 'visibility' | 'archivedAt' | 'updatedAt'>>,
): Promise<BoardRow> {
  const [row] = await db.update(boards).set(values).where(eq(boards.id, id)).returning();
  if (!row) throw new Error('update em boards não retornou linha');
  return row;
}

export async function deleteBoardById(db: DbExecutor, id: string): Promise<boolean> {
  const rows = await db.delete(boards).where(eq(boards.id, id)).returning({ id: boards.id });
  return rows.length > 0;
}

/**
 * Quadros com lock compartilhado (`FOR SHARE`), em ordem de id. Usado pelas mutações de cards:
 * impede arquivar/excluir o quadro no meio da ação (esses pegam `FOR UPDATE`) sem serializar os
 * cards do quadro entre si (a serialização de posição vem do lock das listas, ADR 0004).
 */
export async function lockBoardsShared(db: DbExecutor, ids: string[]): Promise<BoardRow[]> {
  const unique = [...new Set(ids)].sort();
  const rows: BoardRow[] = [];
  for (const id of unique) {
    const [row] = await db.select().from(boards).where(eq(boards.id, id)).limit(1).for('share');
    if (row) rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Lista de acesso do quadro restrito (Fatia 11, ADR 0015)
// ---------------------------------------------------------------------------

/** Lista de acesso do quadro, por ordem de inclusão (mesma ordem devolvida em `viewerIds`). */
export async function findBoardViewerIds(db: DbExecutor, boardId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: boardViewers.userId })
    .from(boardViewers)
    .where(eq(boardViewers.boardId, boardId))
    .orderBy(asc(boardViewers.createdAt), asc(boardViewers.userId));
  return rows.map((row) => row.userId);
}

/** Inclui na lista de acesso; `true` se a inclusão é nova (`ON CONFLICT DO NOTHING` na PK). */
export async function insertBoardViewer(
  db: DbExecutor,
  values: { boardId: string; userId: string; addedBy: string; now: Date },
): Promise<boolean> {
  const rows = await db
    .insert(boardViewers)
    .values({
      boardId: values.boardId,
      userId: values.userId,
      addedBy: values.addedBy,
      createdAt: values.now,
    })
    .onConflictDoNothing()
    .returning({ userId: boardViewers.userId });
  return rows.length > 0;
}

/** Remove da lista de acesso; `true` se existia. */
export async function deleteBoardViewer(
  db: DbExecutor,
  boardId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .delete(boardViewers)
    .where(and(eq(boardViewers.boardId, boardId), eq(boardViewers.userId, userId)))
    .returning({ userId: boardViewers.userId });
  return rows.length > 0;
}

/** Anonimização (RN38): tira a pessoa de todas as listas de acesso. */
export async function deleteBoardViewersOfUser(db: DbExecutor, userId: string): Promise<void> {
  await db.delete(boardViewers).where(eq(boardViewers.userId, userId));
}

/** Apaga a lista de acesso inteira (voltar o quadro para `team`). */
export async function deleteBoardViewers(db: DbExecutor, boardId: string): Promise<void> {
  await db.delete(boardViewers).where(eq(boardViewers.boardId, boardId));
}

// ---------------------------------------------------------------------------
// Capa do quadro (Fatia 11, ADR 0016)
// ---------------------------------------------------------------------------

/** Capa do quadro (0..1). */
export async function findBoardCover(
  db: DbExecutor,
  boardId: string,
): Promise<BoardCoverRow | undefined> {
  const [row] = await db
    .select()
    .from(boardCovers)
    .where(eq(boardCovers.boardId, boardId))
    .limit(1);
  return row;
}

/** Grava a capa; trocar é `INSERT ... ON CONFLICT (board_id) DO UPDATE`. */
export async function upsertBoardCover(
  db: DbExecutor,
  values: {
    boardId: string;
    objectKey: string;
    contentType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
    uploadedBy: string;
    now: Date;
  },
): Promise<void> {
  await db
    .insert(boardCovers)
    .values({
      boardId: values.boardId,
      objectKey: values.objectKey,
      contentType: values.contentType,
      sizeBytes: values.sizeBytes,
      width: values.width,
      height: values.height,
      uploadedBy: values.uploadedBy,
      createdAt: values.now,
      updatedAt: values.now,
    })
    .onConflictDoUpdate({
      target: boardCovers.boardId,
      set: {
        objectKey: values.objectKey,
        contentType: values.contentType,
        sizeBytes: values.sizeBytes,
        width: values.width,
        height: values.height,
        uploadedBy: values.uploadedBy,
        updatedAt: values.now,
      },
    });
}

/** Apaga a linha da capa; `true` se existia. */
export async function deleteBoardCover(db: DbExecutor, boardId: string): Promise<boolean> {
  const rows = await db
    .delete(boardCovers)
    .where(eq(boardCovers.boardId, boardId))
    .returning({ boardId: boardCovers.boardId });
  return rows.length > 0;
}

/** Quais das chaves informadas ainda têm linha em `board_covers` (varredura de órfãos). */
export async function findExistingCoverKeys(db: DbExecutor, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await db
    .select({ objectKey: boardCovers.objectKey })
    .from(boardCovers)
    .where(inArray(boardCovers.objectKey, keys));
  return new Set(rows.map((row) => row.objectKey));
}
