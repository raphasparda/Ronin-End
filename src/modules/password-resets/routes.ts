import {
  completePasswordResetRequestSchema,
  passwordResetLookupRequestSchema,
  passwordResetLookupResponseSchema,
} from '@raphasparda/ronin-shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { errorResponses, noContentSchema } from '../../lib/route-schemas';
import { tokenRouteRateLimit } from '../../plugins/rate-limit';

import { completePasswordReset, lookupPasswordReset } from './service';

/** `POST /api/auth/password-resets/lookup|complete` · Públicas · 10 req / 15 min por IP (api.md §5). */
export const passwordResetRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.post(
    '/api/auth/password-resets/lookup',
    {
      config: { public: true, rateLimit: tokenRouteRateLimit() },
      schema: {
        tags: ['redefinição de senha'],
        summary: 'Consulta um link de redefinição pelo token (sem consumir)',
        body: passwordResetLookupRequestSchema,
        response: {
          200: passwordResetLookupResponseSchema,
          ...errorResponses(400, 403, 410, 429),
        },
      },
    },
    (request) => lookupPasswordReset(app.db, request.body.token, app.clock()),
  );

  app.post(
    '/api/auth/password-resets/complete',
    {
      config: { public: true, rateLimit: tokenRouteRateLimit() },
      schema: {
        tags: ['redefinição de senha'],
        summary: 'Define a nova senha e encerra todas as sessões do usuário (não entra)',
        body: completePasswordResetRequestSchema,
        response: { 204: noContentSchema, ...errorResponses(400, 403, 410, 429) },
      },
    },
    async (request, reply) => {
      await completePasswordReset(
        { db: app.db, passwords: app.passwords, now: app.clock() },
        request.body,
      );
      return reply.status(204).send(null);
    },
  );

  done();
};
