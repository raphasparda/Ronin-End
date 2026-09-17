import { usersResponseSchema } from '@raphasparda/ronin-shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { errorResponses } from '../../lib/route-schemas';

import { listUsers } from './service';

/** `GET /api/users` · Auth (api.md §7). Sem e-mail. */
export const userRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.get(
    '/api/users',
    {
      schema: {
        tags: ['usuários'],
        summary: 'Todos os usuários (ativos, desativados e anonimizados), por nome, sem e-mail',
        response: { 200: usersResponseSchema, ...errorResponses(401) },
      },
    },
    async () => ({ users: await listUsers(app.db) }),
  );

  done();
};
