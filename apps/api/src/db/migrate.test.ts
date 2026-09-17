import { readdirSync } from 'node:fs';

import { afterAll, expect, it } from 'vitest';

import { closeTestDb, describeDb, getTestPool, testDatabaseUrl } from '../../test/db';

import { MIGRATIONS_DIR, runMigrations } from './migrate';

describeDb('runMigrations', () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it('é idempotente: rodar de novo não reaplica nem falha', async () => {
    const count = async () => {
      const { rows } = await getTestPool().query<{ n: number }>(
        'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
      );
      return rows[0]?.n;
    };
    const sqlFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).length;

    // O globalSetup já migrou; duas execuções extras (inclusive concorrentes) não mudam nada.
    const url = testDatabaseUrl ?? '';
    await Promise.all([runMigrations(url), runMigrations(url)]);
    await runMigrations(url);

    expect(await count()).toBe(sqlFiles);
  });
});
