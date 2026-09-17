import {
  isPasswordSameAsEmail,
  PASSWORD_SAME_AS_EMAIL_MESSAGE,
  type ChangePasswordRequest,
  type SessionUser,
} from '@kanban/shared';

import type { Database } from '../../db/client';
import { AppError } from '../../lib/app-error';
import type { PasswordHasher } from '../../lib/password';
import { tooManyAttempts } from '../auth/service';
import { emailThrottleKey, LOGIN_THROTTLE, releaseAttempt, reserveAttempt } from '../auth/throttle';
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
 * reserva atômica no throttle do e-mail (bloqueado: 429, o mesmo do login) → senha atual
 * (errada: a reserva conta como falha e responde `400 PASSWORD_INCORRECT`; certa: devolvida) → grava o hash e apaga as outras sessões.
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

  // Reserva atômica antes do Argon2 (api.md §18.5): rajada paralela não passa de 5 verificações.
  const emailKey = emailThrottleKey(sessionUser.email);
  const attempt = await reserveAttempt(db, emailKey, LOGIN_THROTTLE.emailMaxFailures, now);
  if (!attempt.allowed) throw tooManyAttempts(attempt.lockedUntil, now);

  const user = await findUserById(db, sessionUser.id);
  const currentOk =
    user?.passwordHash != null &&
    (await passwords.verify(user.passwordHash, input.currentPassword));
  // Errada: a reserva fica (conta como falha). Certa: devolvida (a troca não zera o e-mail).
  if (!currentOk) throw new AppError('PASSWORD_INCORRECT', PASSWORD_INCORRECT_MESSAGE);
  await releaseAttempt(db, emailKey, LOGIN_THROTTLE.emailMaxFailures);

  const passwordHash = await passwords.hash(input.newPassword);
  await db.transaction(async (tx) => {
    if (!(await updateActiveUserPassword(tx, sessionUser.id, passwordHash, now))) {
      throw new AppError('UNAUTHENTICATED', 'Sua sessão expirou. Entre novamente.');
    }
    await deleteUserSessions(tx, sessionUser.id, currentSessionId);
  });
}
