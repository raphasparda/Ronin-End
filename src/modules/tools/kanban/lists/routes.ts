import {
  boardIdParamsSchema,
  createListRequestSchema,
  listIdParamsSchema,
  listResponseSchema,
  moveListRequestSchema,
  updateListRequestSchema,
  updateListResponseSchema,
} from '@raphasparda/ronin-shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { errorResponses } from '../../../../lib/route-schemas';
import { requireUser } from '../../../../plugins/session';

import { archiveList, createList, moveList, restoreList, updateList } from './service';

/** Rotas de listas · Auth (api.md §10). */
export const listRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.post(
    '/api/boards/:boardId/lists',
    {
      schema: {
        tags: ['listas'],
        summary: 'Cria lista (cor padrão: próxima da paleta; posição padrão: fim)',
        params: boardIdParamsSchema,
        body: createListRequestSchema,
        response: { 201: listResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const list = await createList(
        app.db,
        requireUser(request),
        request.params.boardId,
        request.body,
        app.clock(),
      );
      return reply.status(201).send({ list });
    },
  );

  app.patch(
    '/api/lists/:listId',
    {
      schema: {
        tags: ['listas'],
        summary: 'Renomeia, troca a cor e/ou marca/desmarca a lista de conclusão',
        params: listIdParamsSchema,
        body: updateListRequestSchema,
        response: { 200: updateListResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    (request) =>
      updateList(
        app.db,
        { actor: requireUser(request), now: app.clock() },
        request.params.listId,
        request.body,
      ),
  );

  app.post(
    '/api/lists/:listId/move',
    {
      schema: {
        tags: ['listas'],
        summary: 'Move a lista dentro do quadro',
        params: listIdParamsSchema,
        body: moveListRequestSchema,
        response: { 200: listResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      list: await moveList(
        app.db,
        requireUser(request),
        request.params.listId,
        request.body.placement,
        app.clock(),
      ),
    }),
  );

  app.post(
    '/api/lists/:listId/archive',
    {
      schema: {
        tags: ['listas'],
        summary: 'Arquiva a lista (desmarca a conclusão; idempotente)',
        params: listIdParamsSchema,
        response: { 200: listResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      list: await archiveList(app.db, requireUser(request), request.params.listId, app.clock()),
    }),
  );

  app.post(
    '/api/lists/:listId/restore',
    {
      schema: {
        tags: ['listas'],
        summary: 'Restaura a lista no fim do quadro (idempotente)',
        params: listIdParamsSchema,
        response: { 200: listResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      list: await restoreList(app.db, requireUser(request), request.params.listId, app.clock()),
    }),
  );

  done();
};
