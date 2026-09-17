import {
  boardArchivedResponseSchema,
  boardCoverUploadUrlRequestSchema,
  boardCoverUploadUrlResponseSchema,
  boardIdParamsSchema,
  boardPayloadSchema,
  boardResponseSchema,
  boardsQuerySchema,
  boardsResponseSchema,
  boardViewerParamsSchema,
  boardViewersResponseSchema,
  confirmBoardCoverRequestSchema,
  createBoardRequestSchema,
  createBoardResponseSchema,
  deleteBoardRequestSchema,
  updateBoardRequestSchema,
  updateBoardVisibilityRequestSchema,
} from '@raphasparda/ronin-shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { App } from '../../app';
import { errorResponses, noContentSchema } from '../../lib/route-schemas';
import { coverUploadUrlRateLimit } from '../../plugins/rate-limit';
import { requireUser } from '../../plugins/session';

import { confirmBoardCover, createCoverUploadUrl, removeBoardCover } from './cover';
import {
  addBoardViewer,
  archiveBoard,
  createBoard,
  deleteBoard,
  getBoardArchived,
  getBoardPayload,
  listBoards,
  removeBoardViewer,
  renameBoard,
  restoreBoard,
  setBoardVisibility,
  type BoardActionContext,
} from './service';

function actionContext(
  app: Pick<App, 'clock' | 'coverStorage'>,
  request: FastifyRequest,
): BoardActionContext {
  return { actor: requireUser(request), now: app.clock(), coverStorage: app.coverStorage };
}

/** Rotas de quadros (api.md §9). Todas Auth, exceto `DELETE` (Admin). */
export const boardRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.get(
    '/api/boards',
    {
      schema: {
        tags: ['quadros'],
        summary:
          'Lista quadros ativos (padrão) ou arquivados, por nome; restrito sem acesso vem bloqueado',
        querystring: boardsQuerySchema,
        response: { 200: boardsResponseSchema, ...errorResponses(400, 401) },
      },
    },
    async (request) => ({
      boards: await listBoards(app.db, request.query.archived, requireUser(request), {
        storage: app.coverStorage,
        now: app.clock(),
      }),
    }),
  );

  app.post(
    '/api/boards',
    {
      schema: {
        tags: ['quadros'],
        summary: 'Cria quadro com as listas padrão coloridas (visível para a equipe)',
        body: createBoardRequestSchema,
        response: { 201: createBoardResponseSchema, ...errorResponses(400, 401, 403) },
      },
    },
    async (request, reply) => {
      const created = await createBoard(app.db, actionContext(app, request), request.body.name);
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
        response: { 200: boardPayloadSchema, ...errorResponses(400, 401, 403, 404) },
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
      board: await renameBoard(
        app.db,
        actionContext(app, request),
        request.params.boardId,
        request.body.name,
      ),
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
      board: await archiveBoard(app.db, actionContext(app, request), request.params.boardId),
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
      board: await restoreBoard(app.db, actionContext(app, request), request.params.boardId),
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
        response: { 200: boardArchivedResponseSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    (request) => getBoardArchived(app.db, request.params.boardId, requireUser(request)),
  );

  app.put(
    '/api/boards/:boardId/visibility',
    {
      schema: {
        tags: ['quadros'],
        summary:
          'Muda a visibilidade do quadro (equipe/restrito); restringir inclui ator e criador',
        params: boardIdParamsSchema,
        body: updateBoardVisibilityRequestSchema,
        response: { 200: boardResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      board: await setBoardVisibility(
        app.db,
        actionContext(app, request),
        request.params.boardId,
        request.body.visibility,
      ),
    }),
  );

  app.put(
    '/api/boards/:boardId/viewers/:userId',
    {
      schema: {
        tags: ['quadros'],
        summary:
          'Dá acesso ao quadro restrito (idempotente; quadro da equipe → 409 BOARD_NOT_RESTRICTED)',
        params: boardViewerParamsSchema,
        response: { 200: boardViewersResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      viewerIds: await addBoardViewer(
        app.db,
        actionContext(app, request),
        request.params.boardId,
        request.params.userId,
      ),
    }),
  );

  app.delete(
    '/api/boards/:boardId/viewers/:userId',
    {
      schema: {
        tags: ['quadros'],
        summary: 'Tira o acesso ao quadro restrito (idempotente; inclusive a si mesmo)',
        params: boardViewerParamsSchema,
        response: { 200: boardViewersResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      viewerIds: await removeBoardViewer(
        app.db,
        actionContext(app, request),
        request.params.boardId,
        request.params.userId,
      ),
    }),
  );

  app.post(
    '/api/boards/:boardId/cover/upload-url',
    {
      config: { rateLimit: coverUploadUrlRateLimit() },
      schema: {
        tags: ['quadros'],
        summary: 'URL assinada para enviar a capa direto ao R2 (5 min; não grava nada)',
        params: boardIdParamsSchema,
        body: boardCoverUploadUrlRequestSchema,
        response: {
          200: boardCoverUploadUrlResponseSchema,
          ...errorResponses(400, 401, 403, 404, 409, 429, 503),
        },
      },
    },
    (request) =>
      createCoverUploadUrl(
        app.db,
        actionContext(app, request),
        request.params.boardId,
        request.body,
      ),
  );

  app.put(
    '/api/boards/:boardId/cover',
    {
      schema: {
        tags: ['quadros'],
        summary: 'Confirma a capa enviada (confere tipo, tamanho e assinatura do formato)',
        params: boardIdParamsSchema,
        body: confirmBoardCoverRequestSchema,
        response: {
          200: boardResponseSchema,
          ...errorResponses(400, 401, 403, 404, 409, 503),
        },
      },
    },
    async (request) => ({
      board: await confirmBoardCover(
        app.db,
        actionContext(app, request),
        request.params.boardId,
        request.body,
        request.log,
      ),
    }),
  );

  app.delete(
    '/api/boards/:boardId/cover',
    {
      schema: {
        tags: ['quadros'],
        summary: 'Remove a capa (objeto e linha; idempotente)',
        params: boardIdParamsSchema,
        response: {
          200: boardResponseSchema,
          ...errorResponses(400, 401, 403, 404, 409, 503),
        },
      },
    },
    async (request) => ({
      board: await removeBoardCover(app.db, actionContext(app, request), request.params.boardId),
    }),
  );

  done();
};
