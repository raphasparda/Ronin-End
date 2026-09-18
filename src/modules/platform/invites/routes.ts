import {
  acceptInviteRequestSchema,
  acceptInviteResponseSchema,
  inviteLookupRequestSchema,
  inviteLookupResponseSchema,
} from '@raphasparda/ronin-shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { appFeatures } from '../../../config/features';
import { errorResponses } from '../../../lib/route-schemas';
import { tokenRouteRateLimit } from '../../../plugins/rate-limit';

import { acceptInvite, lookupInvite } from './service';

/** `POST /api/auth/invites/lookup|accept` · Públicas · 10 req / 15 min por IP (api.md §5). */
export const inviteRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.post(
    '/api/auth/invites/lookup',
    {
      config: { public: true, rateLimit: tokenRouteRateLimit() },
      schema: {
        tags: ['convites'],
        summary: 'Consulta um convite pelo token (sem consumir)',
        body: inviteLookupRequestSchema,
        response: { 200: inviteLookupResponseSchema, ...errorResponses(400, 403, 410, 429) },
      },
    },
    (request) => lookupInvite(app.db, request.body.token, app.clock()),
  );

  app.post(
    '/api/auth/invites/accept',
    {
      config: { public: true, rateLimit: tokenRouteRateLimit() },
      schema: {
        tags: ['convites'],
        summary: 'Aceita o convite: cria a conta com o papel do convite e entra',
        body: acceptInviteRequestSchema,
        response: {
          201: acceptInviteResponseSchema,
          ...errorResponses(400, 403, 409, 410, 429),
        },
      },
    },
    async (request, reply) => {
      const { token, user, workspace } = await acceptInvite(
        { db: app.db, passwords: app.passwords, now: app.clock() },
        request.body,
        request.sessionId,
      );
      reply.setSessionCookie(token);
      return reply.status(201).send({ user, workspace, features: appFeatures(app) });
    },
  );

  done();
};
