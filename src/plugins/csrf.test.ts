import { errorResponseSchema } from '@raphasparda/ronin-shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, testEnv } from '../../test/app';
import type { App } from '../app';

import { isCsrfAllowed } from './csrf';

const ORIGIN = testEnv().APP_ORIGIN;

describe('isCsrfAllowed', () => {
  it('exige Origin igual ao APP_ORIGIN e X-Kanban-Csrf: 1', () => {
    expect(isCsrfAllowed({ origin: ORIGIN, 'x-kanban-csrf': '1' }, ORIGIN)).toBe(true);
    expect(isCsrfAllowed({ origin: ORIGIN }, ORIGIN)).toBe(false);
    expect(isCsrfAllowed({ origin: ORIGIN, 'x-kanban-csrf': 'true' }, ORIGIN)).toBe(false);
    expect(isCsrfAllowed({ origin: 'https://evil.example', 'x-kanban-csrf': '1' }, ORIGIN)).toBe(
      false,
    );
    expect(isCsrfAllowed({ origin: 'null', 'x-kanban-csrf': '1' }, ORIGIN)).toBe(false);
    expect(isCsrfAllowed({ origin: `${ORIGIN}/`, 'x-kanban-csrf': '1' }, ORIGIN)).toBe(false);
  });

  it('sem Origin, aceita só Sec-Fetch-Site: same-origin', () => {
    expect(isCsrfAllowed({ 'sec-fetch-site': 'same-origin', 'x-kanban-csrf': '1' }, ORIGIN)).toBe(
      true,
    );
    expect(isCsrfAllowed({ 'sec-fetch-site': 'cross-site', 'x-kanban-csrf': '1' }, ORIGIN)).toBe(
      false,
    );
    expect(isCsrfAllowed({ 'x-kanban-csrf': '1' }, ORIGIN)).toBe(false);
  });
});

describe('plugins/csrf', () => {
  let app: App;

  beforeAll(async () => {
    app = await createTestApp();
    app.post('/api/__test/public', { config: { public: true } }, () => ({ ok: true }));
    app.post('/api/__test/private', () => ({ ok: true }));
    app.get('/api/__test/public', { config: { public: true } }, () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (headers: Record<string, string>) =>
    app.inject({ method: 'POST', url: '/api/__test/public', headers });

  it.each([
    ['sem header nem Origin', {}],
    ['sem header', { origin: ORIGIN }],
    ['sem Origin', { 'x-kanban-csrf': '1' }],
    ['Origin de outro site', { origin: 'https://evil.example', 'x-kanban-csrf': '1' }],
  ])('mutação %s → 403 CSRF_REJECTED', async (_label, headers) => {
    const res = await post(headers);
    expect(res.statusCode).toBe(403);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('CSRF_REJECTED');
  });

  it('mutação com Origin e header passa', async () => {
    const res = await post({ origin: ORIGIN, 'x-kanban-csrf': '1' });
    expect(res.statusCode).toBe(200);
  });

  it('CSRF é checado antes do parser (corpo text/plain → 403, não 415)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/__test/public',
      headers: { 'content-type': 'text/plain' },
      payload: 'x',
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET não exige CSRF; rota pública acessível sem sessão', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/__test/public' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('rota autenticada sem sessão → 401 antes do CSRF', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/__test/private' });
    expect(res.statusCode).toBe(401);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('UNAUTHENTICATED');
  });
});
