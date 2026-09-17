import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { closeTestDb, describeDb, getTestPool, testDatabaseUrl } from '../../test/db';

import { MIGRATIONS_DIR, resolveMigrationsDir, runMigrations } from './migrate';

describe('resolveMigrationsDir', () => {
  const repo = resolve('/srv/ronin-api');
  const cwd = resolve('/srv/app');

  it('pela fonte (src/db): drizzle/ na raiz do repositório', () => {
    expect(resolveMigrationsDir({ moduleDir: join(repo, 'src', 'db'), cwd })).toBe(
      join(repo, 'drizzle'),
    );
  });

  it('pelo build (dist): <cwd>/drizzle', () => {
    expect(resolveMigrationsDir({ moduleDir: join(repo, 'dist'), cwd })).toBe(join(cwd, 'drizzle'));
  });

  it('MIGRATIONS_DIR tem prioridade e é relativa ao cwd', () => {
    const moduleDir = join(repo, 'dist');
    expect(resolveMigrationsDir({ override: 'sql/migrations', moduleDir, cwd })).toBe(
      join(cwd, 'sql', 'migrations'),
    );
    expect(resolveMigrationsDir({ override: resolve('/opt/drizzle'), moduleDir, cwd })).toBe(
      resolve('/opt/drizzle'),
    );
    expect(resolveMigrationsDir({ override: '  ', moduleDir, cwd })).toBe(join(cwd, 'drizzle'));
  });

  it('o padrão desta execução aponta para a pasta commitada', () => {
    expect(existsSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'))).toBe(true);
  });
});

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
