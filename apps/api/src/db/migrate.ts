import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/** `apps/api/drizzle`: SQL gerado por `drizzle-kit generate` (commitado). */
export const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle',
);

/** Chave do advisory lock que serializa execuções concorrentes (ex.: duas réplicas no deploy). */
const MIGRATION_LOCK_KEY = 72_656_914; // valor arbitrário; só precisa ser fixo.

export interface RunMigrationsOptions {
  migrationsFolder?: string;
}

/**
 * Aplica as migrations pendentes em `connectionString`. Idempotente: o Drizzle registra o que já
 * rodou em `drizzle.__drizzle_migrations` e cada lote roda em transação.
 */
export async function runMigrations(
  connectionString: string,
  options: RunMigrationsOptions = {},
): Promise<void> {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
  client.on('error', () => undefined);
  await client.connect();
  try {
    // NOTICEs do tipo "schema drizzle já existe" não interessam a ninguém.
    await client.query("SET client_min_messages = 'warning'");
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await migrate(drizzle({ client }), {
        migrationsFolder: options.migrationsFolder ?? MIGRATIONS_DIR,
      });
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}

function isEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// CLI: `pnpm db:migrate` (tsx src/db/migrate.ts) aplica em DATABASE_URL.
if (isEntrypoint()) {
  const { loadDotEnv } = await import('../config/env');
  loadDotEnv();
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    process.stderr.write('[migrate] DATABASE_URL não definida (.env ou ambiente)\n');
    process.exit(1);
  }
  const target = new URL(url);
  const label = `${target.hostname}:${target.port || '5432'}${target.pathname}`;
  try {
    await runMigrations(url);
    process.stdout.write(`[migrate] migrations aplicadas em ${label}\n`);
  } catch (err) {
    process.stderr.write(
      `[migrate] falha ao aplicar migrations em ${label}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}
