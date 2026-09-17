import { authSessionResponseSchema, errorResponseSchema } from '@raphasparda/ronin-shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { csrfHeaders } from '../../../test/app';
import {
  cookieHeaderOf,
  createDbTestApp,
  createTestClock,
  DEFAULT_PASSWORD,
  jsonMutationHeaders,
  seedUser,
  seedWorkspace,
  sessionCookieOf,
  countingPasswords,
} from '../../../test/auth';
import { describeDb, useTestDatabase } from '../../../test/db';
import type { App } from '../../app';
import { authThrottle, sessions, users } from '../../db/schema';
import type { PasswordHasher } from '../../lib/password';
import { sha256Hex } from '../../lib/tokens';
import { LOGIN_ROUTE_RATE_LIMIT } from '../../plugins/rate-limit';

import { INVALID_CREDENTIALS_MESSAGE } from './service';
import { LOGIN_THROTTLE } from './throttle';

describeDb('módulo auth (kanban_test)', () => {
  const { db } = useTestDatabase();
  let app: App | undefined;
  const clock = createTestClock();

  afterEach(async () => {
    await app?.close();
    app = undefined;
    clock.set(new Date('2026-09-16T12:00:00.000Z'));
  });

  async function start(passwords?: PasswordHasher): Promise<App> {
    app = await createDbTestApp({ clock: clock.now, ...(passwords ? { passwords } : {}) });
    return app;
  }

  async function seeded(passwords?: PasswordHasher): Promise<{ a: App; userId: string }> {
    const a = await start(passwords);
    await seedWorkspace(db());
    const user = await seedUser(db());
    return { a, userId: user.id };
  }

  const login = (
    a: App,
    payload: unknown,
    extra: { cookie?: string; remoteAddress?: string; headers?: Record<string, string> } = {},
  ) =>
    a.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: extra.headers ?? jsonMutationHeaders(extra.cookie ? { cookie: extra.cookie } : {}),
      payload: JSON.stringify(payload),
      ...(extra.remoteAddress ? { remoteAddress: extra.remoteAddress } : {}),
    });

  const good = { email: 'ana@exemplo.com', password: DEFAULT_PASSWORD };

  describe('POST /api/auth/login', () => {
    it('200 com { user, workspace } e cookie de sessão; e-mail normalizado', async () => {
      const { a, userId } = await seeded();
      const res = await login(a, { email: '  ANA@exemplo.com ', password: DEFAULT_PASSWORD });
      expect(res.statusCode).toBe(200);
      expect(authSessionResponseSchema.strict().parse(res.json())).toEqual({
        user: { id: userId, name: 'Ana', email: 'ana@exemplo.com', role: 'admin' },
        workspace: { name: 'Ronin', timezone: 'America/Sao_Paulo' },
        features: { boardCovers: false },
      });
      const cookie = sessionCookieOf(res);
      expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const [row] = await db().select().from(sessions);
      expect(row?.id).toBe(sha256Hex(cookie?.value ?? ''));
    });

    it('resposta idêntica para e-mail inexistente, senha errada e usuário desativado', async () => {
      const { a, userId } = await seeded();
      const unknown = await login(a, { email: 'ninguem@exemplo.com', password: DEFAULT_PASSWORD });
      const wrong = await login(a, { email: 'ana@exemplo.com', password: 'senha-errada-demais' });
      await db().update(users).set({ status: 'deactivated' }).where(eq(users.id, userId));
      const deactivated = await login(a, good);

      for (const res of [unknown, wrong, deactivated]) {
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({
          error: { code: 'INVALID_CREDENTIALS', message: INVALID_CREDENTIALS_MESSAGE },
        });
        expect(res.headers['set-cookie']).toBeUndefined();
      }
      expect(unknown.body).toBe(wrong.body);
      expect(wrong.body).toBe(deactivated.body);
      expect(await db().$count(sessions)).toBe(0);
    });

    it('6ª tentativa para o mesmo e-mail → 429 TOO_MANY_ATTEMPTS com Retry-After (inclusive com a senha certa)', async () => {
      const { a } = await seeded();
      for (let i = 0; i < LOGIN_THROTTLE.emailMaxFailures; i++) {
        const res = await login(a, { email: 'ana@exemplo.com', password: `errada-${i}-xxxxx` });
        expect(res.statusCode).toBe(401);
      }
      const sixth = await login(a, good);
      expect(sixth.statusCode).toBe(429);
      expect(errorResponseSchema.parse(sixth.json()).error.code).toBe('TOO_MANY_ATTEMPTS');
      expect(sixth.headers['retry-after']).toBe(String(15 * 60));
      expect(sixth.headers['set-cookie']).toBeUndefined();

      clock.advance(5 * 60_000);
      const later = await login(a, good);
      expect(later.statusCode).toBe(429);
      expect(later.headers['retry-after']).toBe(String(10 * 60));

      // O bloqueio é por e-mail: outro e-mail do mesmo IP não é afetado.
      const other = await login(a, { email: 'bia@exemplo.com', password: DEFAULT_PASSWORD });
      expect(other.statusCode).toBe(401);

      // Terminado o bloqueio, a senha certa entra.
      clock.advance(10 * 60_000);
      expect((await login(a, good)).statusCode).toBe(200);
    });

    it('bloqueio persiste no banco (vale para outra instância da API)', async () => {
      const { a } = await seeded();
      for (let i = 0; i < LOGIN_THROTTLE.emailMaxFailures; i++) {
        await login(a, { email: 'ana@exemplo.com', password: 'senha-errada-demais' });
      }
      const [row] = await db()
        .select()
        .from(authThrottle)
        .where(eq(authThrottle.key, 'email:ana@exemplo.com'));
      expect(row?.failures).toBe(5);
      expect(row?.lockedUntil?.getTime()).toBe(clock.now().getTime() + LOGIN_THROTTLE.lockMs);

      const other = await createDbTestApp({ clock: clock.now });
      try {
        expect((await login(other, good)).statusCode).toBe(429);
      } finally {
        await other.close();
      }
    });

    it('sucesso zera o contador do e-mail', async () => {
      const { a } = await seeded();
      for (let i = 0; i < LOGIN_THROTTLE.emailMaxFailures - 1; i++) {
        expect((await login(a, { ...good, password: 'senha-errada-demais' })).statusCode).toBe(401);
      }
      expect((await login(a, good)).statusCode).toBe(200);
      const emailRows = await db()
        .select()
        .from(authThrottle)
        .where(eq(authThrottle.key, 'email:ana@exemplo.com'));
      expect(emailRows).toHaveLength(0);

      // Depois do reset, mais 4 falhas ainda não bloqueiam.
      for (let i = 0; i < LOGIN_THROTTLE.emailMaxFailures - 1; i++) {
        expect((await login(a, { ...good, password: 'senha-errada-demais' })).statusCode).toBe(401);
      }
      expect((await login(a, good)).statusCode).toBe(200);
    });

    it('janela de 15 min: falhas antigas não somam', async () => {
      const { a } = await seeded();
      for (let i = 0; i < LOGIN_THROTTLE.emailMaxFailures - 1; i++) {
        await login(a, { ...good, password: 'senha-errada-demais' });
      }
      clock.advance(LOGIN_THROTTLE.windowMs);
      expect((await login(a, { ...good, password: 'senha-errada-demais' })).statusCode).toBe(401);
      expect((await login(a, good)).statusCode).toBe(200);
    });

    it('bloqueio por IP: 20 falhas (e-mails variados) → 429 para qualquer e-mail desse IP', async () => {
      const { a } = await seeded();
      const ip = '198.51.100.20';
      for (let i = 0; i < LOGIN_THROTTLE.ipMaxFailures; i++) {
        const res = await login(
          a,
          { email: `pessoa${i}@exemplo.com`, password: 'senha-errada-demais' },
          { remoteAddress: ip },
        );
        expect(res.statusCode).toBe(401);
      }
      const blocked = await login(a, good, { remoteAddress: ip });
      expect(blocked.statusCode).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBe(15 * 60);

      // Outro IP segue normal.
      expect((await login(a, good, { remoteAddress: '198.51.100.21' })).statusCode).toBe(200);
    });

    it('rajada paralela de 30 senhas erradas: no máximo 5 chegam ao Argon2, o resto → 429; senha certa depois → 429', async () => {
      const { hasher, count } = countingPasswords();
      const { a } = await seeded(hasher);
      const burst = LOGIN_ROUTE_RATE_LIMIT.max;
      const results = await Promise.all(
        Array.from({ length: burst }, (_, i) =>
          login(a, { email: 'ana@exemplo.com', password: `errada-${i}-xxxxx` }),
        ),
      );

      const codes = results.map((r) => errorResponseSchema.parse(r.json()).error.code);
      const invalid = codes.filter((c) => c === 'INVALID_CREDENTIALS').length;
      const blocked = codes.filter((c) => c === 'TOO_MANY_ATTEMPTS').length;
      expect(count()).toBeLessThanOrEqual(LOGIN_THROTTLE.emailMaxFailures);
      expect(invalid).toBe(count());
      expect(invalid).toBe(LOGIN_THROTTLE.emailMaxFailures);
      expect(blocked).toBe(burst - invalid);
      for (const res of results) expect([401, 429]).toContain(res.statusCode);

      // Senha certa depois do bloqueio (de outro IP, fora do limite de rota): 429 pelo e-mail.
      const correct = await login(a, good, { remoteAddress: '198.51.100.99' });
      expect(correct.statusCode).toBe(429);
      expect(errorResponseSchema.parse(correct.json()).error.code).toBe('TOO_MANY_ATTEMPTS');
      expect(correct.headers['set-cookie']).toBeUndefined();
      expect(count()).toBe(LOGIN_THROTTLE.emailMaxFailures);

      // As recusadas pelo e-mail nem reservam no IP: só as 5 verificadas contaram.
      const [ipRow] = await db()
        .select()
        .from(authThrottle)
        .where(eq(authThrottle.key, 'ip:127.0.0.1'));
      expect(ipRow).toMatchObject({ failures: LOGIN_THROTTLE.emailMaxFailures, lockedUntil: null });
      expect(await db().$count(sessions)).toBe(0);
    });

    it('rajada paralela com a senha certa no meio de erradas, depois do bloqueio → 429', async () => {
      const { hasher, count } = countingPasswords();
      const { a } = await seeded(hasher);
      const wrong = (i: number) => login(a, { ...good, password: `errada-${i}-xxxxx` });
      const first = await Promise.all(
        Array.from({ length: LOGIN_THROTTLE.emailMaxFailures + 5 }, (_, i) => wrong(i)),
      );
      expect(first.filter((r) => r.statusCode === 401)).toHaveLength(
        LOGIN_THROTTLE.emailMaxFailures,
      );
      const second = await Promise.all([wrong(100), login(a, good), wrong(101), login(a, good)]);
      for (const res of second) {
        expect(res.statusCode).toBe(429);
        expect(errorResponseSchema.parse(res.json()).error.code).toBe('TOO_MANY_ATTEMPTS');
      }
      expect(count()).toBe(LOGIN_THROTTLE.emailMaxFailures);
    });

    it('rajada paralela de e-mails variados: no máximo 20 chegam ao Argon2 (bloqueio por IP)', async () => {
      const { hasher, count } = countingPasswords();
      const { a } = await seeded(hasher);
      const results = await Promise.all(
        Array.from({ length: LOGIN_ROUTE_RATE_LIMIT.max }, (_, i) =>
          login(a, { email: `pessoa${i}@exemplo.com`, password: 'senha-errada-demais' }),
        ),
      );
      expect(count()).toBe(LOGIN_THROTTLE.ipMaxFailures);
      expect(results.filter((r) => r.statusCode === 401)).toHaveLength(
        LOGIN_THROTTLE.ipMaxFailures,
      );
      expect(results.filter((r) => r.statusCode === 429)).toHaveLength(
        LOGIN_ROUTE_RATE_LIMIT.max - LOGIN_THROTTLE.ipMaxFailures,
      );
      // As recusadas pelo IP devolveram a reserva do e-mail: só as 20 verificadas contaram.
      const rows = await db().select().from(authThrottle);
      const emailFailures = rows
        .filter((r) => r.key.startsWith('email:'))
        .reduce((sum, r) => sum + r.failures, 0);
      expect(emailFailures).toBe(LOGIN_THROTTLE.ipMaxFailures);
    });

    it('login com sucesso não conta no IP e não zera as falhas do IP', async () => {
      const { a } = await seeded();
      const ip = '198.51.100.30';
      await login(a, { ...good, password: 'senha-errada-demais' }, { remoteAddress: ip });
      for (let i = 0; i < LOGIN_THROTTLE.ipMaxFailures + 1; i++) {
        expect((await login(a, good, { remoteAddress: ip })).statusCode).toBe(200);
      }
      const [ipRow] = await db()
        .select()
        .from(authThrottle)
        .where(eq(authThrottle.key, `ip:${ip}`));
      expect(ipRow).toMatchObject({ failures: 1, lockedUntil: null });
    });

    it('limite de rota: 30 req/min por IP → 31ª 429 RATE_LIMITED; outro IP segue', async () => {
      expect(LOGIN_ROUTE_RATE_LIMIT).toEqual({ max: 30, timeWindowMs: 60_000 });
      const { a } = await seeded();
      // Corpo inválido: não chega ao serviço, mas conta no limite de rota.
      for (let i = 0; i < LOGIN_ROUTE_RATE_LIMIT.max; i++) {
        expect((await login(a, { email: 'x', password: '' })).statusCode).toBe(400);
      }
      const limited = await login(a, good);
      expect(limited.statusCode).toBe(429);
      expect(errorResponseSchema.parse(limited.json()).error.code).toBe('RATE_LIMITED');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect((await login(a, good, { remoteAddress: '198.51.100.40' })).statusCode).toBe(200);
    });

    it('nova sessão a cada login; a sessão anterior do mesmo navegador é descartada', async () => {
      const { a } = await seeded();
      const first = await login(a, good);
      const firstCookie = cookieHeaderOf(first);

      const second = await login(a, good, { cookie: firstCookie });
      expect(second.statusCode).toBe(200);
      const secondCookie = cookieHeaderOf(second);
      expect(secondCookie).not.toBe(firstCookie);

      const third = await login(a, good); // outro navegador
      expect(cookieHeaderOf(third)).not.toBe(secondCookie);

      expect(await db().$count(sessions)).toBe(2);
      const meOld = await a.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: firstCookie },
      });
      expect(meOld.statusCode).toBe(401);
      for (const cookie of [secondCookie, cookieHeaderOf(third)]) {
        const res = await a.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
        expect(res.statusCode).toBe(200);
      }
    });

    it('sem usuários → 404 SETUP_REQUIRED', async () => {
      const a = await start();
      const res = await login(a, good);
      expect(res.statusCode).toBe(404);
      expect(errorResponseSchema.parse(res.json()).error.code).toBe('SETUP_REQUIRED');
    });

    it('entrada inválida → 400 VALIDATION_ERROR (senha de login: 1–256, sem política)', async () => {
      const { a } = await seeded();
      const res = await login(a, { email: 'x', password: '' });
      expect(res.statusCode).toBe(400);
      const { error } = errorResponseSchema.parse(res.json());
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details?.map((d) => d.path).sort()).toEqual(['email', 'password']);

      // Senha curta (fora da política de cadastro) não gera 400: vira credencial inválida.
      expect((await login(a, { ...good, password: 'curta' })).statusCode).toBe(401);
      // Nada foi contado para entrada inválida.
      expect(await db().$count(authThrottle, eq(authThrottle.key, 'email:ana@exemplo.com'))).toBe(
        1,
      );
    });

    it('sem CSRF → 403 CSRF_REJECTED', async () => {
      const { a } = await seeded();
      const res = await login(a, good, { headers: { 'content-type': 'application/json' } });
      expect(res.statusCode).toBe(403);
      expect(errorResponseSchema.parse(res.json()).error.code).toBe('CSRF_REJECTED');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('204, apaga a sessão no servidor e limpa o cookie; cookie antigo → 401', async () => {
      const { a } = await seeded();
      const cookie = cookieHeaderOf(await login(a, good));

      const res = await a.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { cookie, ...csrfHeaders() },
      });
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
      expect(sessionCookieOf(res)?.value).toBe('');
      expect(await db().$count(sessions)).toBe(0);

      const me = await a.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
      expect(me.statusCode).toBe(401);
    });

    it('sem sessão também 204 (idempotente)', async () => {
      const a = await start();
      const res = await a.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: csrfHeaders(),
      });
      expect(res.statusCode).toBe(204);
    });

    it('sem CSRF → 403 e a sessão continua válida', async () => {
      const { a } = await seeded();
      const cookie = cookieHeaderOf(await login(a, good));
      const res = await a.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
      expect(res.statusCode).toBe(403);
      expect(await db().$count(sessions)).toBe(1);
    });
  });

  describe('GET /api/auth/me', () => {
    it('200 com a sessão; 401 sem', async () => {
      const { a, userId } = await seeded();
      const cookie = cookieHeaderOf(await login(a, good));
      const res = await a.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(authSessionResponseSchema.strict().parse(res.json()).user.id).toBe(userId);

      const anon = await a.inject({ method: 'GET', url: '/api/auth/me' });
      expect(anon.statusCode).toBe(401);
      expect(errorResponseSchema.parse(anon.json()).error.code).toBe('UNAUTHENTICATED');
    });
  });
});
