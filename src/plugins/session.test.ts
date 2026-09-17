import { errorResponseSchema } from '@raphasparda/ronin-shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { csrfHeaders } from '../../test/app';
import {
  createDbTestApp,
  createTestClock,
  jsonMutationHeaders,
  seedUser,
  seedWorkspace,
  sessionCookieFor,
  sessionCookieOf,
} from '../../test/auth';
import { describeDb, useTestDatabase } from '../../test/db';
import type { App } from '../app';
import { sessions, users } from '../db/schema';
import { randomToken, sha256Hex } from '../lib/tokens';
import {
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_MS,
  SESSION_TOUCH_INTERVAL_MS,
} from '../modules/sessions/service';

import { requireAdmin, sessionCookieName, sessionCookieOptions } from './session';

const DAY_MS = 86_400_000;

describe('cookie de sessão (atributos)', () => {
  it('dev/test: kanban_sid sem Secure; produção: __Host-kanban_sid com Secure', () => {
    expect(sessionCookieName('development')).toBe('kanban_sid');
    expect(sessionCookieName('test')).toBe('kanban_sid');
    expect(sessionCookieName('production')).toBe('__Host-kanban_sid');
    expect(sessionCookieOptions('development')).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: false,
    });
    expect(sessionCookieOptions('production')).toMatchObject({ secure: true, path: '/' });
  });
});

