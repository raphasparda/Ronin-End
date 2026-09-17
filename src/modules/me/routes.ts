import {
  changePasswordRequestSchema,
  myCardsResponseSchema,
  updateMeRequestSchema,
  updateMeResponseSchema,
} from '@raphasparda/ronin-shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { errorResponses, noContentSchema } from '../../lib/route-schemas';
import { changePasswordRateLimit } from '../../plugins/rate-limit';
import { requireUser } from '../../plugins/session';

import { getMyCards } from '../cards/service';

import { changeMyPassword, updateMyProfile } from './service';

/** `PATCH /api/me`, `POST /api/me/password` e `GET /api/me/cards` · Auth (api.md §6). */
export const meRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.patch(
    '/api/me',
    {
      schema: {
        tags: ['eu'],
        summary: 'Altera o nome do usuário da sessão',
        body: updateMeRequestSchema,
        response: { 200: updateMeResponseSchema, ...errorResponses(400, 401, 403) },
      },
    },
    async (request) => ({
      user: await updateMyProfile(app.db, requireUser(request), request.body.name, app.clock()),
    }),
  );

  app.post(
    '/api/me/password',
    {
      config: { rateLimit: changePasswordRateLimit() },
      schema: {
        tags: ['eu'],
        summary: 'Troca a senha (mantém só a sessão atual)',
        body: changePasswordRequestSchema,
        response: { 204: noContentSchema, ...errorResponses(400, 401, 403, 429) },
      },
    },
    async (request, reply) => {
      await changeMyPassword(
        { db: app.db, passwords: app.passwords, now: app.clock() },
        requireUser(request),
        request.sessionId,
        request.body,
      );
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/api/me/cards',
    {
      schema: {
        tags: ['eu'],
        summary: 'Meus cards: abertos e atribuídos a mim, por prazo, prioridade e criação',
        response: { 200: myCardsResponseSchema, ...errorResponses(401) },
      },
    },
    async (request) => ({ cards: await getMyCards(app.db, requireUser(request)) }),
  );

  done();
};
