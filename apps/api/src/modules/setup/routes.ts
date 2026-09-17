import {
  authSessionResponseSchema,
  errorResponseSchema,
  setupRequestSchema,
  setupStatusResponseSchema,
} from '@kanban/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { perIpRateLimit } from '../../plugins/rate-limit';

import { getSetupStatus, performSetup } from './service';

/** Setup: 5 requisições / 15 min por IP (overview.md §6.4). */
export const SETUP_RATE_LIMIT = { max: 5, timeWindowMs: 15 * 60_000 } as const;

/** `GET /api/setup/status` e `POST /api/setup` · Públicas (api.md §4). */
export const setupRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.get(
    '/api/setup/status',
    {
      config: { public: true },
      schema: {
        tags: ['setup'],
        summary: 'Indica se a instância ainda precisa do setup inicial',
        response: { 200: setupStatusResponseSchema },
      },
    },
    () => getSetupStatus(app.db),
  );

  app.post(
    '/api/setup',
    {
      config: {
        public: true,
        rateLimit: perIpRateLimit(SETUP_RATE_LIMIT.max, SETUP_RATE_LIMIT.timeWindowMs),
      },
      schema: {
        tags: ['setup'],
        summary: 'Setup inicial: cria o workspace, o primeiro Admin e a sessão',
        body: setupRequestSchema,
        response: {
          201: authSessionResponseSchema,
          400: errorResponseSchema,
          403: errorResponseSchema,
          409: errorResponseSchema,
          429: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { token, user, workspace } = await performSetup(
        { db: app.db, passwords: app.passwords, now: app.clock() },
        request.body,
      );
      reply.setSessionCookie(token);
      return reply.status(201).send({ user, workspace });
    },
  );

  done();
};
