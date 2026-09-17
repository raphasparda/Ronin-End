import { errorResponseSchema } from '@raphasparda/ronin-shared';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../../test/app';
import type { App } from '../app';

import { GENERAL_RATE_LIMIT } from './rate-limit';

describe('plugins/rate-limit', () => {
  let app: App | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('limite geral de 600/min: a 601ª requisição → 429 RATE_LIMITED com Retry-After', async () => {
    expect(GENERAL_RATE_LIMIT).toEqual({ max: 600, timeWindowMs: 60_000 });
    app = await createTestApp();

    for (let i = 0; i < GENERAL_RATE_LIMIT.max; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
    }
    const blocked = await app.inject({ method: 'GET', url: '/api/health' });
    expect(blocked.statusCode).toBe(429);
    expect(errorResponseSchema.parse(blocked.json()).error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.headers['cache-control']).toBe('no-store');

    // Outro IP tem contador próprio.
    const other = await app.inject({
      method: 'GET',
      url: '/api/health',
      remoteAddress: '203.0.113.9',
    });
    expect(other.statusCode).toBe(200);
  });
});
