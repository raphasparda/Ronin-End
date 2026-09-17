import { DrizzleQueryError } from 'drizzle-orm';
import type { FastifyRequest, FastifyServerOptions } from 'fastify';
import pg from 'pg';

import type { Env } from './config/env';

/**
 * Campos que nunca podem aparecer nos logs (overview.md §6.7). O corpo da requisição não é
 * logado; os caminhos com `*` cobrem objetos logados manualmente.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.setupToken',
  // Fatia 11: segredo do R2 e URLs assinadas (a assinatura é credencial temporária, ADR 0016).
  '*.secretAccessKey',
  '*.R2_SECRET_ACCESS_KEY',
  '*.uploadUrl',
  '*.signedUrl',
];

const MAX_CAUSE_DEPTH = 5;
const SQLSTATE = /^[0-9A-Z]{5}$/;

type SerializedError = Record<string, unknown>;

interface SerializedErrorShape {
  [key: string]: unknown;
  type: string;
  message: string;
  stack: string;
}

/** Erro do `pg` (`DatabaseError`): `message`, `detail`, `where` etc. podem conter valores. */
function isPgDatabaseError(err: object): err is Error & Partial<pg.DatabaseError> {
  if (err instanceof pg.DatabaseError) return true;
  const candidate = err as { code?: unknown; severity?: unknown; detail?: unknown };
  return (
    typeof candidate.code === 'string' &&
    SQLSTATE.test(candidate.code) &&
    ('severity' in candidate || 'detail' in candidate)
  );
}

/** Erro de query do Drizzle: a `message` traz `params: ...` (valores da query). */
function isDrizzleQueryError(err: object): err is Error & { query: string } {
  if (err instanceof DrizzleQueryError) return true;
  const candidate = err as { query?: unknown };
  return typeof candidate.query === 'string' && 'params' in candidate;
}

/** Só os frames (`    at ...`): a primeira linha do stack repete a mensagem. */
function framesOnly(err: Error): string {
  if (typeof err.stack !== 'string') return err.name;
  const frames = err.stack.split('\n').filter((line) => /^\s+at /.test(line));
  return [err.name, ...frames].join('\n');
}

function serializeError(err: unknown, depth: number, seen: Set<object>): unknown {
  if (typeof err !== 'object' || err === null) return err;
  if (seen.has(err) || depth > MAX_CAUSE_DEPTH) return '[cause omitido]';
  seen.add(err);
  const cause = (err as { cause?: unknown }).cause;

  if (isDrizzleQueryError(err)) {
    const pgCause = typeof cause === 'object' && cause !== null && isPgDatabaseError(cause);
    return {
      type: err.name || 'DrizzleQueryError',
      message: 'Failed query (params omitidos)',
      query: err.query,
      ...(pgCause ? { code: cause.code, constraint: cause.constraint } : {}),
      stack: framesOnly(err),
      ...(cause !== undefined ? { cause: serializeError(cause, depth + 1, seen) } : {}),
    } satisfies SerializedError;
  }

  if (isPgDatabaseError(err)) {
    return {
      type: 'DatabaseError',
      message: `Erro do PostgreSQL ${err.code ?? '(sem SQLSTATE)'} (message/detail omitidos)`,
      code: err.code,
      ...(err.constraint ? { constraint: err.constraint } : {}),
      ...(err.table ? { table: err.table } : {}),
      ...(err.routine ? { routine: err.routine } : {}),
      stack: framesOnly(err),
    } satisfies SerializedError;
  }

  if (!(err instanceof Error)) return err;

  // Demais erros: equivalente ao `pino.stdSerializers.err`, mas a `message`/`stack` são só do
  // próprio erro (o padrão do pino concatena as das causas, o que vazaria um erro de banco
  // embrulhado) e a `cause` passa por este mesmo serializer.
  const out: SerializedError = {
    type: err.constructor.name || err.name,
    message: err.message,
    stack: err.stack ?? '',
  };
  for (const [key, value] of Object.entries(err)) {
    if (key === 'cause' || key in out) continue;
    out[key] = value instanceof Error ? serializeError(value, depth + 1, seen) : value;
  }
  if (cause !== undefined) out.cause = serializeError(cause, depth + 1, seen);
  if (err instanceof AggregateError) {
    out.aggregateErrors = err.errors.map((e: unknown) => serializeError(e, depth + 1, seen));
  }
  return out;
}

/**
 * Serializer de `err` (api.md §18.5): `DrizzleQueryError` e `DatabaseError` do `pg` saem só com
 * tipo, query (sem `params`), SQLSTATE, constraint e os frames do stack, sem `message`/`detail`
 * (ex.: `Key (email)=(...)`, hash de senha nos params).
 */
export function serializeErr(err: Error): SerializedErrorShape {
  const out = serializeError(err, 0, new Set());
  if (typeof out === 'object' && out !== null && 'type' in out) return out as SerializedErrorShape;
  return { type: typeof err, message: String(err), stack: '' };
}

type LoggerOptions = Exclude<FastifyServerOptions['logger'], boolean | undefined>;

export function buildLoggerOptions(env: Pick<Env, 'LOG_LEVEL'>): LoggerOptions {
  return {
    level: env.LOG_LEVEL,
    redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
    serializers: {
      err: serializeErr,
      // Sem headers, corpo nem query string (overview.md §6.7).
      req: (request: FastifyRequest) => ({
        method: request.method,
        url: request.url.split('?')[0],
        route: request.routeOptions.url,
        remoteAddress: request.ip,
      }),
    },
  };
}
