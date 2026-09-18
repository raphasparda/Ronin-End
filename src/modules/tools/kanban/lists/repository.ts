import { and, asc, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm';

import type { DbExecutor } from '../../../../db/client';
import { lists, type ListRow, type NewListRow } from '../../../../db/schema';

export async function insertLists(db: DbExecutor, values: NewListRow[]): Promise<ListRow[]> {
  return db.insert(lists).values(values).returning();
}

export async function findListById(db: DbExecutor, id: string): Promise<ListRow | undefined> {
  const [row] = await db.select().from(lists).where(eq(lists.id, id)).limit(1);
  return row;
}

/** Lista com lock de linha. O chamador bloqueia o quadro antes (ordem: quadro → lista). */
export async function lockListById(db: DbExecutor, id: string): Promise<ListRow | undefined> {
  const [row] = await db.select().from(lists).where(eq(lists.id, id)).limit(1).for('update');
  return row;
}

/** Listas ativas do quadro, por `position` (comparação binária, `COLLATE "C"`). */
export async function findActiveLists(db: DbExecutor, boardId: string): Promise<ListRow[]> {
  return db
    .select()
    .from(lists)
    .where(and(eq(lists.boardId, boardId), isNull(lists.archivedAt)))
    .orderBy(asc(lists.position));
}

/** Listas arquivadas do quadro, por `archivedAt` desc. */
export async function findArchivedLists(db: DbExecutor, boardId: string): Promise<ListRow[]> {
  return db
    .select()
    .from(lists)
    .where(and(eq(lists.boardId, boardId), isNotNull(lists.archivedAt)))
    .orderBy(desc(lists.archivedAt), asc(lists.id));
}

/** Última lista ativa do quadro (maior `position`), para a cor padrão de uma lista nova. */
export async function findLastActiveList(
  db: DbExecutor,
  boardId: string,
): Promise<ListRow | undefined> {
  const [row] = await db
    .select()
    .from(lists)
    .where(and(eq(lists.boardId, boardId), isNull(lists.archivedAt)))
    .orderBy(desc(lists.position))
    .limit(1);
  return row;
}

export async function insertList(db: DbExecutor, values: NewListRow): Promise<ListRow> {
  const [row] = await db.insert(lists).values(values).returning();
  if (!row) throw new Error('insert em lists não retornou linha');
  return row;
}

export async function updateListById(
  db: DbExecutor,
  id: string,
  values: Partial<
    Pick<NewListRow, 'name' | 'color' | 'isDoneList' | 'position' | 'archivedAt' | 'updatedAt'>
  >,
): Promise<ListRow> {
  const [row] = await db.update(lists).set(values).where(eq(lists.id, id)).returning();
  if (!row) throw new Error('update em lists não retornou linha');
  return row;
}

/** Desmarca a lista de conclusão do quadro (se houver outra além de `exceptListId`). */
export async function clearDoneList(
  db: DbExecutor,
  boardId: string,
  exceptListId: string,
  now: Date,
): Promise<void> {
  await db
    .update(lists)
    .set({ isDoneList: false, updatedAt: now })
    .where(and(eq(lists.boardId, boardId), eq(lists.isDoneList, true), ne(lists.id, exceptListId)));
}

/**
 * Listas com lock de linha, em ordem de id (evita deadlock ao mover card entre listas, ADR 0004).
 * O chamador bloqueia os quadros antes (ordem: quadro → lista → card).
 */
export async function lockListsByIds(db: DbExecutor, ids: string[]): Promise<ListRow[]> {
  const unique = [...new Set(ids)].sort();
  const rows: ListRow[] = [];
  for (const id of unique) {
    const row = await lockListById(db, id);
    if (row) rows.push(row);
  }
  return rows;
}
