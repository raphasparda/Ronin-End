import {
  cardIdParamsSchema,
  checklistIdParamsSchema,
  checklistItemIdParamsSchema,
  checklistItemResponseSchema,
  checklistResponseSchema,
  createChecklistItemRequestSchema,
  createChecklistRequestSchema,
  moveChecklistItemRequestSchema,
  updateChecklistItemRequestSchema,
  updateChecklistRequestSchema,
} from '@raphasparda/ronin-shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { App } from '../../app';
import { errorResponses, noContentSchema } from '../../lib/route-schemas';
import { requireUser } from '../../plugins/session';

import {
  createChecklist,
  createChecklistItem,
  deleteChecklist,
  deleteChecklistItem,
  moveChecklistItem,
  renameChecklist,
  updateChecklistItem,
  type ChecklistActionContext,
} from './service';

function actionContext(app: Pick<App, 'clock'>, request: FastifyRequest): ChecklistActionContext {
  return { actor: requireUser(request), now: app.clock() };
}

/** Checklists e itens · Auth (api.md §13). */
export const checklistRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.post(
    '/api/cards/:cardId/checklists',
    {
      schema: {
        tags: ['checklists'],
        summary: 'Cria checklist no card',
        params: cardIdParamsSchema,
        body: createChecklistRequestSchema,
        response: { 201: checklistResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const checklist = await createChecklist(
        app.db,
        actionContext(app, request),
        request.params.cardId,
        request.body.title,
      );
      return reply.status(201).send({ checklist });
    },
  );

  app.patch(
    '/api/checklists/:checklistId',
    {
      schema: {
        tags: ['checklists'],
        summary: 'Renomeia checklist',
        params: checklistIdParamsSchema,
        body: updateChecklistRequestSchema,
        response: { 200: checklistResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      checklist: await renameChecklist(
        app.db,
        actionContext(app, request),
        request.params.checklistId,
        request.body.title,
      ),
    }),
  );

  app.delete(
    '/api/checklists/:checklistId',
    {
      schema: {
        tags: ['checklists'],
        summary: 'Exclui checklist (itens em cascata)',
        params: checklistIdParamsSchema,
        response: { 204: noContentSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      await deleteChecklist(app.db, requireUser(request), request.params.checklistId);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/api/checklists/:checklistId/items',
    {
      schema: {
        tags: ['checklists'],
        summary: 'Adiciona item no fim do checklist',
        params: checklistIdParamsSchema,
        body: createChecklistItemRequestSchema,
        response: { 201: checklistItemResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const item = await createChecklistItem(
        app.db,
        actionContext(app, request),
        request.params.checklistId,
        request.body.text,
      );
      return reply.status(201).send({ item });
    },
  );

  app.patch(
    '/api/checklist-items/:itemId',
    {
      schema: {
        tags: ['checklists'],
        summary: 'Edita texto e/ou marca/desmarca item (não gera atividade nem conclui o card)',
        params: checklistItemIdParamsSchema,
        body: updateChecklistItemRequestSchema,
        response: { 200: checklistItemResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      item: await updateChecklistItem(
        app.db,
        actionContext(app, request),
        request.params.itemId,
        request.body,
      ),
    }),
  );

  app.post(
    '/api/checklist-items/:itemId/move',
    {
      schema: {
        tags: ['checklists'],
        summary: 'Reordena item dentro do mesmo checklist',
        params: checklistItemIdParamsSchema,
        body: moveChecklistItemRequestSchema,
        response: { 200: checklistItemResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      item: await moveChecklistItem(
        app.db,
        actionContext(app, request),
        request.params.itemId,
        request.body.placement,
      ),
    }),
  );

  app.delete(
    '/api/checklist-items/:itemId',
    {
      schema: {
        tags: ['checklists'],
        summary: 'Exclui item',
        params: checklistItemIdParamsSchema,
        response: { 204: noContentSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      await deleteChecklistItem(app.db, requireUser(request), request.params.itemId);
      return reply.status(204).send(null);
    },
  );

  done();
};
