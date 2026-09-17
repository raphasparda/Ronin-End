import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import pg from 'pg';

import * as schema from './schema';

/** Tamanho padrão do pool (`DATABASE_POOL_MAX`). */
export const DEFAULT_POOL_MAX = 10;

/** Logger mínimo aceito pelo pool (o `FastifyBaseLogger` e o pino satisfazem). */
export interface PoolLogger {
  error(obj: object, msg: string): void;
}

export interface CreatePoolOptions {
  /** Conexões máximas. Padrão: 10 (env `DATABASE_POOL_MAX`). */
  max?: number;
}

/**
 * Pool `pg` da API. Criar o pool não abre conexão: a primeira acontece na primeira consulta.
 */
export function createPool(
  connectionString: string,
  logger: PoolLogger,
  options: CreatePoolOptions = {},
): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? DEFAULT_POOL_MAX,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  // Sem este listener, um erro em conexão ociosa (ex.: banco reiniciou) derruba o processo.
  pool.on('error', (err) => {
    logger.error({ err }, 'erro em conexão ociosa do pool do PostgreSQL');
  });
  return pool;
}

export type Database = NodePgDatabase<typeof schema>;

/**
 * Banco ou transação. Repositórios recebem este tipo para rodar tanto fora quanto dentro de
 * `db.transaction()` (a transação do Drizzle estende `PgDatabase`).
 */
export type DbExecutor = PgDatabase<NodePgQueryResultHKT, typeof schema>;

/** Drizzle sobre um pool (ou client) `pg`, com o schema completo para a query API relacional. */
export function createDb(client: pg.Pool | pg.PoolClient | pg.Client): Database {
  return drizzle({ client, schema });
}

/** Verifica se o banco responde. Lança se não responder dentro do prazo. */
export type DatabaseCheck = () => Promise<void>;

export function createPoolCheck(pool: pg.Pool, timeoutMs = 3_000): DatabaseCheck {
  return async () => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout no health check do banco')), timeoutMs);
    });
    try {
      await Promise.race([pool.query('SELECT 1'), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}
