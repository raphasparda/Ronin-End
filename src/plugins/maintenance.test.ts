import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createDbTestApp, createTestClock } from '../../test/auth';
import { describeDb, useTestDatabase } from '../../test/db';
import type { Database } from '../db/client';
import { authThrottle, authTokens, notifications, sessions } from '../db/schema';
import { insertCardGraph, insertUser } from '../db/test-fixtures';
import { sha256Hex } from '../lib/tokens';

import { runMaintenance } from './maintenance';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-16T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

async function seedNotifications(db: Database) {
  const { user, card } = await insertCardGraph(db);
  const other = await insertUser(db);
  const base = {
    userId: other.id,
    actorId: user.id,
    cardId: card.id,
    type: 'card_assigned' as const,
  };
  const rows = await db
    .insert(notifications)
    .values([
      // Lida há 90 dias + 1 ms: apagada.
      { ...base, createdAt: ago(200 * DAY), readAt: ago(90 * DAY + 1) },
      // Lida há exatamente 90 dias: fica.
      { ...base, createdAt: ago(200 * DAY), readAt: ago(90 * DAY) },
      // Não lida e antiga: fica (RN19 só vale para lidas).
      { ...base, createdAt: ago(400 * DAY), readAt: null },
      // Lida recentemente: fica.
      { ...base, createdAt: ago(10 * DAY), readAt: ago(1 * DAY) },
    ])
    .returning();
  return { user, other, rows };
}

describeDb('manutenção (kanban_test)', () => {
  const { db } = useTestDatabase();

  describe('runMaintenance', () => {
    it('apaga só notificações lidas há > 90 dias, sessões expiradas, throttle velho sem lock e tokens velhos', async () => {
      const { user, other, rows } = await seedNotifications(db());

      const session = (idleExpiresAt: Date, absoluteExpiresAt: Date) => ({
        id: sha256Hex(randomUUID()),
        userId: user.id,
        createdAt: ago(DAY),
        lastSeenAt: ago(DAY),
        idleExpiresAt,
        absoluteExpiresAt,
      });
      const sessionRows = [
        session(ago(1), new Date(NOW.getTime() + DAY)), // ociosa vencida
        session(new Date(NOW.getTime() + DAY), NOW), // absoluta vencida (limite exato)
        session(new Date(NOW.getTime() + DAY), new Date(NOW.getTime() + DAY)), // válida
      ];
      await db().insert(sessions).values(sessionRows);

      await db()
        .insert(authThrottle)
        .values([
          { key: 'ip:1.1.1.1', failures: 3, windowStartedAt: ago(2 * 60 * 60 * 1000) }, // apaga
          { key: 'ip:2.2.2.2', failures: 3, windowStartedAt: ago(30 * 60 * 1000) }, // janela recente
          {
            key: 'email:a@exemplo.com',
            failures: 5,
            windowStartedAt: ago(2 * 60 * 60 * 1000),
            lockedUntil: new Date(NOW.getTime() + 60_000),
          }, // bloqueio vigente
          {
            key: 'email:b@exemplo.com',
            failures: 5,
            windowStartedAt: ago(3 * 60 * 60 * 1000),
            lockedUntil: ago(60 * 60 * 1000),
          }, // bloqueio vencido e janela velha: apaga
        ]);

      const token = (
        overrides: Partial<typeof authTokens.$inferInsert> & { expiresAt: Date },
      ): typeof authTokens.$inferInsert => ({
        kind: 'invite' as const,
        role: 'member' as const,
        tokenHash: sha256Hex(randomUUID()),
        createdBy: user.id,
        ...overrides,
      });
      const tokenRows = await db()
        .insert(authTokens)
        .values([
          token({ createdAt: ago(60 * DAY), expiresAt: ago(53 * DAY) }), // expirado velho: apaga
          token({ createdAt: ago(60 * DAY), expiresAt: ago(20 * DAY), usedAt: ago(40 * DAY) }), // usado velho: apaga
          token({ createdAt: ago(60 * DAY), expiresAt: ago(20 * DAY), revokedAt: ago(10 * DAY) }), // revogado recente: fica
          token({ createdAt: ago(40 * DAY), expiresAt: new Date(NOW.getTime() + DAY) }), // pendente: fica
          token({ createdAt: ago(29 * DAY), expiresAt: ago(22 * DAY) }), // ainda no histórico: fica
          token({
            kind: 'password_reset',
            role: null,
            targetUserId: other.id,
            createdAt: ago(40 * DAY),
            expiresAt: ago(39 * DAY),
          }), // redefinição expirada velha: apaga
        ])
        .returning();

      const result = await runMaintenance(db(), NOW);
      expect(result).toEqual({ notifications: 1, sessions: 2, throttle: 2, authTokens: 3 });

      expect(
        (await db().select({ id: notifications.id }).from(notifications)).map((r) => r.id).sort(),
      ).toEqual(
        rows
          .slice(1)
          .map((r) => r.id)
          .sort(),
      );
      expect((await db().select({ id: sessions.id }).from(sessions)).map((r) => r.id)).toEqual([
        sessionRows[2]?.id,
      ]);
      expect(
        (await db().select({ key: authThrottle.key }).from(authThrottle)).map((r) => r.key).sort(),
      ).toEqual(['email:a@exemplo.com', 'ip:2.2.2.2']);
      expect(
        (await db().select({ id: authTokens.id }).from(authTokens)).map((r) => r.id).sort(),
      ).toEqual([tokenRows[2]?.id, tokenRows[3]?.id, tokenRows[4]?.id].sort());

      // Idempotente.
      expect(await runMaintenance(db(), NOW)).toEqual({
        notifications: 0,
        sessions: 0,
        throttle: 0,
        authTokens: 0,
      });
    });
  });

  describe('registerMaintenance', () => {
    it('roda no boot quando ligada (relógio do app) e não roda por padrão fora de produção', async () => {
      const { rows } = await seedNotifications(db());
      const clock = createTestClock(NOW);

      const off = await createDbTestApp({ clock: clock.now });
      await off.ready();
      await off.close();
      expect(await db().$count(notifications)).toBe(4);

      const on = await createDbTestApp({ clock: clock.now, maintenance: true });
      await on.ready();
      // `close` espera a execução em andamento terminar.
      await on.close();
      expect(await db().$count(notifications)).toBe(3);
      const [deleted] = rows;
      expect(await db().$count(notifications, eq(notifications.id, deleted?.id ?? ''))).toBe(0);
    });
  });
});
