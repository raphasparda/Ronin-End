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
  findActiveLock,
  ipThrottleKey,
  recordFailure,
  resetThrottle,
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

/**
 * Login (api.md §5, overview.md §6.1 e §6.4).
 * Ordem: instância configurada → bloqueio ativo (e-mail ou IP) → verificação Argon2id (contra hash
 * fictício quando o usuário não existe ou não pode entrar) → falha registra nas duas chaves;
 * sucesso zera o e-mail, descarta a sessão anterior deste navegador e cria uma nova.
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

  const lockedUntil = await findActiveLock(db, [emailKey, ipKey], now);
  if (lockedUntil) {
    const retryAfter = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000));
    throw new AppError('TOO_MANY_ATTEMPTS', TOO_MANY_ATTEMPTS_MESSAGE, {
      headers: { 'retry-after': String(retryAfter) },
    });
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
    await recordFailure(db, emailKey, LOGIN_THROTTLE.emailMaxFailures, now);
    await recordFailure(db, ipKey, LOGIN_THROTTLE.ipMaxFailures, now);
    throw new AppError('INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE);
  }

  const sessionUser = { id: user.id, name: user.name, email: user.email, role: user.role };

  return db.transaction(async (tx) => {
    await resetThrottle(tx, emailKey);
    if (context.currentSessionId) await deleteSession(tx, context.currentSessionId);
    const { token } = await createSession(tx, user.id, now);
    return { token, user: sessionUser, workspace: await getWorkspace(tx) };
  });
}

/** Logout: apaga a sessão atual no servidor (se houver). Idempotente. */
export async function logout(db: Database, sessionId: string | null): Promise<void> {
  if (sessionId) await deleteSession(db, sessionId);
}
