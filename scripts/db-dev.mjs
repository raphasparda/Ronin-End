// pnpm db:dev — sobe o PostgreSQL local de desenvolvimento em primeiro plano. Ctrl+C para parar.
// Idempotente: se já houver um servidor respondendo no DATABASE_URL, avisa e sai.
import { ensureEnvFile, readDevEnv, startDevDatabase } from './dev-db/postgres.mjs';

/** @param {string} message */
const log = (message) => process.stdout.write(`[db] ${message}\n`);

if (ensureEnvFile()) log('.env criado a partir do .env.example');
const { databaseUrl, testDatabaseUrl } = await readDevEnv();

let db;
try {
  db = await startDevDatabase({ databaseUrl, extraUrls: [testDatabaseUrl], log });
} catch (err) {
  log(`erro: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

if (!db.owned) {
  log(
    db.kind === 'shared'
      ? 'o PostgreSQL local já está rodando em outro terminal; nada a fazer.'
      : 'DATABASE_URL já responde (Postgres externo: Docker ou nativo); nada a fazer.',
  );
  process.exit(0);
}

log(`pronto: ${databaseUrl.replace(/:[^:@/]+@/, ':***@')}`);
log('Ctrl+C para parar.');

let closing = false;
/** @param {string} signal */
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  log(`${signal} recebido`);
  await db.stop();
  process.exit(0);
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => void shutdown(signal));
}
// Mantém o processo vivo em primeiro plano.
setInterval(() => undefined, 60_000);
