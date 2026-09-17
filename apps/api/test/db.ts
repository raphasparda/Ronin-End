import pg from 'pg';
import { afterAll, beforeEach, describe } from 'vitest';

import { loadDotEnv } from '../src/config/env';
import { createDb, type Database } from '../src/db/client';

loadDotEnv();

/** Banco de testes (`kanban_test`). Migrado pelo globalSetup antes de qualquer arquivo rodar. */
export const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() || undefined;

/** `describe` que só roda com `TEST_DATABASE_URL` definida (o CI e o dev local sempre definem). */
export const describeDb = describe.skipIf(!testDatabaseUrl);

let pool: pg.Pool | undefined;
let db: Database | undefined;
let tables: string[] | undefined;

/** Pool compartilhado pelos testes de um arquivo (fechado por `useTestDatabase`). */
export function getTestPool(): pg.Pool {
  if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL não definida');
  if (!pool) {
    pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 5 });
    pool.on('error', () => undefined);
  }
  return pool;
}

export function getTestDb(): Database {
  db ??= createDb(getTestPool());
  return db;
}

/**
 * Esvazia todas as tabelas do schema `public` (a tabela de migrations fica no schema `drizzle`
 * e é preservada). Novas tabelas entram automaticamente.
 */
export async function truncateAll(): Promise<void> {
  const client = getTestPool();
  if (!tables) {
    const { rows } = await client.query<{ name: string }>(
      `SELECT format('%I.%I', schemaname, tablename) AS name
         FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    tables = rows.map((r) => r.name);
  }
  if (tables.length === 0) return;
  await client.query(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}

export async function closeTestDb(): Promise<void> {
  const current = pool;
  pool = undefined;
  db = undefined;
  await current?.end();
}

/**
 * Registra, no arquivo de teste que chamar: `truncateAll()` antes de cada teste e fechamento do
 * pool no final. Chame dentro de um `describeDb`.
 */
export function useTestDatabase(): { db: () => Database; pool: () => pg.Pool } {
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });
  return { db: getTestDb, pool: getTestPool };
}

/** Código SQLSTATE e constraint de um erro do `pg` (direto ou embrulhado pelo Drizzle em `cause`). */
export function pgErrorOf(err: unknown): { code?: string; constraint?: string } {
  let current: unknown = err;
  for (let depth = 0; depth < 3 && current instanceof Error; depth++) {
    const candidate = current as Error & { code?: unknown; constraint?: unknown };
    if (typeof candidate.code === 'string') {
      return {
        code: candidate.code,
        constraint: typeof candidate.constraint === 'string' ? candidate.constraint : undefined,
      };
    }
    current = candidate.cause;
  }
  return {};
}
