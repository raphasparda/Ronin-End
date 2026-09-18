import {
  updateAvatarRequestSchema,
  updateAvatarResponseSchema,
  userIdParamsSchema,
} from '@raphasparda/ronin-shared';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { errorResponses, noContentSchema } from '../../../lib/route-schemas';
import { requireUser } from '../../../plugins/session';

import {
  avatarETag,
  AVATAR_CACHE_CONTROL,
  getAvatarOrThrow,
  removeMyAvatar,
  setMyAvatar,
} from './service';

/**
 * Foto de perfil (api.md §6 e §7): o dono envia e apaga a sua (`/api/me/avatar`) e qualquer
 * usuário com sessão lê a de qualquer um (`/api/users/:userId/avatar`), que é o `src` do avatar.
 */
export const avatarRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.put(
    '/api/me/avatar',
    {
      schema: {
        tags: ['eu'],
        summary: 'Envia a foto de perfil (imagem em base64)',
        body: updateAvatarRequestSchema,
        response: { 200: updateAvatarResponseSchema, ...errorResponses(400, 401, 403, 413) },
      },
    },
    async (request) => ({
      user: await setMyAvatar(app.db, requireUser(request), request.body, app.clock()),
    }),
  );

  app.delete(
    '/api/me/avatar',
    {
      schema: {
        tags: ['eu'],
        summary: 'Remove a foto de perfil (idempotente)',
        response: { 204: noContentSchema, ...errorResponses(401, 403) },
      },
    },
    async (request, reply) => {
      await removeMyAvatar(app.db, requireUser(request), app.clock());
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/api/users/:userId/avatar',
    {
      // Resposta binária: sem `schema.response` para 200, o Fastify envia o Buffer como está.
      config: { cacheControl: AVATAR_CACHE_CONTROL },
      schema: {
        tags: ['usuários'],
        summary: 'Foto de perfil do usuário (imagem; 404 sem foto)',
        params: userIdParamsSchema,
        response: { ...errorResponses(400, 401, 404) },
      },
    },
    async (request, reply) => {
      const row = await getAvatarOrThrow(app.db, request.params.userId);
      const etag = avatarETag(row);
      // Fora do tipo da resposta (que só cobre os erros): o Fastify manda Buffer sem serializar.
      const binary = reply as unknown as FastifyReply;
      binary.header('etag', etag).type(row.contentType);
      if (request.headers['if-none-match'] === etag) binary.status(304).send();
      else binary.send(row.bytes);
      return reply;
    },
  );

  done();
};
