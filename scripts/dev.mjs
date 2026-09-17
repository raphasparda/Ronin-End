// pnpm dev — sobe tudo para desenvolvimento: PostgreSQL local (5433) -> migrations -> API (3000)
// + web (5310). A API e o web só sobem depois que o banco responde e as migrations foram aplicadas.
// Ctrl+C (ou fechar o terminal) derruba tudo e para o banco com `pg_ctl stop -m fast`. Se o banco já estiver rodando (pnpm db:dev em outro
// terminal, Docker ou nativo), ele é reaproveitado e não é parado na saída.
import { spawn, spawnSync } from 'node:child_process';

import { ROOT, ensureEnvFile, readDevEnv, startDevDatabase } from './dev-db/postgres.mjs';

/** @param {string} message */
const log = (message) => process.stdout.write(`[dev] ${message}\n`);

if (ensureEnvFile()) log('.env criado a partir do .env.example');
const { databaseUrl, testDatabaseUrl } = await readDevEnv();

/** @type {import('./dev-db/postgres.mjs').DevDatabase | undefined} */
let db;
/** @type {import('node:child_process').ChildProcess | undefined} */
let app;
let closing = false;

/** @param {number} code */
async function shutdown(code) {
  if (closing) return;
  closing = true;
  if (app && app.exitCode === null && app.signalCode === null) {
    const exited = new Promise((resolvePromise) => app?.once('exit', resolvePromise));
    // No Ctrl+C do console o filho já recebeu o sinal; dá um tempo para encerrar sozinho.
    const graceful = await Promise.race([
      exited.then(() => true),
      new Promise((r) => setTimeout(() => r(false), 4_000)),
    ]);
    if (!graceful && app.pid) {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        app.kill('SIGKILL');
      }
    }
  }
  await db?.stop();
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => {
    log(`${signal} recebido, encerrando...`);
    // Fora do console (ex.: kill do processo), o sinal não chega aos filhos: repassa.
    if (process.platform !== 'win32') app?.kill('SIGINT');
    void shutdown(0);
  });
}

try {
  db = await startDevDatabase({
    databaseUrl,
    extraUrls: [testDatabaseUrl],
    log: (message) => process.stdout.write(`[db] ${message}\n`),
  });
} catch (err) {
  log(`erro ao preparar o banco: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
log(
  {
    started: 'PostgreSQL local iniciado.',
    adopted: 'PostgreSQL local já estava rodando sem dono; assumido.',
    shared: 'PostgreSQL local já rodando (pnpm db:dev em outro terminal); reaproveitado.',
    external: 'DATABASE_URL já responde (Docker/nativo); reaproveitado.',
  }[db.kind],
);

/**
 * Roda `pnpm <args>` herdando o terminal. Usa o mesmo pnpm que chamou este script quando possível.
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 */
function spawnPnpm(args, env = process.env) {
  const execPath = process.env.npm_execpath;
  return execPath && /\.c?js$/.test(execPath)
    ? spawn(process.execPath, [execPath, ...args], { cwd: ROOT, stdio: 'inherit', env })
    : spawn(`pnpm ${args.join(' ')}`, { cwd: ROOT, stdio: 'inherit', shell: true, env });
}

// Migrations antes da API: quem testa nunca precisa rodar `pnpm db:migrate` à mão. Idempotente.
log('aplicando migrations...');
/** @type {import('node:child_process').ChildProcess} */
const migrator = spawnPnpm(['--filter', '@kanban/api', 'run', 'db:migrate'], {
  ...process.env,
  DATABASE_URL: databaseUrl,
});
const migrateCode = await new Promise((resolvePromise) => {
  migrator.on('error', () => resolvePromise(1));
  migrator.on('exit', (code) => resolvePromise(code ?? 1));
});
if (closing) await new Promise(() => undefined); // Ctrl+C durante a migration: shutdown() encerra.
if (migrateCode !== 0) {
  log(`migrations falharam (código ${migrateCode}); API e web não foram iniciadas.`);
  await shutdown(1);
}

app = spawnPnpm(['--parallel', '--filter', '@kanban/api', '--filter', '@kanban/web', 'run', 'dev']);

log('API: http://127.0.0.1:3000/api/health  |  Web: http://127.0.0.1:5310  |  Ctrl+C para parar');

app.on('exit', (code) => {
  if (closing) return;
  log(`api/web encerraram (código ${code ?? 'null'})`);
  void shutdown(code ?? 1);
});
