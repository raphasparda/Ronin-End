import type { UpdateWorkspaceRequest, Workspace } from '@raphasparda/ronin-shared';

import type { DbExecutor } from '../../db/client';

import { findWorkspace, updateWorkspaceRow } from './repository';

/**
 * Workspace da instância (`{ name, timezone }`). Só é chamado com a instância configurada: o setup
 * cria o workspace na mesma transação do primeiro usuário, então ausência aqui é bug (500).
 */
export async function getWorkspace(db: DbExecutor): Promise<Workspace> {
  const row = await findWorkspace(db);
  if (!row) throw new Error('workspace ausente em instância com usuários');
  return { name: row.name, timezone: row.timezone };
}

/** `PATCH /api/admin/workspace` (ao menos um campo, garantido pelo schema). */
export async function updateWorkspace(
  db: DbExecutor,
  input: UpdateWorkspaceRequest,
  now: Date,
): Promise<Workspace> {
  const row = await updateWorkspaceRow(db, {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    updatedAt: now,
  });
  if (!row) throw new Error('workspace ausente em instância com usuários');
  return { name: row.name, timezone: row.timezone };
}
