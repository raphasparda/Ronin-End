import { describe, expect, it } from 'vitest';

import { createTestApp } from '../test/app';

describe('buildApp', () => {
  it('decora clock com o relógio padrão', async () => {
    const app = await createTestApp();
    const before = Date.now();
    const now = app.clock();
    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    await app.close();
  });

  it('aceita um relógio substituto (testes)', async () => {
    const fixed = new Date('2026-09-16T14:03:00.000Z');
    const app = await createTestApp({ clock: () => fixed });
    app.get('/api/__test/now', { config: { public: true } }, (request) => ({
      now: request.server.clock().toISOString(),
    }));
    const res = await app.inject({ method: 'GET', url: '/api/__test/now' });
    expect(res.json()).toEqual({ now: '2026-09-16T14:03:00.000Z' });
    await app.close();
  });

  it('gera request id próprio e ignora o enviado pelo cliente', async () => {
    const app = await createTestApp();
    app.get('/api/__test/id', { config: { public: true } }, (request) => ({ id: request.id }));
    const res = await app.inject({
      method: 'GET',
      url: '/api/__test/id',
      headers: { 'request-id': 'forjado' },
    });
    expect(res.json<{ id: string }>().id).toMatch(/^[0-9a-f-]{36}$/);
    await app.close();
  });
});
