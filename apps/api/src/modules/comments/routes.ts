import {
  cardIdParamsSchema,
  commentIdParamsSchema,
  commentResponseSchema,
  createCommentRequestSchema,
  updateCommentRequestSchema,
} from '@kanban/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { App } from '../../app';
import { errorResponses, noContentSchema } from '../../lib/route-schemas';
import { requireUser } from '../../plugins/session';

import { createComment, deleteComment, editComment, type CommentActionContext } from './service';

function actionContext(app: Pick<App, 'clock'>, request: FastifyRequest): CommentActionContext {
  const user = requireUser(request);
  return { actor: { id: user.id, role: user.role }, now: app.clock() };
}

/** Comentários do card (api.md §14): criar (Auth), editar (Autor), excluir (Autor ou Admin). */
export const commentRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.post(
    '/api/cards/:cardId/comments',
    {
      schema: {
        tags: ['comentários'],
        summary: 'Comenta no card (Markdown guardado como texto)',
        params: cardIdParamsSchema,
        body: createCommentRequestSchema,
        response: { 201: commentResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const comment = await createComment(
        app.db,
        actionContext(app, request),
        request.params.cardId,
        request.body.body,
      );
      return reply.status(201).send({ comment });
    },
  );

  app.patch(
    '/api/comments/:commentId',
    {
      schema: {
        tags: ['comentários'],
        summary: 'Edita comentário (só o autor; grava editedAt)',
        params: commentIdParamsSchema,
        body: updateCommentRequestSchema,
        response: { 200: commentResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      comment: await editComment(
        app.db,
        actionContext(app, request),
        request.params.commentId,
        request.body.body,
      ),
    }),
  );

  app.delete(
    '/api/comments/:commentId',
    {
      schema: {
        tags: ['comentários'],
        summary: 'Exclui comentário (autor ou Admin)',
        params: commentIdParamsSchema,
        response: { 204: noContentSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      await deleteComment(app.db, actionContext(app, request), request.params.commentId);
      return reply.status(204).send(null);
    },
  );

  done();
};
