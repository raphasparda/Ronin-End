import { updateMeResponseSchema } from '@kanban/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { expectError, seedTeam, type Actor } from '../../../test/actors';
import { csrfHeaders } from '../../../test/app';
import {
  createDbTestApp,
  createTestClock,
  DEFAULT_PASSWORD,
  sessionCookieFor,
} from '../../../test/auth';
import { describeDb, useTestDatabase } from '../../../test/db';
import type { App } from '../../app';
import { authThrottle, sessions, users } from '../../db/schema';
import { LOGIN_THROTTLE } from '../auth/throttle';

describeDb('rotas /api/me (kanban_test)', () => {
  const { db } = useTestDatabase();
  const clock = createTestClock();
  let app: App;
  let admin: Actor;
  let member: Actor;

  beforeEach(async () => {
    clock.set(new Date('2026-09-16T12:00:00.000Z'));
    app = await createDbTestApp({ clock: clock.now });
    ({ admin, member } = await seedTeam(db(), clock.now()));
  });

  afterEach(async () => {
    await app.close();
  });

  const patchMe = (body: unknown, headers = member.headers) =>
    app.inject({ method: 'PATCH', url: '/api/me', headers, payload: body as object });

  const changePassword = (body: unknown, headers = member.headers) =>
    app.inject({ method: 'POST', url: '/api/me/password', headers, payload: body as object });

  describe('PATCH /api/me', () => {
    it('200 altera o nome (trim) e devolve o SessionUser', async () => {
      const res = await patchMe({ name: '  Beto Novo  ' });
      expect(res.statusCode).toBe(200);
      expect(updateMeResponseSchema.strict().parse(res.json())).toEqual({
        user: { id: member.user.id, name: 'Beto Novo', email: member.user.email, role: 'member' },
      });
      const [row] = await db().select().from(users).where(eq(users.id, member.user.id));
      expect(row?.name).toBe('Beto Novo');
    });

    it('400 (vazio, longo), 403 CSRF, 401', async () => {
      expectError(await patchMe({ name: '  ' }), 400, 'VALIDATION_ERROR');
      expectError(await patchMe({ name: 'x'.repeat(81) }), 400, 'VALIDATION_ERROR');
      expectError(await patchMe({ name: 'X' }, { cookie: member.cookie }), 403, 'CSRF_REJECTED');
      expectError(await patchMe({ name: 'X' }, csrfHeaders()), 401, 'UNAUTHENTICATED');
    });
  });

  describe('POST /api/me/password', () => {
    it('204: troca a senha e mantém só a sessão atual', async () => {
      const otherSession = await sessionCookieFor(db(), member.user.id, clock.now());
      const res = await changePassword({
        currentPassword: DEFAULT_PASSWORD,
        newPassword: 'nova-senha-forte',
      });
      expect(res.statusCode).toBe(204);

      expect(await db().$count(sessions, eq(sessions.userId, member.user.id))).toBe(1);
      expect(await db().$count(sessions, eq(sessions.userId, admin.user.id))).toBe(1);
      const current = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: member.cookie },
      });
      expect(current.statusCode).toBe(200);
      const other = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: otherSession },
      });
      expectError(other, 401, 'UNAUTHENTICATED');

      const [row] = await db().select().from(users).where(eq(users.id, member.user.id));
      expect(row?.passwordChangedAt).toEqual(clock.now());
      expect(await app.passwords.verify(row?.passwordHash ?? '', 'nova-senha-forte')).toBe(true);
    });

    it('senha atual errada → 400 PASSWORD_INCORRECT e conta no throttle por e-mail (429 depois)', async () => {
      const wrong = { currentPassword: 'nao-e-a-senha', newPassword: 'nova-senha-forte' };
      for (let i = 0; i < LOGIN_THROTTLE.emailMaxFailures; i++) {
        expectError(await changePassword(wrong), 400, 'PASSWORD_INCORRECT');
      }
      const [row] = await db()
        .select()
        .from(authThrottle)
        .where(eq(authThrottle.key, `email:${member.user.email}`));
      expect(row?.failures).toBe(LOGIN_THROTTLE.emailMaxFailures);
      const blocked = await changePassword({
        currentPassword: DEFAULT_PASSWORD,
        newPassword: 'nova-senha-forte',
      });
      expectError(blocked, 429, 'TOO_MANY_ATTEMPTS');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('400 nova senha = e-mail (path newPassword), curta, atual vazia; 403 CSRF; 401', async () => {
      const same = expectError(
        await changePassword({ currentPassword: DEFAULT_PASSWORD, newPassword: member.user.email }),
        400,
        'VALIDATION_ERROR',
      );
      expect(same.details?.[0]?.path).toBe('newPassword');
      expectError(
        await changePassword({ currentPassword: DEFAULT_PASSWORD, newPassword: 'curta' }),
        400,
        'VALIDATION_ERROR',
      );
      expectError(
        await changePassword({ currentPassword: '', newPassword: 'nova-senha-forte' }),
        400,
        'VALIDATION_ERROR',
      );
      const body = { currentPassword: DEFAULT_PASSWORD, newPassword: 'nova-senha-forte' };
      expectError(await changePassword(body, { cookie: member.cookie }), 403, 'CSRF_REJECTED');
      expectError(await changePassword(body, csrfHeaders()), 401, 'UNAUTHENTICATED');
      expect(await db().$count(authThrottle)).toBe(0);
    });
  });
});
