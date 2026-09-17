import { authSessionResponseSchema, errorResponseSchema } from '@kanban/shared';
import { afterEach, expect, it } from 'vitest';

import {
  cookieHeaderOf,
  createDbTestApp,
  jsonMutationHeaders,
  seedUser,
  sessionCookieOf,
} from '../../../test/auth';
import { describeDb, useTestDatabase } from '../../../test/db';
import type { App } from '../../app';
import { sessions, users, workspace } from '../../db/schema';

const validBody = {
  workspaceName: '  Ronin  ',
  name: ' Ana ',
  email: '  Ana@Exemplo.COM ',
  password: 'senha-muito-segura',
};

describeDb('módulo setup (kanban_test)', () => {
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
    expect(before.json()).toEqual({ needsSetup: true });

    expect((await postSetup(a, validBody)).statusCode).toBe(201);

    const after = await a.inject({ method: 'GET', url: '/api/setup/status' });
    expect(after.json()).toEqual({ needsSetup: false });
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
