import { asc, eq } from 'drizzle-orm';

import type { DbExecutor } from '../../db/client';
import { labels, type LabelRow } from '../../db/schema';

/** Etiquetas do quadro, por nome. */
export async function findBoardLabels(db: DbExecutor, boardId: string): Promise<LabelRow[]> {
  return db
    .select()
    .from(labels)
    .where(eq(labels.boardId, boardId))
    .orderBy(asc(labels.name), asc(labels.id));
}
