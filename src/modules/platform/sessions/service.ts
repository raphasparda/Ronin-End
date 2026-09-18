import type { SessionUser } from '@raphasparda/ronin-shared';

import type { DbExecutor } from '../../../db/client';
import type { UserRow } from '../../../db/schema';
import { toIso } from '../../../lib/dates';
import { isTokenFormat, randomToken, sha256Hex } from '../../../lib/tokens';

import {
  deleteSessionById,
  deleteSessionsOfUser,
  findSessionWithUser,
  insertSession,
  updateSessionActivity,
  type SessionWithUser,
} from './repository';

/**
 * `UserRow` → `SessionUser`. O e-mail vem à parte porque na linha ele é anulável (anonimizado) e
 * quem monta a sessão já garantiu que existe.
 */
export function toSessionUser(
  row: Pick<UserRow, 'id' | 'name' | 'role' | 'avatarUpdatedAt'>,
  email: string,
): SessionUser {
  return {
    id: row.id,
    name: row.name,
    email,
    role: row.role,
    avatarUpdatedAt: row.avatarUpdatedAt === null ? null : toIso(row.avatarUpdatedAt),
  };
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Expiração ociosa: 14 dias sem uso (ADR 0002). */
export const SESSION_IDLE_TTL_MS = 14 * DAY_MS;
/** Expiração absoluta: 30 dias desde a criação (ADR 0002). */
export const SESSION_ABSOLUTE_TTL_MS = 30 * DAY_MS;
/** `last_seen_at` é gravado no máximo a cada 5 min (evita um UPDATE por request). */
export const SESSION_TOUCH_INTERVAL_MS = 5 * MINUTE_MS;

export interface CreatedSession {
  /** Token cru: vai só para o cookie, nunca para o banco nem para logs. */
  token: string;
  sessionId: string;
}

/** Cria uma sessão nova (token novo a cada login/setup: evita fixação de sessão). */
export async function createSession(
  db: DbExecutor,
  userId: string,
  now: Date,
): Promise<CreatedSession> {
  const token = randomToken();
  const sessionId = sha256Hex(token);
  await insertSession(db, {
    id: sessionId,
    userId,
    createdAt: now,
    lastSeenAt: now,
    idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_TTL_MS),
    absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS),
  });
  return { token, sessionId };
}

export type SessionCheck =
  | { valid: true; user: SessionUser; needsTouch: boolean }
  | { valid: false; reason: 'idle_expired' | 'absolute_expired' | 'user_inactive' };

/** Regra pura: a sessão encontrada ainda vale em `now`? */
export function checkSession({ session, user }: SessionWithUser, now: Date): SessionCheck {
  const t = now.getTime();
  if (session.absoluteExpiresAt.getTime() <= t) return { valid: false, reason: 'absolute_expired' };
  if (session.idleExpiresAt.getTime() <= t) return { valid: false, reason: 'idle_expired' };
  if (user.status !== 'active' || user.anonymizedAt !== null || user.email === null) {
    return { valid: false, reason: 'user_inactive' };
  }
  return {
    valid: true,
    user: toSessionUser(user, user.email),
    needsTouch: t - session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS,
  };
}

export interface ResolvedSession {
  sessionId: string;
  user: SessionUser;
}

/**
 * Resolve o token do cookie. Retorna `null` se o token é malformado, não existe, expirou ou o
 * usuário não está ativo (sessão expirada é apagada na hora). Renova a expiração ociosa (sliding),
 * sem nunca passar da absoluta.
 */
export async function resolveSession(
  db: DbExecutor,
  token: string,
  now: Date,
): Promise<ResolvedSession | null> {
  if (!isTokenFormat(token)) return null;
  const sessionId = sha256Hex(token);
  const found = await findSessionWithUser(db, sessionId);
  if (!found) return null;

  const check = checkSession(found, now);
  if (!check.valid) {
    if (check.reason !== 'user_inactive') await deleteSessionById(db, sessionId);
    return null;
  }
  if (check.needsTouch) {
    await updateSessionActivity(db, sessionId, {
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_TTL_MS),
    });
  }
  return { sessionId, user: check.user };
}

export async function deleteSession(db: DbExecutor, sessionId: string): Promise<void> {
  await deleteSessionById(db, sessionId);
}

/** Encerra todas as sessões do usuário, exceto `exceptSessionId` (se informado). */
export async function deleteUserSessions(
  db: DbExecutor,
  userId: string,
  exceptSessionId: string | null = null,
): Promise<void> {
  await deleteSessionsOfUser(db, userId, exceptSessionId);
}
