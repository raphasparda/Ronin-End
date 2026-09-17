import {
  boardArchivedResponseSchema,
  boardIdParamsSchema,
  boardPayloadSchema,
  boardResponseSchema,
  boardsQuerySchema,
  boardsResponseSchema,
  createBoardRequestSchema,
  createBoardResponseSchema,
  deleteBoardRequestSchema,
  updateBoardRequestSchema,
} from '@raphasparda/ronin-shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { errorResponses, noContentSchema } from '../../lib/route-schemas';
import { requireUser } from '../../plugins/session';

import {
  archiveBoard,
  createBoard,
  deleteBoard,
  getBoardArchived,
  getBoardPayload,
  listBoards,
  renameBoard,
  restoreBoard,
} from './service';

/** Rotas de quadros (api.md §9). Todas Auth, exceto `DELETE` (Admin). */
export const boardRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.get(
    '/api/boards',
    {
      schema: {
        tags: ['quadros'],
        summary: 'Lista quadros ativos (padrão) ou arquivados, por nome',
        querystring: boardsQuerySchema,
        response: { 200: boardsResponseSchema, ...errorResponses(400, 401) },
      },
    },
    async (request) => ({ boards: await listBoards(app.db, request.query.archived) }),
  );

  app.post(
    '/api/boards',
    {
      schema: {
        tags: ['quadros'],
        summary: 'Cria quadro com as listas padrão coloridas',
        body: createBoardRequestSchema,
        response: { 201: createBoardResponseSchema, ...errorResponses(400, 401, 403) },
      },
    },
    async (request, reply) => {
      const created = await createBoard(
        app.db,
        requireUser(request).id,
        request.body.name,
        app.clock(),
      );
      return reply.status(201).send(created);
    },
  );

  app.get(
    '/api/boards/:boardId',
    {
      schema: {
        tags: ['quadros'],
        summary: 'Payload do quadro (listas ativas, cards, etiquetas)',
        params: boardIdParamsSchema,
        response: { 200: boardPayloadSchema, ...errorResponses(400, 401, 404) },
      },
    },
    (request) =>
      getBoardPayload(app.db, request.params.boardId, requireUser(request), {
        storage: app.coverStorage,
        now: app.clock(),
      }),
  );

  app.patch(
    '/api/boards/:boardId',
    {
      schema: {
        tags: ['quadros'],
        summary: 'Renomeia o quadro',
        params: boardIdParamsSchema,
        body: updateBoardRequestSchema,
        response: { 200: boardResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      board: await renameBoard(app.db, request.params.boardId, request.body.name, app.clock()),
    }),
  );

  app.post(
    '/api/boards/:boardId/archive',
    {
      schema: {
        tags: ['quadros'],
        summary: 'Arquiva o quadro (idempotente)',
        params: boardIdParamsSchema,
        response: { 200: boardResponseSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request) => ({
      board: await archiveBoard(app.db, request.params.boardId, app.clock()),
    }),
  );

  app.post(
    '/api/boards/:boardId/restore',
    {
      schema: {
        tags: ['quadros'],
        summary: 'Restaura o quadro (idempotente)',
        params: boardIdParamsSchema,
        response: { 200: boardResponseSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request) => ({
      board: await restoreBoard(app.db, request.params.boardId, app.clock()),
    }),
  );

  app.delete(
    '/api/boards/:boardId',
    {
      schema: {
        tags: ['quadros'],
        summary: 'Exclui o quadro definitivamente (Admin, confirmando o nome)',
        params: boardIdParamsSchema,
        body: deleteBoardRequestSchema,
        response: { 204: noContentSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request, reply) => {
      await deleteBoard(
        app.db,
        requireUser(request),
        request.params.boardId,
        request.body.confirmName,
        app.coverStorage,
        request.log,
      );
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/api/boards/:boardId/archived',
    {
      schema: {
        tags: ['quadros'],
        summary: 'Listas e cards arquivados do quadro',
        params: boardIdParamsSchema,
        response: { 200: boardArchivedResponseSchema, ...errorResponses(400, 401, 404) },
      },
    },
    (request) =>
      getBoardArchived(app.db, request.params.boardId, requireUser(request), {
        storage: app.coverStorage,
        now: app.clock(),
      }),
  );

  done();
};
