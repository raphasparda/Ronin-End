import type { FastifyRequest, FastifyServerOptions } from 'fastify';

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
];

type LoggerOptions = Exclude<FastifyServerOptions['logger'], boolean | undefined>;

export function buildLoggerOptions(env: Pick<Env, 'LOG_LEVEL'>): LoggerOptions {
  return {
    level: env.LOG_LEVEL,
    redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
    serializers: {
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
