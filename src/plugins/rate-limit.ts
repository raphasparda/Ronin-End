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

/** Lookup/uso de convite e redefinição: 10 req / 15 min por IP (overview.md §6.4, ADR 0008). */
export const TOKEN_ROUTE_RATE_LIMIT = { max: 10, timeWindowMs: 15 * 60_000 } as const;

export const tokenRouteRateLimit = (): RateLimitOptions =>
  perIpRateLimit(TOKEN_ROUTE_RATE_LIMIT.max, TOKEN_ROUTE_RATE_LIMIT.timeWindowMs);

/**
 * `POST /api/auth/login`: 30 req / min por IP (api.md §18.5). Barreira extra, em memória, na frente
 * do bloqueio persistido por e-mail/IP: limita o custo de rajadas (cada tentativa ainda consulta o
 * banco) sem atrapalhar um escritório atrás do mesmo IP.
 */
export const LOGIN_ROUTE_RATE_LIMIT = { max: 30, timeWindowMs: 60_000 } as const;

export const loginRouteRateLimit = (): RateLimitOptions =>
  perIpRateLimit(LOGIN_ROUTE_RATE_LIMIT.max, LOGIN_ROUTE_RATE_LIMIT.timeWindowMs);

/**
 * `POST /api/cards/:cardId/cover/upload-url`: 30 req / 5 min por usuário (api.md §11, Fatia 11).
 * Assinar é barato, mas cada URL é uma permissão de escrita no bucket: o limite evita que uma conta
 * comprometida gere milhares delas.
 */
export const COVER_UPLOAD_URL_RATE_LIMIT = { max: 30, timeWindowMs: 5 * 60_000 } as const;

export const coverUploadUrlRateLimit = (): RateLimitOptions => ({
  max: COVER_UPLOAD_URL_RATE_LIMIT.max,
  timeWindow: COVER_UPLOAD_URL_RATE_LIMIT.timeWindowMs,
  keyGenerator: (request) => (request.user ? `user:${request.user.id}` : ipKey(request)),
});

/** `POST /api/me/password`: 10 req / 15 min por usuário (por IP sem sessão) (api.md §18.5). */
export const CHANGE_PASSWORD_RATE_LIMIT = { max: 10, timeWindowMs: 15 * 60_000 } as const;

export const changePasswordRateLimit = (): RateLimitOptions => ({
  max: CHANGE_PASSWORD_RATE_LIMIT.max,
  timeWindow: CHANGE_PASSWORD_RATE_LIMIT.timeWindowMs,
  keyGenerator: (request) => (request.user ? `user:${request.user.id}` : ipKey(request)),
});
