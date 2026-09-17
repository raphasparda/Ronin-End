import { eq, inArray, sql } from 'drizzle-orm';

import type { DbExecutor } from '../../db/client';
import { authThrottle } from '../../db/schema';

const MINUTE_MS = 60_000;

/**
 * Bloqueio de login persistido (overview.md §6.4):
 * - por e-mail: 5 falhas → bloqueio de 15 min; login com sucesso zera o contador do e-mail;
 * - por IP: 20 falhas → bloqueio de 15 min (IP compartilhado no escritório, por isso maior).
 * As falhas contam dentro de uma janela de 15 min; janela vencida ou bloqueio já terminado
 * recomeçam a contagem.
 */
export const LOGIN_THROTTLE = {
  emailMaxFailures: 5,
  ipMaxFailures: 20,
  windowMs: 15 * MINUTE_MS,
  lockMs: 15 * MINUTE_MS,
} as const;

export const emailThrottleKey = (email: string): string => `email:${email}`;
export const ipThrottleKey = (ip: string): string => `ip:${ip}`;

/** Maior `locked_until` ainda no futuro entre as chaves, ou `null` se nenhuma está bloqueada. */
export async function findActiveLock(
  db: DbExecutor,
  keys: string[],
  now: Date,
): Promise<Date | null> {
  const rows = await db
    .select({ lockedUntil: authThrottle.lockedUntil })
    .from(authThrottle)
    .where(inArray(authThrottle.key, keys));
  let latest: Date | null = null;
  for (const { lockedUntil } of rows) {
    if (lockedUntil && lockedUntil > now && (!latest || lockedUntil > latest)) {
      latest = lockedUntil;
    }
  }
  return latest;
}

/**
 * Registra uma falha de forma atômica (upsert): incrementa na janela atual ou recomeça em 1, e
 * bloqueia ao atingir `maxFailures`. Retorna o estado resultante.
 */
export async function recordFailure(
  db: DbExecutor,
  key: string,
  maxFailures: number,
  now: Date,
): Promise<{ failures: number; lockedUntil: Date | null }> {
  const windowStart = new Date(now.getTime() - LOGIN_THROTTLE.windowMs);
  const lockUntil = new Date(now.getTime() + LOGIN_THROTTLE.lockMs);

  const restart = sql`(${authThrottle.windowStartedAt} <= ${windowStart}::timestamptz OR (${authThrottle.lockedUntil} IS NOT NULL AND ${authThrottle.lockedUntil} <= ${now}::timestamptz))`;
  const nextFailures = sql`(CASE WHEN ${restart} THEN 1 ELSE ${authThrottle.failures} + 1 END)`;

  const [row] = await db
    .insert(authThrottle)
    .values({
      key,
      failures: 1,
      windowStartedAt: now,
      lockedUntil: maxFailures <= 1 ? lockUntil : null,
    })
    .onConflictDoUpdate({
      target: authThrottle.key,
      set: {
        failures: nextFailures,
        windowStartedAt: sql`(CASE WHEN ${restart} THEN ${now}::timestamptz ELSE ${authThrottle.windowStartedAt} END)`,
        lockedUntil: sql`(CASE WHEN ${nextFailures} >= ${maxFailures} THEN ${lockUntil}::timestamptz ELSE NULL END)`,
      },
    })
    .returning({ failures: authThrottle.failures, lockedUntil: authThrottle.lockedUntil });
  if (!row) throw new Error('upsert em auth_throttle não retornou linha');
  return row;
}

export async function resetThrottle(db: DbExecutor, key: string): Promise<void> {
  await db.delete(authThrottle).where(eq(authThrottle.key, key));
}
