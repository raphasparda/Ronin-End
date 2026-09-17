// PostgreSQL local de DESENVOLVIMENTO, sem Docker, sem senha de superusuário e sem admin.
//
// Usa os binários reais do PostgreSQL 18 distribuídos pelo pacote npm `embedded-postgres`
// (@embedded-postgres/<plataforma>), mas controla o ciclo de vida com `initdb`/`pg_ctl`:
// - `pg_ctl start` descarta privilégios de administrador no Windows (o postgres.exe se recusa a
//   rodar elevado) e `pg_ctl stop -m fast` desliga de forma limpa. O `stop()` da própria lib usa
//   `taskkill /f` no Windows e ela registra handlers globais de SIGINT, por isso não é usada.
// - Dados em `.data/postgres` (gitignored), porta/usuário/senha vindos do `DATABASE_URL`
//   (padrão `postgres://kanban:kanban@127.0.0.1:5433/kanban`), só em 127.0.0.1.
//
// Usado por `scripts/db-dev.mjs` (pnpm db:dev), `scripts/dev.mjs` (pnpm dev) e pelo globalSetup
// do Vitest da API. Nunca usar em produção.

import { spawn } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync } from 'node:fs';
import { readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { arch, platform, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = join(ROOT, '.data', 'postgres');
const LOG_FILE = join(ROOT, '.data', 'postgres.log');
const PG_CTL_OUT = join(ROOT, '.data', 'pg_ctl.out');
const OWNER_FILE = join(ROOT, '.data', 'postgres.owner.json');

export const DEFAULT_DATABASE_URL = 'postgres://kanban:kanban@127.0.0.1:5433/kanban';

const rootRequire = createRequire(join(ROOT, 'package.json'));
/** @type {typeof import('pg')} */
const pg = rootRequire('pg');

/** @param {string} message */
function defaultLog(message) {
  process.stdout.write(`[db] ${message}\n`);
}

/** Copia `.env.example` para `.env` se ainda não existir. Retorna true se copiou. */
export function ensureEnvFile() {
  const target = join(ROOT, '.env');
  if (existsSync(target)) return false;
  copyFileSync(join(ROOT, '.env.example'), target);
  return true;
}

/** Lê `.env` da raiz (sem alterar process.env); variáveis do ambiente prevalecem. */
export async function readDevEnv() {
  let fileEnv = {};
  try {
    fileEnv = parseEnv(await readFile(join(ROOT, '.env'), 'utf8'));
  } catch {
    // sem .env: só process.env
  }
  /** @param {string} name */
  const pick = (name) => process.env[name]?.trim() || fileEnv[name]?.trim() || undefined;
  return {
    databaseUrl: pick('DATABASE_URL') ?? DEFAULT_DATABASE_URL,
    testDatabaseUrl: pick('TEST_DATABASE_URL'),
  };
}

/** @param {string} host */
function isLoopback(host) {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
}

/** @param {string} url */
function parseTarget(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
}

/** @param {{ host: string, port: number }} t */
const endpoint = (t) => `${t.host}:${t.port}`;

/**
 * Tenta conectar no banco `postgres` do servidor.
 * @param {ReturnType<typeof parseTarget>} t
 * @returns {Promise<{ state: 'ready' } | { state: 'down' } | { state: 'error', error: Error }>}
 */
async function probe(t) {
  const client = new pg.Client({
    host: t.host,
    port: t.port,
    user: t.user,
    password: t.password,
    database: 'postgres',
    connectionTimeoutMillis: 2_000,
  });
  client.on('error', () => undefined);
  try {
    await client.connect();
    await client.query('SELECT 1');
    return { state: 'ready' };
  } catch (err) {
    const error = /** @type {Error & { code?: string }} */ (err);
    // Recusado, timeout ou servidor ainda subindo/desligando.
    const downCodes = ['ECONNREFUSED', 'ECONNRESET', '57P03'];
    if (downCodes.includes(error.code ?? '') || /timeout/i.test(error.message)) {
      return { state: 'down' };
    }
    return { state: 'error', error };
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Caminhos de initdb/pg_ctl do pacote de binários da plataforma atual. */
async function binaries() {
  const os = { win32: 'windows', linux: 'linux', darwin: 'darwin' }[platform()];
  if (!os) throw new Error(`Plataforma sem binários do embedded-postgres: ${platform()}`);
  const pkg = `@embedded-postgres/${os}-${arch()}`;
  const libRequire = createRequire(rootRequire.resolve('embedded-postgres'));
  let entry;
  try {
    entry = libRequire.resolve(pkg);
  } catch {
    throw new Error(`Pacote ${pkg} não instalado. Rode "pnpm install" (arquitetura ${arch()}).`);
  }
  /** @type {{ initdb: string, pg_ctl: string }} */
  const bins = await import(pathToFileURL(entry).href);
  return { initdb: bins.initdb, pgCtl: bins.pg_ctl };
}

/**
 * Executa um binário sem pipes: no Windows o postmaster herdaria o pipe e o processo pai
 * nunca terminaria. Saída vai para `.data/pg_ctl.out`.
 * @param {string} file
 * @param {string[]} args
 */
async function run(file, args) {
  mkdirSync(dirname(PG_CTL_OUT), { recursive: true });
  const fd = openSync(PG_CTL_OUT, 'w');
  try {
    const code = await new Promise((resolvePromise, reject) => {
      const child = spawn(file, args, { stdio: ['ignore', fd, fd], windowsHide: true });
      child.on('error', reject);
      child.on('exit', (exitCode) => resolvePromise(exitCode ?? 1));
    });
    const output = await readFile(PG_CTL_OUT, 'utf8').catch(() => '');
    return { code, output: output.trim() };
  } finally {
    closeSync(fd);
  }
}

async function tailLog(lines = 15) {
  const text = await readFile(LOG_FILE, 'utf8').catch(() => '');
  return text.trim().split(/\r?\n/).slice(-lines).join('\n');
}

/** @param {number} pid */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return /** @type {{ code?: string }} */ (err).code === 'EPERM';
  }
}

async function readOwner() {
  try {
    return /** @type {{ pid: number }} */ (JSON.parse(await readFile(OWNER_FILE, 'utf8')));
  } catch {
    return undefined;
  }
}

/** @param {Awaited<ReturnType<typeof binaries>>} bins */
async function clusterRunning(bins) {
  if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) return false;
  const { code } = await run(bins.pgCtl, ['status', '-D', DATA_DIR]);
  return code === 0;
}

/**
 * @param {Awaited<ReturnType<typeof binaries>>} bins
 * @param {ReturnType<typeof parseTarget>} t
 * @param {(message: string) => void} log
 */
async function initCluster(bins, t, log) {
  if (existsSync(join(DATA_DIR, 'PG_VERSION'))) return;
  if (existsSync(DATA_DIR) && (await readdir(DATA_DIR)).length > 0) {
    throw new Error(
      `${DATA_DIR} existe, mas não é um cluster PostgreSQL. Apague a pasta e tente de novo.`,
    );
  }
  log(`criando cluster em ${DATA_DIR} (só na primeira vez)...`);
  const tmp = mkdtempSync(join(tmpdir(), 'ronin-pg-'));
  const pwfile = join(tmp, 'pw');
  await writeFile(pwfile, `${t.password}\n`);
  try {
    const { code, output } = await run(bins.initdb, [
      `--pgdata=${DATA_DIR}`,
      `--username=${t.user}`,
      `--pwfile=${pwfile}`,
      '--auth=scram-sha-256',
      '--encoding=UTF8',
      '--locale=C',
      '--locale-provider=builtin',
      '--builtin-locale=C.UTF-8',
      '--lc-messages=C',
      '--no-instructions',
    ]);
    if (code !== 0) {
      await rm(DATA_DIR, { recursive: true, force: true });
      throw new Error(`initdb falhou (código ${code}):\n${output}`);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Cria os bancos que faltarem (ex.: kanban, kanban_test).
 * @param {ReturnType<typeof parseTarget>} t
 * @param {string[]} names
 */
async function ensureDatabases(t, names) {
  const client = new pg.Client({ ...t, database: 'postgres', connectionTimeoutMillis: 5_000 });
  client.on('error', () => undefined);
  await client.connect();
  try {
    const { rows } = await client.query('SELECT datname FROM pg_database WHERE datname = ANY($1)', [
      names,
    ]);
    const existing = new Set(rows.map((r) => r.datname));
    const created = [];
    for (const name of names) {
      if (existing.has(name)) continue;
      await client.query(`CREATE DATABASE ${client.escapeIdentifier(name)} TEMPLATE template0`);
      created.push(name);
    }
    return created;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * @typedef {object} DevDatabase
 * @property {'started' | 'adopted' | 'shared' | 'external'} kind
 *   started: este processo subiu o cluster; adopted: cluster órfão (dono morreu) assumido;
 *   shared: outro processo (ex.: pnpm db:dev em outro terminal) é o dono;
 *   external: DATABASE_URL já responde e não é o cluster local (Docker ou Postgres nativo).
 * @property {boolean} owned  true quando este processo deve parar o cluster ao sair.
 * @property {string} url
 * @property {() => Promise<void>} stop  Para o cluster se `owned`; senão, não faz nada.
 */

/**
 * Garante um PostgreSQL respondendo em `databaseUrl`, subindo o cluster local se preciso.
 * Idempotente: reaproveita um servidor que já esteja respondendo.
 * @param {{ databaseUrl: string, extraUrls?: (string | undefined)[], log?: (message: string) => void }} options
 * @returns {Promise<DevDatabase>}
 */
export async function startDevDatabase({ databaseUrl, extraUrls = [], log = defaultLog }) {
  const t = parseTarget(databaseUrl);
  const sameServer = [databaseUrl, ...extraUrls]
    .filter((u) => typeof u === 'string' && u.length > 0)
    .map((u) => parseTarget(/** @type {string} */ (u)))
    .filter((o) => o.host === t.host && o.port === t.port);
  const names = [...new Set(sameServer.map((o) => o.database).filter(Boolean))];

  const probed = await probe(t);
  if (probed.state === 'error') {
    throw new Error(
      `Há um PostgreSQL em ${endpoint(t)}, mas ele recusou ${t.user}: ${probed.error.message}\n` +
        'Se for outro Postgres (ex.: o nativo na 5432), use a porta 5433 no DATABASE_URL/TEST_DATABASE_URL do .env.',
    );
  }

  const local = isLoopback(t.host);
  const bins = local ? await binaries() : undefined;
  const ours = bins ? await clusterRunning(bins) : false;

  /** @type {DevDatabase['kind']} */
  let kind;
  if (probed.state === 'ready') {
    if (!ours) {
      kind = 'external';
    } else {
      const owner = await readOwner();
      kind = owner && owner.pid !== process.pid && pidAlive(owner.pid) ? 'shared' : 'adopted';
    }
  } else {
    if (!bins) {
      throw new Error(
        `PostgreSQL em ${endpoint(t)} não responde (host remoto: o cluster local só roda em 127.0.0.1).`,
      );
    }
    if (ours) {
      // Registrado como rodando, mas não responde: provavelmente desligando. Para e sobe de novo.
      await run(bins.pgCtl, ['stop', '-D', DATA_DIR, '-m', 'fast', '-w', '-t', '60']);
    }
    await initCluster(bins, t, log);
    log(
      `iniciando PostgreSQL em 127.0.0.1:${t.port} (dados em .data/postgres, log em .data/postgres.log)...`,
    );
    const { code, output } = await run(bins.pgCtl, [
      'start',
      '-D',
      DATA_DIR,
      '-w',
      '-t',
      '120',
      '-l',
      LOG_FILE,
      '-o',
      `-p ${t.port} -c listen_addresses=127.0.0.1`,
    ]);
    if (code !== 0) {
      throw new Error(
        `pg_ctl start falhou (código ${code}). Porta ${t.port} ocupada por outro programa?\n${output}\n--- .data/postgres.log ---\n${await tailLog()}`,
      );
    }
    kind = 'started';
  }

  const owned = kind === 'started' || kind === 'adopted';
  if (owned) await writeFile(OWNER_FILE, JSON.stringify({ pid: process.pid, port: t.port }));

  try {
    const created = await ensureDatabases(t, names);
    if (created.length > 0) log(`bancos criados: ${created.join(', ')}`);
  } catch (err) {
    if (kind !== 'external') throw err;
    log(`aviso: não foi possível conferir/criar os bancos (${/** @type {Error} */ (err).message})`);
  }

  let stopped = false;
  return {
    kind,
    owned,
    url: databaseUrl,
    async stop() {
      if (!owned || stopped || !bins) return;
      stopped = true;
      log('parando PostgreSQL...');
      const { code, output } = await run(bins.pgCtl, [
        'stop',
        '-D',
        DATA_DIR,
        '-m',
        'fast',
        '-w',
        '-t',
        '60',
      ]);
      // Código != 0 com o cluster já parado (ex.: recebeu o Ctrl+C direto do console) é ok.
      if (code !== 0 && (await clusterRunning(bins))) {
        log(`falha ao parar (código ${code}): ${output}`);
        return;
      }
      await unlink(OWNER_FILE).catch(() => undefined);
      log('PostgreSQL parado.');
    },
  };
}
