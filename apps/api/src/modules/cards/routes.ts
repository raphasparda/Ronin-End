import {
  activitiesResponseSchema,
  cardAssigneeParamsSchema,
  cardAssigneesResponseSchema,
  cardDetailResponseSchema,
  cardIdParamsSchema,
  cardMutationResultSchema,
  cardSummaryResponseSchema,
  createCardRequestSchema,
  listIdParamsSchema,
  moveCardRequestSchema,
  updateCardRequestSchema,
} from '@kanban/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { App } from '../../app';
import { errorResponses, noContentSchema } from '../../lib/route-schemas';
import { requireUser } from '../../plugins/session';

import {
  archiveCard,
  assignCard,
  changeCardCompletion,
  createCard,
  deleteCard,
  getCardActivity,
  getCardDetail,
  moveCard,
  restoreCard,
  unassignCard,
  updateCard,
  type CardActionContext,
} from './service';

function actionContext(app: Pick<App, 'clock'>, request: FastifyRequest): CardActionContext {
  return { actorId: requireUser(request).id, now: app.clock() };
}

/** Rotas de cards e atividade (api.md §11). Todas Auth, exceto `DELETE` (Admin). */
export const cardRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.post(
    '/api/lists/:listId/cards',
    {
      schema: {
        tags: ['cards'],
        summary: 'Cria card no fim da lista (recusa lista arquivada e lista de conclusão)',
        params: listIdParamsSchema,
        body: createCardRequestSchema,
        response: { 201: cardSummaryResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const card = await createCard(
        app.db,
        actionContext(app, request),
        request.params.listId,
        request.body.title,
      );
      return reply.status(201).send({ card });
    },
  );

  app.get(
    '/api/cards/:cardId',
    {
      schema: {
        tags: ['cards'],
        summary: 'Detalhe do card (inclusive arquivado)',
        params: cardIdParamsSchema,
        response: { 200: cardDetailResponseSchema, ...errorResponses(400, 401, 404) },
      },
    },
    async (request) => ({ card: await getCardDetail(app.db, request.params.cardId) }),
  );

  app.patch(
    '/api/cards/:cardId',
    {
      schema: {
        tags: ['cards'],
        summary: 'Edita título, descrição, prazo e/ou prioridade',
        params: cardIdParamsSchema,
        body: updateCardRequestSchema,
        response: { 200: cardDetailResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      card: await updateCard(
        app.db,
        actionContext(app, request),
        request.params.cardId,
        request.body,
      ),
    }),
  );

  app.post(
    '/api/cards/:cardId/move',
    {
      schema: {
        tags: ['cards'],
        summary: 'Move o card (mesma lista, outra lista ou outro quadro) aplicando a conclusão',
        params: cardIdParamsSchema,
        body: moveCardRequestSchema,
        response: { 200: cardMutationResultSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    (request) => moveCard(app.db, actionContext(app, request), request.params.cardId, request.body),
  );

  app.post(
    '/api/cards/:cardId/complete',
    {
      schema: {
        tags: ['cards'],
        summary: 'Conclui o card (vai para o fim da lista de conclusão, se houver; idempotente)',
        params: cardIdParamsSchema,
        response: { 200: cardMutationResultSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    (request) =>
      changeCardCompletion(app.db, actionContext(app, request), request.params.cardId, 'completed'),
  );

  app.post(
    '/api/cards/:cardId/reopen',
    {
      schema: {
        tags: ['cards'],
        summary:
          'Reabre o card (da lista de conclusão vai para o topo da primeira lista ativa; idempotente)',
        params: cardIdParamsSchema,
        response: { 200: cardMutationResultSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    (request) =>
      changeCardCompletion(app.db, actionContext(app, request), request.params.cardId, 'reopened'),
  );

  app.post(
    '/api/cards/:cardId/archive',
    {
      schema: {
        tags: ['cards'],
        summary: 'Arquiva o card (idempotente)',
        params: cardIdParamsSchema,
        response: { 200: cardSummaryResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      card: await archiveCard(app.db, actionContext(app, request), request.params.cardId),
    }),
  );

  app.post(
    '/api/cards/:cardId/restore',
    {
      schema: {
        tags: ['cards'],
        summary: 'Restaura o card no fim da lista original (idempotente)',
        params: cardIdParamsSchema,
        response: { 200: cardSummaryResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      card: await restoreCard(app.db, actionContext(app, request), request.params.cardId),
    }),
  );

  app.delete(
    '/api/cards/:cardId',
    {
      schema: {
        tags: ['cards'],
        summary: 'Exclui o card definitivamente (Admin)',
        params: cardIdParamsSchema,
        response: { 204: noContentSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      await deleteCard(app.db, requireUser(request), request.params.cardId);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/api/cards/:cardId/activity',
    {
      schema: {
        tags: ['cards'],
        summary: 'Histórico do card (até 500, mais recentes primeiro)',
        params: cardIdParamsSchema,
        response: { 200: activitiesResponseSchema, ...errorResponses(400, 401, 404) },
      },
    },
    async (request) => ({ activities: await getCardActivity(app.db, request.params.cardId) }),
  );

  app.put(
    '/api/cards/:cardId/assignees/:userId',
    {
      schema: {
        tags: ['cards'],
        summary: 'Adiciona responsável (idempotente; usuário não ativo → 409 USER_NOT_ACTIVE)',
        params: cardAssigneeParamsSchema,
        response: { 200: cardAssigneesResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      assigneeIds: await assignCard(
        app.db,
        actionContext(app, request),
        request.params.cardId,
        request.params.userId,
      ),
    }),
  );

  app.delete(
    '/api/cards/:cardId/assignees/:userId',
    {
      schema: {
        tags: ['cards'],
        summary: 'Remove responsável (idempotente; qualquer status de usuário)',
        params: cardAssigneeParamsSchema,
        response: { 200: cardAssigneesResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      assigneeIds: await unassignCard(
        app.db,
        actionContext(app, request),
        request.params.cardId,
        request.params.userId,
      ),
    }),
  );

  done();
};