describeDb('plugins/session (kanban_test)', () => {
  const { db } = useTestDatabase();
  let app: App | undefined;
  const clock = createTestClock();

  afterEach(async () => {
    await app?.close();
    app = undefined;
    clock.set(new Date('2026-09-16T12:00:00.000Z'));
  });

  async function setupApp(): Promise<App> {
    app = await createDbTestApp({ clock: clock.now });
    app.get('/api/__test/admin', { preHandler: requireAdmin }, () => ({ ok: true }));
    await app.ready();
    return app;
  }

  const me = (a: App, cookie?: string) =>
    a.inject({ method: 'GET', url: '/api/auth/me', headers: cookie ? { cookie } : {} });

  function expectClearedCookie(res: Awaited<ReturnType<typeof me>>): void {
    const cookie = sessionCookieOf(res);
    expect(cookie?.value).toBe('');
    expect(res.headers['set-cookie']).toMatch(/kanban_sid=;.*Expires=Thu, 01 Jan 1970/);
  }

  it('sessão válida preenche request.user; sem cookie → 401 UNAUTHENTICATED', async () => {
    const a = await setupApp();
    await seedWorkspace(db());
    const user = await seedUser(db());
    const cookie = await sessionCookieFor(db(), user.id, clock.now());

    const ok = await me(a, cookie);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({
      user: { id: user.id, name: 'Ana', email: 'ana@exemplo.com', role: 'admin' },
      workspace: { name: 'Ronin', timezone: 'America/Sao_Paulo' },
      features: { cardCovers: false },
    });
    expect(ok.headers['set-cookie']).toBeUndefined();

    const anon = await me(a);
    expect(anon.statusCode).toBe(401);
    expect(errorResponseSchema.parse(anon.json()).error.code).toBe('UNAUTHENTICATED');
  });

  it('expiração ociosa (14 dias sem uso) → 401, cookie limpo e sessão apagada', async () => {
    const a = await setupApp();
    await seedWorkspace(db());
    const user = await seedUser(db());
    const cookie = await sessionCookieFor(db(), user.id, clock.now());

    clock.advance(SESSION_IDLE_TTL_MS - 1_000);
    expect((await me(a, cookie)).statusCode).toBe(200);

    // O uso acima renovou a expiração ociosa (sliding): mais 13 dias ainda vale.
    clock.advance(13 * DAY_MS);
    expect((await me(a, cookie)).statusCode).toBe(200);

    clock.advance(SESSION_IDLE_TTL_MS);
    const expired = await me(a, cookie);
    expect(expired.statusCode).toBe(401);
    expect(errorResponseSchema.parse(expired.json()).error.code).toBe('UNAUTHENTICATED');
    expectClearedCookie(expired);
    expect(await db().$count(sessions)).toBe(0);
  });

  it('expiração absoluta (30 dias) mesmo com uso contínuo → 401 e cookie limpo', async () => {
    const a = await setupApp();
    await seedWorkspace(db());
    const user = await seedUser(db());
    const cookie = await sessionCookieFor(db(), user.id, clock.now());

    for (let day = 7; day < 30; day += 7) {
      clock.advance(7 * DAY_MS);
      expect((await me(a, cookie)).statusCode).toBe(200);
    }
    clock.set(new Date(new Date('2026-09-16T12:00:00.000Z').getTime() + SESSION_ABSOLUTE_TTL_MS));
    const expired = await me(a, cookie);
    expect(expired.statusCode).toBe(401);
    expectClearedCookie(expired);
  });

  it('last_seen_at só é gravado a cada 5 min', async () => {
    const a = await setupApp();
    await seedWorkspace(db());
    const user = await seedUser(db());
    const start = clock.now();
    const cookie = await sessionCookieFor(db(), user.id, start);
    const seen = async () => (await db().select().from(sessions))[0]?.lastSeenAt.getTime();

    clock.advance(SESSION_TOUCH_INTERVAL_MS - 1);
    await me(a, cookie);
    expect(await seen()).toBe(start.getTime());

    clock.advance(1);
    await me(a, cookie);
    expect(await seen()).toBe(clock.now().getTime());
    const [row] = await db().select().from(sessions);
    expect(row?.idleExpiresAt.getTime()).toBe(clock.now().getTime() + SESSION_IDLE_TTL_MS);
  });

  it('usuário desativado → 401 na hora e cookie limpo', async () => {
    const a = await setupApp();
    await seedWorkspace(db());
    const user = await seedUser(db());
    const cookie = await sessionCookieFor(db(), user.id, clock.now());
    expect((await me(a, cookie)).statusCode).toBe(200);

    await db().update(users).set({ status: 'deactivated' }).where(eq(users.id, user.id));
    const res = await me(a, cookie);
    expect(res.statusCode).toBe(401);
    expectClearedCookie(res);
  });

  it('mudança de papel vale no request seguinte (usuário recarregado do banco)', async () => {
    const a = await setupApp();
    await seedWorkspace(db());
    const user = await seedUser(db());
    const cookie = await sessionCookieFor(db(), user.id, clock.now());

    await db().update(users).set({ role: 'member' }).where(eq(users.id, user.id));
    expect((await me(a, cookie)).json()).toMatchObject({ user: { role: 'member' } });
  });

  it('cookie malformado ou inexistente → 401 e cookie limpo', async () => {
    const a = await setupApp();
    for (const value of ['lixo', randomToken()]) {
      const res = await me(a, `kanban_sid=${value}`);
      expect(res.statusCode).toBe(401);
      expectClearedCookie(res);
    }
  });

  it('rota pública com cookie expirado continua acessível (e limpa o cookie)', async () => {
    const a = await setupApp();
    const user = await seedUser(db());
    const cookie = await sessionCookieFor(db(), user.id, clock.now());
    clock.advance(SESSION_ABSOLUTE_TTL_MS);
    const res = await a.inject({ method: 'GET', url: '/api/setup/status', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expectClearedCookie(res);
  });

  it('banco guarda só o SHA-256 do token', async () => {
    await setupApp();
    const user = await seedUser(db());
    const cookie = await sessionCookieFor(db(), user.id, clock.now());
    const token = cookie.split('=')[1] ?? '';
    const [row] = await db().select().from(sessions);
    expect(row?.id).toBe(sha256Hex(token));
    expect(row?.id).not.toContain(token);
  });

  it('requireAdmin: member → 403 FORBIDDEN; admin → 200; sem sessão → 401', async () => {
    const a = await setupApp();
    await seedWorkspace(db());
    const admin = await seedUser(db());
    const member = await seedUser(db(), { email: 'bia@exemplo.com', name: 'Bia', role: 'member' });
    const call = async (cookie?: string) =>
      a.inject({ method: 'GET', url: '/api/__test/admin', headers: cookie ? { cookie } : {} });

    const forbidden = await call(await sessionCookieFor(db(), member.id, clock.now()));
    expect(forbidden.statusCode).toBe(403);
    expect(errorResponseSchema.parse(forbidden.json()).error.code).toBe('FORBIDDEN');
    expect((await call(await sessionCookieFor(db(), admin.id, clock.now()))).statusCode).toBe(200);
    expect((await call()).statusCode).toBe(401);
  });

  it('mutação autenticada sem CSRF → 403 CSRF_REJECTED; com CSRF passa', async () => {
    const a = await setupApp();
    await seedWorkspace(db());
    const user = await seedUser(db());
    const cookie = await sessionCookieFor(db(), user.id, clock.now());

    const rejected = await a.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(rejected.statusCode).toBe(403);
    expect(errorResponseSchema.parse(rejected.json()).error.code).toBe('CSRF_REJECTED');
    expect(await db().$count(sessions)).toBe(1);

    const ok = await a.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie, ...csrfHeaders() },
    });
    expect(ok.statusCode).toBe(204);
  });

  it('NODE_ENV=production: cookie __Host-kanban_sid com Secure, HttpOnly, SameSite=Lax, Path=/', async () => {
    const origin = 'https://kanban.example';
    app = await createDbTestApp({
      clock: clock.now,
      envOverrides: {
        NODE_ENV: 'production',
        APP_ORIGIN: origin,
        SETUP_TOKEN: 'codigo-de-setup-de-teste',
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { 'content-type': 'application/json', ...csrfHeaders({ APP_ORIGIN: origin }) },
      payload: {
        workspaceName: 'Ronin',
        name: 'Ana',
        email: 'ana@exemplo.com',
        password: 'senha-muito-segura',
        setupToken: 'codigo-de-setup-de-teste',
      },
    });
    expect(res.statusCode).toBe(201);
    const header = String(res.headers['set-cookie']);
    expect(header).toMatch(/^__Host-kanban_sid=[A-Za-z0-9_-]{43};/);
    expect(header).toContain('Max-Age=2592000');
    expect(header).toContain('Path=/');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
    expect(header).not.toContain('Domain=');

    // Cookie sem prefixo não é aceito em produção.
    const token = header.split(';')[0]?.split('=')[1] ?? '';
    const plain = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `kanban_sid=${token}` },
    });
    expect(plain.statusCode).toBe(401);
    const prefixed = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `__Host-kanban_sid=${token}` },
    });
    expect(prefixed.statusCode).toBe(200);
  });

  it('fora de produção o cookie não usa __Host- nem Secure', async () => {
    app = await createDbTestApp({ clock: clock.now });
    const res = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: jsonMutationHeaders(),
      payload: {
        workspaceName: 'Ronin',
        name: 'Ana',
        email: 'ana@exemplo.com',
        password: 'senha-muito-segura',
        setupToken: 'codigo-de-setup-de-teste',
      },
    });
    expect(res.statusCode).toBe(201);
    const header = String(res.headers['set-cookie']);
    expect(header).toMatch(/^kanban_sid=/);
    expect(header).not.toContain('Secure');
    expect(header).toContain('HttpOnly');
  });
});
