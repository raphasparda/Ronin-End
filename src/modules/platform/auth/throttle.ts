import { eq, sql } from 'drizzle-orm';

import type { DbExecutor } from '../../../db/client';
import { authThrottle } from '../../../db/schema';

const MINUTE_MS = 60_000;

/**
 * Bloqueio de login persistido (overview.md §6.4, api.md §18.5):
 * - por e-mail: 5 tentativas erradas → bloqueio de 15 min; login com sucesso zera o e-mail;
 * - por IP: 20 tentativas erradas → bloqueio de 15 min (IP compartilhado no escritório).
 * As tentativas contam dentro de uma janela de 15 min; janela vencida ou bloqueio já terminado
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

export type AttemptResult =
  { allowed: true; failures: number } | { allowed: false; failures: number; lockedUntil: Date };

/**
 * Reserva uma tentativa ANTES da verificação da senha, num único upsert atômico (o `ON CONFLICT
 * DO UPDATE` trava a linha: requisições paralelas na mesma chave são serializadas e cada uma vê o
 * contador já incrementado pelas anteriores).
 *
 * - Chave bloqueada (`locked_until > now`): não estende o bloqueio; o contador sobe só até
 *   `max + 1`, o que marca a tentativa como recusada.
 * - Senão: incrementa na janela atual (ou recomeça em 1) e bloqueia ao atingir `max`.
 *
 * Permitida ⇔ contador resultante `<= max`: no máximo `max` tentativas chegam ao Argon2 por janela,
 * mesmo em rajada. A tentativa que atinge `max` ainda é verificada (e aciona o bloqueio).
 */
export async function reserveAttempt(
  db: DbExecutor,
  key: string,
  maxFailures: number,
  now: Date,
): Promise<AttemptResult> {
  const windowStart = new Date(now.getTime() - LOGIN_THROTTLE.windowMs);
  const lockUntil = new Date(now.getTime() + LOGIN_THROTTLE.lockMs);

  const locked = sql`(${authThrottle.lockedUntil} IS NOT NULL AND ${authThrottle.lockedUntil} > ${now}::timestamptz)`;
  const restart = sql`(NOT ${locked} AND (${authThrottle.windowStartedAt} <= ${windowStart}::timestamptz OR ${authThrottle.lockedUntil} IS NOT NULL))`;
  const nextFailures = sql`(CASE WHEN ${locked} THEN LEAST(${authThrottle.failures} + 1, ${maxFailures + 1}::integer) WHEN ${restart} THEN 1 ELSE ${authThrottle.failures} + 1 END)`;

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
        lockedUntil: sql`(CASE WHEN ${locked} THEN ${authThrottle.lockedUntil} WHEN ${nextFailures} >= ${maxFailures}::integer THEN ${lockUntil}::timestamptz ELSE NULL END)`,
      },
    })
    .returning({ failures: authThrottle.failures, lockedUntil: authThrottle.lockedUntil });
  if (!row) throw new Error('upsert em auth_throttle não retornou linha');

  if (row.failures <= maxFailures) return { allowed: true, failures: row.failures };
  return { allowed: false, failures: row.failures, lockedUntil: row.lockedUntil ?? lockUntil };
}

/**
 * Devolve uma tentativa reservada que não deve contar como falha (senha certa numa chave que não é
 * zerada no sucesso, ou tentativa recusada por outra chave). Se o contador cair abaixo de `max`, o
 * bloqueio que essa tentativa tinha acionado é desfeito.
 */
export async function releaseAttempt(
  db: DbExecutor,
  key: string,
  maxFailures: number,
): Promise<void> {
  await db
    .update(authThrottle)
    .set({
      failures: sql`GREATEST(${authThrottle.failures} - 1, 0)`,
      lockedUntil: sql`(CASE WHEN ${authThrottle.failures} - 1 >= ${maxFailures}::integer THEN ${authThrottle.lockedUntil} ELSE NULL END)`,
    })
    .where(eq(authThrottle.key, key));
}

export async function resetThrottle(db: DbExecutor, key: string): Promise<void> {
  await db.delete(authThrottle).where(eq(authThrottle.key, key));
}

/** Segundos para o `Retry-After` (mínimo 1). */
export function retryAfterSeconds(lockedUntil: Date, now: Date): number {
  return Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000));
}
