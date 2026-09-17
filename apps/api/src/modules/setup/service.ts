import type { AuthSessionResponse, SetupRequest, SetupStatusResponse } from '@kanban/shared';
import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { AppError } from '../../lib/app-error';
import type { PasswordHasher } from '../../lib/password';
import { createSession } from '../sessions/service';
import { hasAnyUser, insertUser } from '../users/repository';
import { upsertWorkspace } from '../workspace/repository';

/**
 * Chave do `pg_advisory_xact_lock` do setup (bigint arbitrário e fixo, "ronin-setup").
 * Serializa setups concorrentes: o segundo espera o primeiro commitar e então vê o usuário criado.
 */
export const SETUP_ADVISORY_LOCK_KEY = 7_236_828_167_190_642_000n;

export const SETUP_ALREADY_DONE_MESSAGE = 'A instância já foi configurada.';

export async function getSetupStatus(db: Database): Promise<SetupStatusResponse> {
  return { needsSetup: !(await hasAnyUser(db)) };
}

export interface SetupResult extends AuthSessionResponse {
  token: string;
}

/**
 * Setup inicial (api.md §4): numa transação com advisory lock, cria/atualiza o workspace, cria o
 * primeiro usuário (Admin) e a sessão. Se já existe usuário → `409 SETUP_ALREADY_DONE`.
 */
export async function performSetup(
  deps: { db: Database; passwords: PasswordHasher; now: Date },
  input: SetupRequest,
): Promise<SetupResult> {
  const { db, passwords, now } = deps;

  // Atalho antes do Argon2id (caro): instância já configurada não gasta CPU com hash.
  if (await hasAnyUser(db)) {
    throw new AppError('SETUP_ALREADY_DONE', SETUP_ALREADY_DONE_MESSAGE);
  }
  const passwordHash = await passwords.hash(input.password);

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${SETUP_ADVISORY_LOCK_KEY.toString()}::bigint)`,
    );
    if (await hasAnyUser(tx)) {
      throw new AppError('SETUP_ALREADY_DONE', SETUP_ALREADY_DONE_MESSAGE);
    }

    const ws = await upsertWorkspace(tx, { name: input.workspaceName, timezone: input.timezone });
    const user = await insertUser(tx, {
      email: input.email,
      name: input.name,
      passwordHash,
      role: 'admin',
      passwordChangedAt: now,
    });
    const { token } = await createSession(tx, user.id, now);

    return {
      token,
      user: { id: user.id, name: user.name, email: input.email, role: user.role },
      workspace: { name: ws.name, timezone: ws.timezone },
    };
  });
}
