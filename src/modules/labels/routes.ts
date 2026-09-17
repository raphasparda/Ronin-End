import {
  boardIdParamsSchema,
  cardLabelParamsSchema,
  cardLabelsResponseSchema,
  createLabelRequestSchema,
  labelIdParamsSchema,
  labelResponseSchema,
  updateLabelRequestSchema,
} from '@raphasparda/ronin-shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { errorResponses, noContentSchema } from '../../lib/route-schemas';
import { requireUser } from '../../plugins/session';

import { applyLabel, createLabel, deleteLabel, removeLabel, updateLabel } from './service';

/** Etiquetas do quadro e etiquetas aplicadas ao card · Auth (api.md §11–12). */
export const labelRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.post(
    '/api/boards/:boardId/labels',
    {
      schema: {
        tags: ['etiquetas'],
        summary: 'Cria etiqueta no quadro (cor da paleta)',
        params: boardIdParamsSchema,
        body: createLabelRequestSchema,
        response: { 201: labelResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const label = await createLabel(
        app.db,
        requireUser(request),
        request.params.boardId,
        request.body,
        app.clock(),
      );
      return reply.status(201).send({ label });
    },
  );

  app.patch(
    '/api/labels/:labelId',
    {
      schema: {
        tags: ['etiquetas'],
        summary: 'Renomeia e/ou troca a cor da etiqueta',
        params: labelIdParamsSchema,
        body: updateLabelRequestSchema,
        response: { 200: labelResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      label: await updateLabel(
        app.db,
        requireUser(request),
        request.params.labelId,
        request.body,
        app.clock(),
      ),
    }),
  );

  app.delete(
    '/api/labels/:labelId',
    {
      schema: {
        tags: ['etiquetas'],
        summary: 'Exclui a etiqueta e a remove de todos os cards',
        params: labelIdParamsSchema,
        response: { 204: noContentSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      await deleteLabel(app.db, requireUser(request), request.params.labelId);
      return reply.status(204).send(null);
    },
  );

  app.put(
    '/api/cards/:cardId/labels/:labelId',
    {
      schema: {
        tags: ['etiquetas'],
        summary: 'Aplica etiqueta ao card (idempotente; etiqueta de outro quadro → 409)',
        params: cardLabelParamsSchema,
        response: { 200: cardLabelsResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      labelIds: await applyLabel(
        app.db,
        requireUser(request),
        request.params.cardId,
        request.params.labelId,
      ),
    }),
  );

  app.delete(
    '/api/cards/:cardId/labels/:labelId',
    {
      schema: {
        tags: ['etiquetas'],
        summary: 'Remove etiqueta do card (idempotente)',
        params: cardLabelParamsSchema,
        response: { 200: cardLabelsResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      labelIds: await removeLabel(
        app.db,
        requireUser(request),
        request.params.cardId,
        request.params.labelId,
      ),
    }),
  );

  done();
};
