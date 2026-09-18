import {
  notificationIdParamsSchema,
  notificationsQuerySchema,
  notificationsResponseSchema,
  unreadCountResponseSchema,
} from '@raphasparda/ronin-shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { errorResponses, noContentSchema } from '../../../lib/route-schemas';
import { requireUser } from '../../../plugins/session';

import {
  getUnreadCount,
  listNotifications,
  readAllNotifications,
  readNotification,
} from './service';

/** Notificações do usuário da sessão (api.md §15) · Auth. Sempre filtradas pelo destinatário. */
export const notificationRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.get(
    '/api/notifications',
    {
      schema: {
        tags: ['notificações'],
        summary: 'Notificações do usuário, mais recentes primeiro (cursor `before`)',
        querystring: notificationsQuerySchema,
        response: { 200: notificationsResponseSchema, ...errorResponses(400, 401) },
      },
    },
    (request) => listNotifications(app.db, requireUser(request), request.query),
  );

  app.get(
    '/api/notifications/unread-count',
    {
      schema: {
        tags: ['notificações'],
        summary: 'Contador de notificações não lidas',
        response: { 200: unreadCountResponseSchema, ...errorResponses(401) },
      },
    },
    async (request) => ({ unreadCount: await getUnreadCount(app.db, requireUser(request)) }),
  );

  app.post(
    '/api/notifications/read-all',
    {
      schema: {
        tags: ['notificações'],
        summary: 'Marca todas as notificações como lidas',
        response: { 204: noContentSchema, ...errorResponses(401, 403) },
      },
    },
    async (request, reply) => {
      await readAllNotifications(app.db, requireUser(request).id, app.clock());
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/api/notifications/:notificationId/read',
    {
      schema: {
        tags: ['notificações'],
        summary: 'Marca a notificação como lida (idempotente; de outro usuário → 404)',
        params: notificationIdParamsSchema,
        response: { 204: noContentSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request, reply) => {
      await readNotification(
        app.db,
        requireUser(request).id,
        request.params.notificationId,
        app.clock(),
      );
      return reply.status(204).send(null);
    },
  );

  done();
};
