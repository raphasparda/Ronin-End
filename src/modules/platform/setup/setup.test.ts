import { authSessionResponseSchema, errorResponseSchema } from '@raphasparda/ronin-shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cookieHeaderOf,
  createDbTestApp,
  jsonMutationHeaders,
  seedUser,
  sessionCookieOf,
  testPasswords,
} from '../../../../test/auth';
import { describeDb, useTestDatabase } from '../../../../test/db';
import type { App } from '../../../app';
import { sessions, users, workspace } from '../../../db/schema';
import type { PasswordHasher } from '../../../lib/password';

import { isSetupTokenValid } from './service';

const SETUP_TOKEN = 'codigo-de-setup-com-32-caracteres';

describe('isSetupTokenValid', () => {
  it('sem SETUP_TOKEN configurado, qualquer entrada passa', () => {
    expect(isSetupTokenValid(undefined, undefined)).toBe(true);
    expect(isSetupTokenValid(undefined, 'qualquer')).toBe(true);
  });

  it('com SETUP_TOKEN, exige o código exato (tamanhos diferentes não lançam)', () => {
    expect(isSetupTokenValid(SETUP_TOKEN, SETUP_TOKEN)).toBe(true);
    expect(isSetupTokenValid(SETUP_TOKEN, undefined)).toBe(false);
    expect(isSetupTokenValid(SETUP_TOKEN, '')).toBe(false);
    expect(isSetupTokenValid(SETUP_TOKEN, 'x')).toBe(false);
    expect(isSetupTokenValid(SETUP_TOKEN, `${SETUP_TOKEN} `)).toBe(false);
    expect(isSetupTokenValid(SETUP_TOKEN, SETUP_TOKEN.toUpperCase())).toBe(false);
  });
});

const validBody = {
  workspaceName: '  Ronin  ',
  name: ' Ana ',
  email: '  Ana@Exemplo.COM ',
  password: 'senha-muito-segura',
};

