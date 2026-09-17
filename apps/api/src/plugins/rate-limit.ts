import rateLimit, { type RateLimitOptions } from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { AppError } from '../lib/app-error';

import { DEFAULT_MESSAGES } from './errors';

/** Limite geral: 600 req/min por usuário (por IP sem sessão) (overview.md §6.4). */
export const GENERAL_RATE_LIMIT = { max: 600, timeWindowMs: 60_000 } as const;

/** Chave por IP (`request.ip` respeita `TRUST_PROXY`). */
export const ipKey = (request: FastifyRequest): string => `ip:${request.ip}`;

/** Limite de rota por IP, para `config.rateLimit` (ex.: setup 5 / 15 min). */
export function perIpRateLimit(max: number, timeWindowMs: number): RateLimitOptions {
  return { max, timeWindow: timeWindowMs, keyGenerator: ipKey };
}

/**
 * `@fastify/rate-limit` em memória, global. Os hooks são de rota (`onRequest`) e rodam depois do
 * `onRequest` global da sessão, então a chave usa o usuário quando há sessão. Rotas com
 * `config.rateLimit` próprio usam só o próprio limite (contador separado).
 * Excedido → `429 RATE_LIMITED` com `Retry-After` (segundos). Registrar antes dos módulos.
 */
export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    hook: 'onRequest',
    max: GENERAL_RATE_LIMIT.max,
    timeWindow: GENERAL_RATE_LIMIT.timeWindowMs,
    keyGenerator: (request) => (request.user ? `user:${request.user.id}` : ipKey(request)),
    errorResponseBuilder: (_request, context) =>
      new AppError('RATE_LIMITED', DEFAULT_MESSAGES.RATE_LIMITED, {
        headers: { 'retry-after': String(Math.max(1, Math.ceil(context.ttl / 1000))) },
      }),
  });
}
