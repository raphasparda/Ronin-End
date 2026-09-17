import { asc, eq, isNotNull, isNull } from 'drizzle-orm';

import type { DbExecutor } from '../../db/client';
import { boards, type BoardRow, type NewBoardRow } from '../../db/schema';

/** Quadros ativos ou arquivados, por nome. */
export async function findBoards(db: DbExecutor, archived: boolean): Promise<BoardRow[]> {
  return db
    .select()
    .from(boards)
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

/** Quadro com lock de linha: serializa mutações e o cálculo de posição das listas (ADR 0004). */
export async function lockBoardById(db: DbExecutor, id: string): Promise<BoardRow | undefined> {
  const [row] = await db.select().from(boards).where(eq(boards.id, id)).limit(1).for('update');
  return row;
}

export async function updateBoardById(
  db: DbExecutor,
  id: string,
  values: Partial<Pick<NewBoardRow, 'name' | 'archivedAt' | 'updatedAt'>>,
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
