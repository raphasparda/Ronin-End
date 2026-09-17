import type { Workspace } from '@kanban/shared';

import type { DbExecutor } from '../../db/client';

import { findWorkspace } from './repository';

/**
 * Workspace da instância (`{ name, timezone }`). Só é chamado com a instância configurada: o setup
 * cria o workspace na mesma transação do primeiro usuário, então ausência aqui é bug (500).
 */
export async function getWorkspace(db: DbExecutor): Promise<Workspace> {
  const row = await findWorkspace(db);
  if (!row) throw new Error('workspace ausente em instância com usuários');
  return { name: row.name, timezone: row.timezone };
}
