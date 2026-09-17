import { asc, eq } from 'drizzle-orm';

import type { DbExecutor } from '../../db/client';
import { labels, type LabelRow, type NewLabelRow } from '../../db/schema';

/** Etiquetas do quadro, por nome. */
export async function findBoardLabels(db: DbExecutor, boardId: string): Promise<LabelRow[]> {
  return db
    .select()
    .from(labels)
    .where(eq(labels.boardId, boardId))
    .orderBy(asc(labels.name), asc(labels.id));
}

export async function findLabelById(db: DbExecutor, id: string): Promise<LabelRow | undefined> {
  const [row] = await db.select().from(labels).where(eq(labels.id, id)).limit(1);
  return row;
}

/** Etiqueta com lock de linha. Ordem de locks: quadro → etiqueta. */
export async function lockLabelById(db: DbExecutor, id: string): Promise<LabelRow | undefined> {
  const [row] = await db.select().from(labels).where(eq(labels.id, id)).limit(1).for('update');
  return row;
}

export async function insertLabel(db: DbExecutor, values: NewLabelRow): Promise<LabelRow> {
  const [row] = await db.insert(labels).values(values).returning();
  if (!row) throw new Error('insert em labels não retornou linha');
  return row;
}

export async function updateLabelById(
  db: DbExecutor,
  id: string,
  values: Partial<Pick<NewLabelRow, 'name' | 'color' | 'updatedAt'>>,
): Promise<LabelRow> {
  const [row] = await db.update(labels).set(values).where(eq(labels.id, id)).returning();
  if (!row) throw new Error('update em labels não retornou linha');
  return row;
}

/** Exclui a etiqueta; `card_labels` sai em cascata (FK `ON DELETE CASCADE`). */
export async function deleteLabelById(db: DbExecutor, id: string): Promise<void> {
  await db.delete(labels).where(eq(labels.id, id));
}
