import { eq } from 'drizzle-orm';

import type { DbExecutor } from '../../db/client';
import { workspace, type WorkspaceRow } from '../../db/schema';

/** Id fixo da instância única (`workspace_singleton_check`). */
export const WORKSPACE_ID = 1;

export async function findWorkspace(db: DbExecutor): Promise<WorkspaceRow | undefined> {
  const [row] = await db.select().from(workspace).where(eq(workspace.id, WORKSPACE_ID)).limit(1);
  return row;
}

/** Cria ou atualiza a linha única do workspace (setup). */
export async function upsertWorkspace(
  db: DbExecutor,
  values: { name: string; timezone: string },
): Promise<WorkspaceRow> {
  const [row] = await db
    .insert(workspace)
    .values({ id: WORKSPACE_ID, ...values })
    .onConflictDoUpdate({ target: workspace.id, set: values })
    .returning();
  if (!row) throw new Error('upsert em workspace não retornou linha');
  return row;
}

export async function updateWorkspaceRow(
  db: DbExecutor,
  values: { name?: string; timezone?: string; updatedAt: Date },
): Promise<WorkspaceRow | undefined> {
  const [row] = await db
    .update(workspace)
    .set(values)
    .where(eq(workspace.id, WORKSPACE_ID))
    .returning();
  return row;
}
