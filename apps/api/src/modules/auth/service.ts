import type { AuthSessionResponse, LoginRequest } from '@kanban/shared';

import type { Database } from '../../db/client';
import { AppError } from '../../lib/app-error';
import type { PasswordHasher } from '../../lib/password';
import { createSession, deleteSession } from '../sessions/service';
import { findUserByEmail, hasAnyUser } from '../users/repository';
import { getWorkspace } from '../workspace/service';

import {
  LOGIN_THROTTLE,
  emailThrottleKey,
  ipThrottleKey,
  releaseAttempt,
  reserveAttempt,
  resetThrottle,
  retryAfterSeconds,
} from './throttle';

export interface AuthDeps {
  db: Database;
  passwords: PasswordHasher;
  now: Date;
}

/** Mensagem única para qualquer falha de credencial (api.md §3): não revela se o e-mail existe. */
export const INVALID_CREDENTIALS_MESSAGE = 'E-mail ou senha incorretos.';
export const TOO_MANY_ATTEMPTS_MESSAGE =
  'Muitas tentativas de login. Aguarde alguns minutos e tente de novo.';
export const SETUP_REQUIRED_MESSAGE = 'A instância ainda não foi configurada.';

export interface LoginResult extends AuthSessionResponse {
  /** Token cru para o cookie. */
  token: string;
}

/** 429 com `Retry-After` (login e troca de senha). */
export function tooManyAttempts(lockedUntil: Date, now: Date): AppError {
  return new AppError('TOO_MANY_ATTEMPTS', TOO_MANY_ATTEMPTS_MESSAGE, {
    headers: { 'retry-after': String(retryAfterSeconds(lockedUntil, now)) },
  });
}

/**
 * Login (api.md §5, §18.5; overview.md §6.1 e §6.4).
 * Ordem: instância configurada → reserva atômica de tentativa no e-mail e depois no IP (recusada →
 * 429; se o IP recusar, a reserva do e-mail é devolvida) → verificação Argon2id (contra hash
 * fictício quando o usuário não existe ou não pode entrar) → falha mantém as reservas e responde a
 * mensagem genérica; sucesso zera o e-mail, devolve a reserva do IP, descarta a sessão anterior
 * deste navegador e cria uma nova.
 *
 * Reservar antes do Argon2 (e não registrar a falha depois) fecha a corrida em que uma rajada
 * paralela passava toda pela checagem de bloqueio antes de a primeira falha ser gravada.
 */
export async function login(
  deps: AuthDeps,
  input: LoginRequest,
  context: { ip: string; currentSessionId: string | null },
): Promise<LoginResult> {
  const { db, passwords, now } = deps;

  if (!(await hasAnyUser(db))) {
    throw new AppError('SETUP_REQUIRED', SETUP_REQUIRED_MESSAGE);
  }

  const emailKey = emailThrottleKey(input.email);
  const ipKey = ipThrottleKey(context.ip);

  // E-mail primeiro: rajada contra um e-mail bloqueado não toca no contador do IP (que é
  // compartilhado pelo escritório).
  const emailAttempt = await reserveAttempt(db, emailKey, LOGIN_THROTTLE.emailMaxFailures, now);
  if (!emailAttempt.allowed) throw tooManyAttempts(emailAttempt.lockedUntil, now);

  const ipAttempt = await reserveAttempt(db, ipKey, LOGIN_THROTTLE.ipMaxFailures, now);
  if (!ipAttempt.allowed) {
    await releaseAttempt(db, emailKey, LOGIN_THROTTLE.emailMaxFailures);
    throw tooManyAttempts(ipAttempt.lockedUntil, now);
  }

  const user = await findUserByEmail(db, input.email);
  const canSignIn =
    user !== undefined &&
    user.status === 'active' &&
    user.anonymizedAt === null &&
    user.email !== null &&
    user.passwordHash !== null;

  const passwordOk =
    canSignIn && user.passwordHash !== null
      ? await passwords.verify(user.passwordHash, input.password)
      : await passwords.verifyDummy(input.password);

  if (!canSignIn || !passwordOk || user.email === null) {
    // As duas reservas ficam: contam como falha.
    throw new AppError('INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE);
  }

  const sessionUser = { id: user.id, name: user.name, email: user.email, role: user.role };

  return db.transaction(async (tx) => {
    await resetThrottle(tx, emailKey);
    // Sucesso não conta no IP (semântica anterior: o IP só soma falhas).
    await releaseAttempt(tx, ipKey, LOGIN_THROTTLE.ipMaxFailures);
    if (context.currentSessionId) await deleteSession(tx, context.currentSessionId);
    const { token } = await createSession(tx, user.id, now);
    return { token, user: sessionUser, workspace: await getWorkspace(tx) };
  });
}

/** Logout: apaga a sessão atual no servidor (se houver). Idempotente. */
export async function logout(db: Database, sessionId: string | null): Promise<void> {
  if (sessionId) await deleteSession(db, sessionId);
}
