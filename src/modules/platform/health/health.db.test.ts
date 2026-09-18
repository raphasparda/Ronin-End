import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testEnv } from '../../../../test/app';
import { buildApp, type App } from '../../../app';
import { loadDotEnv } from '../../../config/env';

/**
 * Integração com PostgreSQL real (`TEST_DATABASE_URL`). Pulado quando o banco não está
 * acessível (ex.: role `ronin` ainda não criado). A partir da 0.5 o globalSetup garante o banco.
 */
loadDotEnv();
const databaseUrl = process.env.TEST_DATABASE_URL;

async function isReachable(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2_000 });
  // Erros assíncronos do client não podem derrubar o processo de teste.
  client.on('error', () => undefined);
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const reachable = await isReachable(databaseUrl);

describe.skipIf(!reachable)('GET /api/health com PostgreSQL real', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp({ env: testEnv({ DATABASE_URL: databaseUrl ?? '' }) });
  });

  afterAll(async () => {
    await app.close();
  });

  it('200 { status: ok, db: ok }', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
  });
});
