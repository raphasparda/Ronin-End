import { startDevDatabase } from '../scripts/dev-db/postgres.mjs';
import { loadDotEnv } from '../src/config/env';
import { runMigrations } from '../src/db/migrate';

/**
 * Prepara o PostgreSQL de `TEST_DATABASE_URL` antes dos testes de integração.
 * - Já respondendo (pnpm dev / pnpm db:dev rodando, Docker, nativo ou serviço do CI): reaproveita.
 * - Local (127.0.0.1) e parado: sobe o cluster de `.data/postgres` e o para no final.
 * Em seguida aplica as migrations (idempotente). Sem `TEST_DATABASE_URL`, os testes que precisam
 * de banco são pulados (`describeDb` em test/db.ts).
 */
export default async function setup(): Promise<(() => Promise<void>) | undefined> {
  loadDotEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return undefined;

  const log = (message: string) => process.stdout.write(`[test-db] ${message}\n`);
  const db = await startDevDatabase({ databaseUrl: url, log });
  try {
    await runMigrations(url);
  } catch (err) {
    await db.stop();
    throw err;
  }
  return db.owned ? () => db.stop() : undefined;
}
