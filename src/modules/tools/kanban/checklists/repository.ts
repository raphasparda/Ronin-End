import { asc, eq } from 'drizzle-orm';

import type { DbExecutor } from '../../../../db/client';
import {
  checklistItems,
  checklists,
  type ChecklistItemRow,
  type ChecklistRow,
  type NewChecklistItemRow,
  type NewChecklistRow,
} from '../../../../db/schema';

export async function findChecklistById(
  db: DbExecutor,
  id: string,
): Promise<ChecklistRow | undefined> {
  const [row] = await db.select().from(checklists).where(eq(checklists.id, id)).limit(1);
  return row;
}

/** Checklist com lock de linha (pai dos itens no cálculo de posição, ADR 0004). */
export async function lockChecklistById(
  db: DbExecutor,
  id: string,
): Promise<ChecklistRow | undefined> {
  const [row] = await db
    .select()
    .from(checklists)
    .where(eq(checklists.id, id))
    .limit(1)
    .for('update');
  return row;
}

export async function insertChecklist(
  db: DbExecutor,
  values: NewChecklistRow,
): Promise<ChecklistRow> {
  const [row] = await db.insert(checklists).values(values).returning();
  if (!row) throw new Error('insert em checklists não retornou linha');
  return row;
}

export async function updateChecklistById(
  db: DbExecutor,
  id: string,
  values: Partial<Pick<NewChecklistRow, 'title' | 'updatedAt'>>,
): Promise<ChecklistRow> {
  const [row] = await db.update(checklists).set(values).where(eq(checklists.id, id)).returning();
  if (!row) throw new Error('update em checklists não retornou linha');
  return row;
}

/** Exclui o checklist; itens saem em cascata. */
export async function deleteChecklistById(db: DbExecutor, id: string): Promise<void> {
  await db.delete(checklists).where(eq(checklists.id, id));
}

/** Itens do checklist, por `position` (comparação binária, `COLLATE "C"`). */
export async function findChecklistItems(
  db: DbExecutor,
  checklistId: string,
): Promise<ChecklistItemRow[]> {
  return db
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.checklistId, checklistId))
    .orderBy(asc(checklistItems.position), asc(checklistItems.id));
}

export async function findChecklistItemById(
  db: DbExecutor,
  id: string,
): Promise<ChecklistItemRow | undefined> {
  const [row] = await db.select().from(checklistItems).where(eq(checklistItems.id, id)).limit(1);
  return row;
}

/** Item com lock de linha. Ordem de locks: quadro → card → checklist → item. */
export async function lockChecklistItemById(
  db: DbExecutor,
  id: string,
): Promise<ChecklistItemRow | undefined> {
  const [row] = await db
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.id, id))
    .limit(1)
    .for('update');
  return row;
}

export async function insertChecklistItem(
  db: DbExecutor,
  values: NewChecklistItemRow,
): Promise<ChecklistItemRow> {
  const [row] = await db.insert(checklistItems).values(values).returning();
  if (!row) throw new Error('insert em checklist_items não retornou linha');
  return row;
}

export async function updateChecklistItemById(
  db: DbExecutor,
  id: string,
  values: Partial<
    Pick<
      NewChecklistItemRow,
      'text' | 'position' | 'isChecked' | 'checkedBy' | 'checkedAt' | 'updatedAt'
    >
  >,
): Promise<ChecklistItemRow> {
  const [row] = await db
    .update(checklistItems)
    .set(values)
    .where(eq(checklistItems.id, id))
    .returning();
  if (!row) throw new Error('update em checklist_items não retornou linha');
  return row;
}

export async function deleteChecklistItemById(db: DbExecutor, id: string): Promise<void> {
  await db.delete(checklistItems).where(eq(checklistItems.id, id));
}
