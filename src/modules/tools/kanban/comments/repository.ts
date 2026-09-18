import { eq } from 'drizzle-orm';

import type { DbExecutor } from '../../../../db/client';
import { comments, type CommentRow, type NewCommentRow } from '../../../../db/schema';

export async function findCommentById(db: DbExecutor, id: string): Promise<CommentRow | undefined> {
  const [row] = await db.select().from(comments).where(eq(comments.id, id)).limit(1);
  return row;
}

/** Comentário com lock de linha. Ordem de locks: quadro → card → comentário. */
export async function lockCommentById(db: DbExecutor, id: string): Promise<CommentRow | undefined> {
  const [row] = await db.select().from(comments).where(eq(comments.id, id)).limit(1).for('update');
  return row;
}

export async function insertComment(db: DbExecutor, values: NewCommentRow): Promise<CommentRow> {
  const [row] = await db.insert(comments).values(values).returning();
  if (!row) throw new Error('insert em comments não retornou linha');
  return row;
}

export async function updateCommentById(
  db: DbExecutor,
  id: string,
  values: Pick<NewCommentRow, 'body' | 'editedAt'>,
): Promise<CommentRow> {
  const [row] = await db.update(comments).set(values).where(eq(comments.id, id)).returning();
  if (!row) throw new Error('update em comments não retornou linha');
  return row;
}

export async function deleteCommentById(db: DbExecutor, id: string): Promise<void> {
  await db.delete(comments).where(eq(comments.id, id));
}
