import cookie, { type CookieSerializeOptions } from '@fastify/cookie';
import type { SessionUser } from '@kanban/shared';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  HookHandlerDoneFunction,
} from 'fastify';

import type { Env } from '../config/env';
import { AppError } from '../lib/app-error';
import { SESSION_ABSOLUTE_TTL_MS, resolveSession } from '../modules/sessions/service';

declare module 'fastify' {
  interface FastifyRequest {
    /** Usuário da sessão, recarregado do banco a cada request. `null` sem sessão válida. */
    user: SessionUser | null;
    /** `sessions.id` (SHA-256 do token) da sessão atual. `null` sem sessão válida. */
    sessionId: string | null;
  }
  interface FastifyReply {
    /** Grava o cookie de sessão com o token cru. */
    setSessionCookie(token: string): FastifyReply;
    /** Apaga o cookie de sessão no navegador. */
    clearSessionCookie(): FastifyReply;
  }
}

/** Nome do cookie: `__Host-` (exige `Secure`, `Path=/`, sem `Domain`) só em produção. */
export function sessionCookieName(nodeEnv: Env['NODE_ENV']): string {
  return nodeEnv === 'production' ? '__Host-kanban_sid' : 'kanban_sid';
}

/**
 * Atributos do cookie (overview.md §6.2). `Secure` só em produção: em dev o app roda em http e o
 * navegador descartaria o cookie.
 */
export function sessionCookieOptions(nodeEnv: Env['NODE_ENV']): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: nodeEnv === 'production',
  };
}

export const UNAUTHENTICATED_MESSAGE = 'Sua sessão expirou. Entre novamente.';
export const FORBIDDEN_MESSAGE = 'Você não tem permissão para isso.';

/** Usuário da sessão ou `401 UNAUTHENTICATED`. Para handlers de rotas autenticadas. */
export function requireUser(request: FastifyRequest): SessionUser {
  if (!request.user) throw new AppError('UNAUTHENTICATED', UNAUTHENTICATED_MESSAGE);
  return request.user;
}

/**
 * `preHandler` de rota: exige papel Admin (`403 FORBIDDEN`). Uso:
 * `app.delete('/api/...', { preHandler: requireAdmin }, handler)`.
 * Roda depois da validação, como pede a ordem de api.md §3 (401 → 403 CSRF → 400 → 404 → 403).
 */
export function requireAdmin(
  request: FastifyRequest,
  _reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  if (!request.user) {
    done(new AppError('UNAUTHENTICATED', UNAUTHENTICATED_MESSAGE));
    return;
  }
  done(request.user.role === 'admin' ? undefined : new AppError('FORBIDDEN', FORBIDDEN_MESSAGE));
}

/**
 * Sessão por cookie (ADR 0002, overview.md §6.2).
 *
 * - `onRequest` global: lê o cookie, busca a sessão pelo SHA-256 do token (join com `users`),
 *   valida expiração ociosa/absoluta e status do usuário, renova `last_seen_at` (sliding) e preenche
 *   `request.user`. Cookie inválido/expirado é apagado e o request segue sem usuário.
 * - `preParsing` global: exige sessão em toda rota, exceto `config: { public: true }` e 404. Fica
 *   antes do parser e da validação para respeitar a ordem 401 → 403 CSRF → 400 (api.md §3) e depois
 *   do rate limit (hooks `onRequest` de rota), que assim conta também os requests sem sessão.
 *
 * Deve ser registrado antes do CSRF, do rate limit e dos módulos.
 */
export async function registerSession(
  app: FastifyInstance,
  env: Pick<Env, 'NODE_ENV'>,
): Promise<void> {
  await app.register(cookie);

  const name = sessionCookieName(env.NODE_ENV);
  const options = sessionCookieOptions(env.NODE_ENV);

  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);
  app.decorateReply('setSessionCookie', function (this: FastifyReply, token: string) {
    return this.setCookie(name, token, {
      ...options,
      maxAge: Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000),
    });
  });
  app.decorateReply('clearSessionCookie', function (this: FastifyReply) {
    return this.clearCookie(name, options);
  });

  app.addHook('onRequest', async (request, reply) => {
    const token = request.cookies[name];
    if (token === undefined) return;
    const resolved = await resolveSession(app.db, token, app.clock());
    if (resolved) {
      request.user = resolved.user;
      request.sessionId = resolved.sessionId;
    } else {
      reply.clearSessionCookie();
    }
  });

  app.addHook('preParsing', (request, _reply, payload, done) => {
    if (request.user || request.is404 || request.routeOptions.config.public === true) {
      done(null, payload);
      return;
    }
    done(new AppError('UNAUTHENTICATED', UNAUTHENTICATED_MESSAGE));
  });
}
