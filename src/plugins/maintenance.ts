import { READ_NOTIFICATION_RETENTION_DAYS } from '@raphasparda/ronin-shared';
import { and, isNotNull, isNull, lt, lte, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import type { DbExecutor } from '../db/client';
import { authThrottle, authTokens, sessions } from '../db/schema';
import { deleteReadNotificationsBefore } from '../modules/notifications/repository';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Intervalo entre execuções (overview.md §5.2: a cada 24 h e no boot). */
export const MAINTENANCE_INTERVAL_MS = DAY_MS;
/** `auth_throttle` sem bloqueio ativo e com janela iniciada há mais que isto é apagado. */
export const THROTTLE_RETENTION_MS = HOUR_MS;
/** Convites/redefinições expirados, usados ou revogados há mais que isto são apagados. */
export const AUTH_TOKEN_RETENTION_MS = 30 * DAY_MS;

export interface MaintenanceResult {
  notifications: number;
  sessions: number;
  throttle: number;
  authTokens: number;
}

/**
 * Limpeza periódica (overview.md §5.2). Cada `DELETE` é independente e idempotente:
 * - notificações lidas há mais de 90 dias (RN19; não lidas nunca);
 * - sessões com expiração ociosa ou absoluta vencida;
 * - `auth_throttle` sem bloqueio vigente e com janela iniciada há mais de 1 h;
 * - `auth_tokens` que já não estão pendentes (expirados, usados ou revogados) há mais de 30 dias
 *   **e** criados há mais de 30 dias (continuam no histórico de convites até lá, api.md §8).
 */
export async function runMaintenance(db: DbExecutor, now: Date): Promise<MaintenanceResult> {
  const notificationCutoff = new Date(now.getTime() - READ_NOTIFICATION_RETENTION_DAYS * DAY_MS);
  const notificationsDeleted = await deleteReadNotificationsBefore(db, notificationCutoff);

  const sessionRows = await db
    .delete(sessions)
    .where(or(lte(sessions.idleExpiresAt, now), lte(sessions.absoluteExpiresAt, now)))
    .returning({ id: sessions.id });

  const throttleCutoff = new Date(now.getTime() - THROTTLE_RETENTION_MS);
  const throttleRows = await db
    .delete(authThrottle)
    .where(
      and(
        or(isNull(authThrottle.lockedUntil), lte(authThrottle.lockedUntil, now)),
        lt(authThrottle.windowStartedAt, throttleCutoff),
      ),
    )
    .returning({ key: authThrottle.key });

  const tokenCutoff = new Date(now.getTime() - AUTH_TOKEN_RETENTION_MS);
  const tokenRows = await db
    .delete(authTokens)
    .where(
      and(
        lt(authTokens.createdAt, tokenCutoff),
        or(
          lt(authTokens.expiresAt, tokenCutoff),
          and(isNotNull(authTokens.usedAt), lt(authTokens.usedAt, tokenCutoff)),
          and(isNotNull(authTokens.revokedAt), lt(authTokens.revokedAt, tokenCutoff)),
        ),
      ),
    )
    .returning({ id: authTokens.id });

  return {
    notifications: notificationsDeleted,
    sessions: sessionRows.length,
    throttle: throttleRows.length,
    authTokens: tokenRows.length,
  };
}

/**
 * Agenda `runMaintenance` no `onReady` (uma vez, sem bloquear a subida) e a cada 24 h; o timer é
 * `unref` e é cancelado no `onClose`. Processo único da API (ADR 0001), então não há corrida
 * entre réplicas. Falhas vão para o log e não derrubam o processo.
 */
export function registerMaintenance(app: FastifyInstance): void {
  let timer: NodeJS.Timeout | undefined;
  let current: Promise<void> | undefined;

  const run = (): Promise<void> => {
    current ??= (async () => {
      try {
        const result = await runMaintenance(app.db, app.clock());
        app.log.info({ maintenance: result }, 'manutenção concluída');
      } catch (err) {
        app.log.error({ err }, 'falha na manutenção');
      } finally {
        current = undefined;
      }
    })();
    return current;
  };

  app.addHook('onReady', (done) => {
    void run();
    timer = setInterval(() => void run(), MAINTENANCE_INTERVAL_MS);
    timer.unref();
    done();
  });
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
    await current;
  });
}
