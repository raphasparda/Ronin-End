import { describe, expect, it } from 'vitest';

import { createTestApp, testEnv } from '../test/app';

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

  describe('TRUST_PROXY → request.ip', () => {
    const ipWith = async (
      trustProxy: string,
      remoteAddress: string,
      forwardedFor?: string,
    ): Promise<string> => {
      const app = await createTestApp({ env: testEnv({ TRUST_PROXY: trustProxy }) });
      try {
        app.get('/api/__test/ip', { config: { public: true } }, (request) => ({ ip: request.ip }));
        const res = await app.inject({
          method: 'GET',
          url: '/api/__test/ip',
          remoteAddress,
          headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
        });
        return res.json<{ ip: string }>().ip;
      } finally {
        await app.close();
      }
    };

    it('false ignora X-Forwarded-For', async () => {
      expect(await ipWith('false', '10.1.2.3', '203.0.113.9')).toBe('10.1.2.3');
    });

    it('true confia em tudo (o primeiro endereço, forjável)', async () => {
      expect(await ipWith('true', '10.1.2.3', '198.51.100.1, 203.0.113.9')).toBe('198.51.100.1');
    });

    it('número de saltos: 1 usa o último endereço do X-Forwarded-For', async () => {
      expect(await ipWith('1', '10.1.2.3', '198.51.100.1, 203.0.113.9')).toBe('203.0.113.9');
      expect(await ipWith('2', '10.1.2.3', '198.51.100.1, 203.0.113.9')).toBe('198.51.100.1');
      expect(await ipWith('1', '10.1.2.3')).toBe('10.1.2.3');
    });

    it('lista de IPs/CIDRs: só proxies da lista são atravessados', async () => {
      expect(await ipWith('10.0.0.0/8', '10.1.2.3', '203.0.113.9')).toBe('203.0.113.9');
      expect(await ipWith('10.0.0.0/8', '192.0.2.50', '203.0.113.9')).toBe('192.0.2.50');
      expect(await ipWith('10.0.0.0/8,127.0.0.1', '127.0.0.1', '203.0.113.9')).toBe('203.0.113.9');
    });
  });
});
