import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, csrfHeaders, testEnv } from '../../test/app';
import type { App } from '../app';

const STRICT_CSP = "default-src 'none';base-uri 'none';form-action 'none';frame-ancestors 'none'";

describe('plugins/security-headers', () => {
  let app: App;

  beforeAll(async () => {
    app = await createTestApp();
    app.post('/api/__test/echo', { config: { public: true } }, () => ({ ok: true }));
    app.get('/api/__test/boom', { config: { public: true } }, () => {
      throw new Error('boom');
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('aplica os headers do helmet com CSP restrita', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toBe(STRICT_CSP);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it.each([
    ['GET', '/api/health', 200],
    ['POST', '/api/__test/echo', 200],
    ['GET', '/api/nao-existe', 404],
    ['GET', '/api/__test/boom', 500],
  ] as const)('Cache-Control: no-store em %s %s (%i)', async (method, url, status) => {
    const res = await app.inject({ method, url, headers: csrfHeaders() });
    expect(res.statusCode).toBe(status);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toBe(STRICT_CSP);
  });

  it('no-store também em erro de parser (415)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/__test/echo',
      headers: { 'content-type': 'text/plain', ...csrfHeaders() },
      payload: 'x',
    });
    expect(res.statusCode).toBe(415);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('Swagger UI (fora de produção) usa a CSP própria, sem afrouxar o resto da API', async () => {
    const ui = await app.inject({ method: 'GET', url: '/api/docs/' });
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-security-policy']).toContain("script-src 'self'");
    expect(ui.headers['cache-control']).toBe('no-store');
  });

  it('em produção os headers também valem', async () => {
    const prod = await createTestApp({
      env: testEnv({
        NODE_ENV: 'production',
        APP_ORIGIN: 'https://ronin.example',
        SETUP_TOKEN: 'codigo-de-setup-de-teste',
      }),
    });
    try {
      const res = await prod.inject({ method: 'GET', url: '/api/health' });
      expect(res.headers['content-security-policy']).toBe(STRICT_CSP);
      expect(res.headers['cache-control']).toBe('no-store');
    } finally {
      await prod.close();
    }
  });
});