describeDb('módulo setup (ronin_test)', () => {
  const { db } = useTestDatabase();
  let app: App | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const start = async () => {
    app = await createDbTestApp();
    return app;
  };

  const postSetup = (a: App, payload: unknown, headers = jsonMutationHeaders()) =>
    a.inject({ method: 'POST', url: '/api/setup', headers, payload: JSON.stringify(payload) });

  it('GET /api/setup/status: pública; true sem usuários, false depois do setup', async () => {
    const a = await start();
    const before = await a.inject({ method: 'GET', url: '/api/setup/status' });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toEqual({ needsSetup: true, requiresSetupToken: false });

    expect((await postSetup(a, validBody)).statusCode).toBe(201);

    const after = await a.inject({ method: 'GET', url: '/api/setup/status' });
    expect(after.json()).toEqual({ needsSetup: false, requiresSetupToken: false });
  });

  describe('com SETUP_TOKEN configurado', () => {
    const startWithToken = async (passwords?: PasswordHasher) => {
      app = await createDbTestApp({
        envOverrides: { SETUP_TOKEN },
        ...(passwords ? { passwords } : {}),
      });
      return app;
    };

    it('GET /api/setup/status informa requiresSetupToken: true', async () => {
      const a = await startWithToken();
      const res = await a.inject({ method: 'GET', url: '/api/setup/status' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ needsSetup: true, requiresSetupToken: true });
      expect(res.body).not.toContain(SETUP_TOKEN);
    });

    it.each([
      ['sem código', undefined],
      ['com código errado', 'codigo-errado-com-32-caracteres!'],
      ['com código vazio', ''],
    ])(
      'POST /api/setup %s → 403 SETUP_TOKEN_INVALID, sem hash e sem criar nada',
      async (_, token) => {
        const hash = vi.fn((password: string) => testPasswords.hash(password));
        const a = await startWithToken({ ...testPasswords, hash });
        const res = await postSetup(
          a,
          token === undefined ? validBody : { ...validBody, setupToken: token },
        );
        expect(res.statusCode).toBe(403);
        expect(errorResponseSchema.strict().parse(res.json())).toEqual({
          error: { code: 'SETUP_TOKEN_INVALID', message: 'Código de configuração inválido.' },
        });
        expect(hash).not.toHaveBeenCalled();
        expect(res.headers['set-cookie']).toBeUndefined();
        expect(await db().$count(users)).toBe(0);
        expect(await db().$count(workspace)).toBe(0);
      },
    );

    it('POST /api/setup com o código certo → 201 e cria o Admin', async () => {
      const a = await startWithToken();
      const res = await postSetup(a, { ...validBody, setupToken: SETUP_TOKEN });
      expect(res.statusCode).toBe(201);
      expect(authSessionResponseSchema.strict().parse(res.json()).user.role).toBe('admin');
      expect(sessionCookieOf(res)).toBeDefined();
      expect(await db().$count(users)).toBe(1);

      const status = await a.inject({ method: 'GET', url: '/api/setup/status' });
      expect(status.json()).toEqual({ needsSetup: false, requiresSetupToken: true });
    });

    it('código acima de 200 caracteres → 400 VALIDATION_ERROR', async () => {
      const a = await startWithToken();
      const res = await postSetup(a, { ...validBody, setupToken: 'a'.repeat(201) });
      expect(res.statusCode).toBe(400);
      expect(errorResponseSchema.parse(res.json()).error.details?.[0]?.path).toBe('setupToken');
    });

    it('tentativas com código errado contam no rate limit (5 / 15 min por IP)', async () => {
      const a = await startWithToken();
      const wrong = { ...validBody, setupToken: 'codigo-errado-com-32-caracteres!' };
      for (let i = 0; i < 5; i++) {
        expect((await postSetup(a, wrong)).statusCode).toBe(403);
      }
      const blocked = await postSetup(a, { ...validBody, setupToken: SETUP_TOKEN });
      expect(blocked.statusCode).toBe(429);
      expect(errorResponseSchema.parse(blocked.json()).error.code).toBe('RATE_LIMITED');
      expect(await db().$count(users)).toBe(0);
    });
  });

  it('POST /api/setup: 201, cria workspace + Admin normalizado + sessão, e grava o cookie', async () => {
    const a = await start();
    const res = await postSetup(a, validBody);
    expect(res.statusCode).toBe(201);
    const body = authSessionResponseSchema.strict().parse(res.json());
    expect(body).toMatchObject({
      user: { name: 'Ana', email: 'ana@exemplo.com', role: 'admin' },
      workspace: { name: 'Ronin', timezone: 'America/Sao_Paulo' },
    });

    const [user] = await db().select().from(users);
    expect(user).toMatchObject({ email: 'ana@exemplo.com', role: 'admin', status: 'active' });
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(res.body).not.toContain('argon2');
    expect(await db().$count(workspace)).toBe(1);
    expect(await db().$count(sessions)).toBe(1);

    const cookie = sessionCookieOf(res);
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie?.maxAge).toBe(30 * 86_400);

    const me = await a.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookieHeaderOf(res) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual(body);
  });

  it('aceita fuso informado', async () => {
    const a = await start();
    const res = await postSetup(a, { ...validBody, timezone: 'America/Manaus' });
    expect(res.json()).toMatchObject({ workspace: { timezone: 'America/Manaus' } });
  });

  it('já configurada → 409 SETUP_ALREADY_DONE (sem criar nada)', async () => {
    const a = await start();
    await seedUser(db(), { email: 'existente@exemplo.com' });
    const res = await postSetup(a, validBody);
    expect(res.statusCode).toBe(409);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('SETUP_ALREADY_DONE');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await db().$count(users)).toBe(1);
    expect(await db().$count(workspace)).toBe(0);
  });

  it('duas chamadas concorrentes → só uma cria (a outra 409)', async () => {
    const a = await start();
    const results = await Promise.all([
      postSetup(a, validBody),
      postSetup(a, { ...validBody, email: 'bia@exemplo.com', name: 'Bia' }),
    ]);
    const statuses = results.map((r) => r.statusCode).sort();
    expect(statuses).toEqual([201, 409]);
    const conflict = results.find((r) => r.statusCode === 409);
    expect(errorResponseSchema.parse(conflict?.json()).error.code).toBe('SETUP_ALREADY_DONE');
    expect(await db().$count(users)).toBe(1);
    expect(await db().$count(sessions)).toBe(1);
    expect(await db().$count(workspace)).toBe(1);
  });

  it('entrada inválida → 400 VALIDATION_ERROR com details', async () => {
    const a = await start();
    const res = await postSetup(a, {
      workspaceName: '',
      name: 'Ana',
      email: 'nao-e-email',
      password: 'curta',
      timezone: 'Marte/Olympus',
    });
    expect(res.statusCode).toBe(400);
    const { error } = errorResponseSchema.parse(res.json());
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details?.map((d) => d.path).sort()).toEqual(
      ['email', 'password', 'timezone', 'workspaceName'].sort(),
    );
    expect(await db().$count(users)).toBe(0);
  });

  it('senha igual ao e-mail → 400', async () => {
    const a = await start();
    const res = await postSetup(a, { ...validBody, password: 'ana@exemplo.com' });
    expect(res.statusCode).toBe(400);
    expect(errorResponseSchema.parse(res.json()).error.details?.[0]?.path).toBe('password');
  });

  it('sem CSRF → 403 CSRF_REJECTED', async () => {
    const a = await start();
    const res = await postSetup(a, validBody, { 'content-type': 'application/json' });
    expect(res.statusCode).toBe(403);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('CSRF_REJECTED');
    expect(await db().$count(users)).toBe(0);
  });

  it('rate limit 5 / 15 min por IP → 429 RATE_LIMITED com Retry-After', async () => {
    const a = await start();
    await seedUser(db());
    for (let i = 0; i < 5; i++) {
      expect((await postSetup(a, validBody)).statusCode).toBe(409);
    }
    const blocked = await postSetup(a, validBody);
    expect(blocked.statusCode).toBe(429);
    expect(errorResponseSchema.parse(blocked.json()).error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(14 * 60);

    // O status continua acessível (contador separado).
    expect((await a.inject({ method: 'GET', url: '/api/setup/status' })).statusCode).toBe(200);
  });
});
