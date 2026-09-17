import {
  isPasswordSameAsEmail,
  PASSWORD_SAME_AS_EMAIL_MESSAGE,
  type ChangePasswordRequest,
  type SessionUser,
} from '@kanban/shared';

import type { Database } from '../../db/client';
import { AppError } from '../../lib/app-error';
import type { PasswordHasher } from '../../lib/password';
import { emailThrottleKey, findActiveLock, LOGIN_THROTTLE, recordFailure } from '../auth/throttle';
import { TOO_MANY_ATTEMPTS_MESSAGE } from '../auth/service';
import { deleteUserSessions } from '../sessions/service';
import { findUserById, updateActiveUserPassword, updateUserById } from '../users/repository';

export const PASSWORD_INCORRECT_MESSAGE = 'Senha atual incorreta.';

/** `PATCH /api/me { name }`. */
export async function updateMyProfile(
  db: Database,
  sessionUser: SessionUser,
  name: string,
  now: Date,
): Promise<SessionUser> {
  const row = await updateUserById(db, sessionUser.id, { name, updatedAt: now });
  if (!row) throw new Error('usuário da sessão ausente');
  return { ...sessionUser, name: row.name };
}

/**
 * `POST /api/me/password` (api.md §6). Ordem: nova senha igual ao e-mail (400 em `newPassword`) →
 * bloqueio ativo do e-mail (429, o mesmo do login) → senha atual (errada: conta no throttle por
 * e-mail e responde `400 PASSWORD_INCORRECT`) → grava o hash e apaga as outras sessões.
 */
export async function changeMyPassword(
  deps: { db: Database; passwords: PasswordHasher; now: Date },
  sessionUser: SessionUser,
  currentSessionId: string | null,
  input: ChangePasswordRequest,
): Promise<void> {
  const { db, passwords, now } = deps;

  if (isPasswordSameAsEmail(input.newPassword, sessionUser.email)) {
    throw new AppError('VALIDATION_ERROR', 'Dados inválidos.', {
      details: [{ path: 'newPassword', message: PASSWORD_SAME_AS_EMAIL_MESSAGE }],
    });
  }

  const emailKey = emailThrottleKey(sessionUser.email);
  const lockedUntil = await findActiveLock(db, [emailKey], now);
  if (lockedUntil) {
    const retryAfter = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000));
    throw new AppError('TOO_MANY_ATTEMPTS', TOO_MANY_ATTEMPTS_MESSAGE, {
      headers: { 'retry-after': String(retryAfter) },
    });
  }

  const user = await findUserById(db, sessionUser.id);
  const currentOk =
    user?.passwordHash != null &&
    (await passwords.verify(user.passwordHash, input.currentPassword));
  if (!currentOk) {
    await recordFailure(db, emailKey, LOGIN_THROTTLE.emailMaxFailures, now);
    throw new AppError('PASSWORD_INCORRECT', PASSWORD_INCORRECT_MESSAGE);
  }

  const passwordHash = await passwords.hash(input.newPassword);
  await db.transaction(async (tx) => {
    if (!(await updateActiveUserPassword(tx, sessionUser.id, passwordHash, now))) {
      throw new AppError('UNAUTHENTICATED', 'Sua sessão expirou. Entre novamente.');
    }
    await deleteUserSessions(tx, sessionUser.id, currentSessionId);
  });
}
