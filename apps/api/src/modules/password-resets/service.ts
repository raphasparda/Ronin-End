import {
  isPasswordSameAsEmail,
  PASSWORD_RESET_TTL_MS,
  PASSWORD_SAME_AS_EMAIL_MESSAGE,
  type CompletePasswordResetRequest,
  type PasswordResetLinkResponse,
  type PasswordResetLookupResponse,
} from '@kanban/shared';

import type { Database, DbExecutor } from '../../db/client';
import type { AuthTokenRow, UserRow } from '../../db/schema';
import { AppError } from '../../lib/app-error';
import { toIso } from '../../lib/dates';
import type { PasswordHasher } from '../../lib/password';
import { randomToken, sha256Hex } from '../../lib/tokens';
import {
  consumeToken,
  findPendingToken,
  insertAuthToken,
  revokeUnusedPasswordResets,
} from '../auth-tokens/repository';
import { deleteUserSessions } from '../sessions/service';
import { findUserById, lockUserById, updateActiveUserPassword } from '../users/repository';
import { USER_ANONYMIZED_MESSAGE, USER_NOT_FOUND_MESSAGE } from '../users/service';

export const RESET_INVALID_MESSAGE = 'Link de redefinição inválido.';
export const USER_NOT_ACTIVE_MESSAGE = 'Este usuário está desativado.';

/** URL exibida uma única vez ao Admin; token no fragmento (ADR 0008). */
export function passwordResetUrl(appOrigin: string, token: string): string {
  return `${appOrigin}/redefinir-senha#token=${token}`;
}

/**
 * `POST /api/admin/users/:userId/password-reset-links`. Ordem: 404 → anonimizado → desativado
 * (api.md §18.4). Revoga os links pendentes do alvo e cria um novo (24 h).
 */
export async function createPasswordResetLink(
  deps: { db: Database; now: Date; appOrigin: string },
  actorId: string,
  userId: string,
): Promise<PasswordResetLinkResponse> {
  const { db, now, appOrigin } = deps;
  return db.transaction(async (tx) => {
    const target = await lockUserById(tx, userId);
    if (!target) throw new AppError('NOT_FOUND', USER_NOT_FOUND_MESSAGE);
    if (target.anonymizedAt !== null) {
      throw new AppError('USER_ANONYMIZED', USER_ANONYMIZED_MESSAGE);
    }
    if (target.status !== 'active') {
      throw new AppError('USER_NOT_ACTIVE', USER_NOT_ACTIVE_MESSAGE);
    }

    await revokeUnusedPasswordResets(tx, target.id, now);
    const token = randomToken();
    const row = await insertAuthToken(tx, {
      kind: 'password_reset',
      tokenHash: sha256Hex(token),
      targetUserId: target.id,
      createdBy: actorId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
    });
    return { url: passwordResetUrl(appOrigin, token), expiresAt: toIso(row.expiresAt) };
  });
}

function invalidReset(): AppError {
  return new AppError('TOKEN_INVALID', RESET_INVALID_MESSAGE);
}

type ResettableUser = UserRow & { email: string };

function canResetPassword(user: UserRow | undefined): user is ResettableUser {
  return (
    user !== undefined &&
    user.status === 'active' &&
    user.anonymizedAt === null &&
    user.email !== null
  );
}

async function findUsableReset(
  db: DbExecutor,
  tokenHash: string,
  now: Date,
): Promise<{ token: AuthTokenRow; user: ResettableUser }> {
  const token = await findPendingToken(db, 'password_reset', tokenHash, now);
  if (!token?.targetUserId) throw invalidReset();
  const user = await findUserById(db, token.targetUserId);
  if (!canResetPassword(user)) throw invalidReset();
  return { token, user };
}

/** `POST /api/auth/password-resets/lookup`. Alvo não ativo também é `410`. */
export async function lookupPasswordReset(
  db: Database,
  token: string,
  now: Date,
): Promise<PasswordResetLookupResponse> {
  const found = await findUsableReset(db, sha256Hex(token), now);
  return { userName: found.user.name, expiresAt: toIso(found.token.expiresAt) };
}

/**
 * `POST /api/auth/password-resets/complete`. Token inválido → 410; senha igual ao e-mail do alvo →
 * 400 em `password` (api.md §18.5); depois, numa transação: consome o token, grava o hash e encerra
 * **todas** as sessões do usuário. Não cria sessão.
 */
export async function completePasswordReset(
  deps: { db: Database; passwords: PasswordHasher; now: Date },
  input: CompletePasswordResetRequest,
): Promise<void> {
  const { db, passwords, now } = deps;
  const tokenHash = sha256Hex(input.token);
  const { user } = await findUsableReset(db, tokenHash, now);

  if (isPasswordSameAsEmail(input.password, user.email)) {
    throw new AppError('VALIDATION_ERROR', 'Dados inválidos.', {
      details: [{ path: 'password', message: PASSWORD_SAME_AS_EMAIL_MESSAGE }],
    });
  }

  const passwordHash = await passwords.hash(input.password);

  await db.transaction(async (tx) => {
    const consumed = await consumeToken(tx, 'password_reset', tokenHash, now, user.id);
    if (consumed?.targetUserId !== user.id) throw invalidReset();
    // O alvo pode ter sido desativado entre o lookup e aqui: só grava se ainda ativo (rollback).
    if (!(await updateActiveUserPassword(tx, user.id, passwordHash, now))) throw invalidReset();
    await deleteUserSessions(tx, user.id);
  });
}
