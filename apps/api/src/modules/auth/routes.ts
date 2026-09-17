import { authSessionResponseSchema, errorResponseSchema, loginRequestSchema } from '@kanban/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { loginRouteRateLimit } from '../../plugins/rate-limit';
import { requireUser } from '../../plugins/session';
import { getWorkspace } from '../workspace/service';

import { login, logout } from './service';

/** `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` (api.md §5). */
export const authRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.post(
    '/api/auth/login',
    {
      config: { public: true, rateLimit: loginRouteRateLimit() },
      schema: {
        tags: ['autenticação'],
        summary: 'Entrar com e-mail e senha (cria sessão e grava o cookie)',
        body: loginRequestSchema,
        response: {
          200: authSessionResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          429: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { token, user, workspace } = await login(
        { db: app.db, passwords: app.passwords, now: app.clock() },
        request.body,
        { ip: request.ip, currentSessionId: request.sessionId },
      );
      reply.setSessionCookie(token);
      return { user, workspace };
    },
  );

  app.post(
    '/api/auth/logout',
    {
      // Sem sessão também responde 204 (idempotente); o CSRF continua exigido.
      config: { public: true },
      schema: {
        tags: ['autenticação'],
        summary: 'Sair (apaga a sessão atual e o cookie)',
        response: { 204: z.null().describe('Sem conteúdo'), 403: errorResponseSchema },
      },
    },
    async (request, reply) => {
      await logout(app.db, request.sessionId);
      request.user = null;
      request.sessionId = null;
      return reply.clearSessionCookie().status(204).send();
    },
  );

  app.get(
    '/api/auth/me',
    {
      schema: {
        tags: ['autenticação'],
        summary: 'Usuário da sessão e workspace',
        response: { 200: authSessionResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request) => ({ user: requireUser(request), workspace: await getWorkspace(app.db) }),
  );

  done();
};
