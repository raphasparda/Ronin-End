import type { Label } from '@kanban/shared';

import type { DbExecutor } from '../../db/client';
import type { LabelRow } from '../../db/schema';

import { findBoardLabels } from './repository';

export function toLabel(row: LabelRow): Label {
  return { id: row.id, boardId: row.boardId, name: row.name, color: row.color };
}

/** Etiquetas do quadro para o payload (`labels` por nome). */
export async function loadBoardLabels(db: DbExecutor, boardId: string): Promise<Label[]> {
  return (await findBoardLabels(db, boardId)).map(toLabel);
}
