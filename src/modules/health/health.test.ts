import { errorResponseSchema } from '@raphasparda/ronin-shared';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp, testEnv } from '../../../test/app';
import { buildApp, type App } from '../../app';

let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /api/health', () => {
  it('200 { status: ok, db: ok } com o banco respondendo (stub)', async () => {
    app = await createTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('é marcada como pública (config.public)', async () => {
    app = await createTestApp();
    let isPublic: boolean | undefined;
    app.addHook('onRequest', (request, _reply, done) => {
      isPublic = request.routeOptions.config.public;
      done();
    });
    await app.inject({ method: 'GET', url: '/api/health' });
    expect(isPublic).toBe(true);
  });

  it('503 SERVICE_UNAVAILABLE quando a checagem falha (stub)', async () => {
    app = await createTestApp({
      checkDatabase: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5432')),
    });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(errorResponseSchema.strict().parse(res.json()).error.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.body).not.toContain('ECONNREFUSED');
  });

  it('503 com o pool pg real apontando para um banco inacessível', async () => {
    // Sem stub: createPool + SELECT 1 contra 127.0.0.1:1 (conexão recusada).
    app = await buildApp({ env: testEnv() });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('OpenAPI', () => {
  it('fora de produção expõe /api/docs e o documento com /api/health', async () => {
    app = await createTestApp();
    const ui = await app.inject({ method: 'GET', url: '/api/docs/' });
    expect(ui.statusCode).toBe(200);
    const doc = await app.inject({ method: 'GET', url: '/api/docs/json' });
    expect(doc.statusCode).toBe(200);
    const spec = doc.json<{ openapi: string; paths: Record<string, unknown> }>();
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(['/api/health', '/api/setup', '/api/auth/login', '/api/auth/me']),
    );
    expect(Object.keys(spec.paths).some((path) => path.startsWith('/api/docs'))).toBe(false);
  });

  it('em produção /api/docs não existe (404 no envelope)', async () => {
    app = await createTestApp({
      env: testEnv({ NODE_ENV: 'production', APP_ORIGIN: 'https://kanban.example' }),
    });
    for (const url of ['/api/docs', '/api/docs/json']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
      expect(errorResponseSchema.parse(res.json()).error.code).toBe('NOT_FOUND');
    }
  });
});
