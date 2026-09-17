import {
  adminUserResponseSchema,
  adminUsersResponseSchema,
  anonymizeUserRequestSchema,
  createInviteRequestSchema,
  createInviteResponseSchema,
  inviteIdParamsSchema,
  invitesResponseSchema,
  passwordResetLinkResponseSchema,
  updateAdminUserRequestSchema,
  updateWorkspaceRequestSchema,
  userIdParamsSchema,
  workspaceResponseSchema,
} from '@raphasparda/ronin-shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { errorResponses, noContentSchema } from '../../lib/route-schemas';
import { requireAdmin, requireUser } from '../../plugins/session';
import { createInvite, listInvites, revokeInvite } from '../invites/service';
import { createPasswordResetLink } from '../password-resets/service';
import {
  anonymizeUser,
  changeUserRole,
  deactivateUser,
  listAdminUsers,
  reactivateUser,
} from '../users/service';
import { updateWorkspace } from '../workspace/service';

export interface AdminRoutesOptions {
  /** `APP_ORIGIN`: base das URLs de convite e redefinição. */
  appOrigin: string;
}

/**
 * Rotas `/api/admin/*` · Admin (api.md §8). O `preHandler` do plugin exige Admin em todas: roda
 * depois da validação, então a ordem é 401 → 403 CSRF → 400 → 403 (papel) → 404 → 409.
 */
export const adminRoutes: FastifyPluginCallbackZod<AdminRoutesOptions> = (app, opts, done) => {
  app.addHook('preHandler', requireAdmin);

  const ctx = (request: Parameters<typeof requireUser>[0]) => ({
    actorId: requireUser(request).id,
    now: app.clock(),
  });

  // --- Membros ---------------------------------------------------------------

  app.get(
    '/api/admin/users',
    {
      schema: {
        tags: ['admin'],
        summary: 'Usuários com e-mail e data de criação',
        response: { 200: adminUsersResponseSchema, ...errorResponses(401, 403) },
      },
    },
    async () => ({ users: await listAdminUsers(app.db) }),
  );

  app.patch(
    '/api/admin/users/:userId',
    {
      schema: {
        tags: ['admin'],
        summary: 'Altera o papel do usuário',
        params: userIdParamsSchema,
        body: updateAdminUserRequestSchema,
        response: { 200: adminUserResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      user: await changeUserRole(app.db, ctx(request), request.params.userId, request.body.role),
    }),
  );

  app.post(
    '/api/admin/users/:userId/deactivate',
    {
      schema: {
        tags: ['admin'],
        summary: 'Desativa o usuário (encerra sessões e revoga redefinições pendentes)',
        params: userIdParamsSchema,
        response: { 200: adminUserResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      user: await deactivateUser(app.db, ctx(request), request.params.userId),
    }),
  );

  app.post(
    '/api/admin/users/:userId/reactivate',
    {
      schema: {
        tags: ['admin'],
        summary: 'Reativa o usuário',
        params: userIdParamsSchema,
        response: { 200: adminUserResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      user: await reactivateUser(app.db, ctx(request), request.params.userId),
    }),
  );

  app.post(
    '/api/admin/users/:userId/anonymize',
    {
      schema: {
        tags: ['admin'],
        summary:
          'Anonimiza usuário desativado (irreversível; mantém cards, comentários e histórico)',
        params: userIdParamsSchema,
        body: anonymizeUserRequestSchema,
        response: { 200: adminUserResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      user: await anonymizeUser(app.db, ctx(request), request.params.userId),
    }),
  );

  app.post(
    '/api/admin/users/:userId/password-reset-links',
    {
      schema: {
        tags: ['admin'],
        summary: 'Gera link de redefinição de senha (revoga os anteriores; URL exibida uma vez)',
        params: userIdParamsSchema,
        response: {
          201: passwordResetLinkResponseSchema,
          ...errorResponses(400, 401, 403, 404, 409),
        },
      },
    },
    async (request, reply) => {
      const { actorId, now } = ctx(request);
      const link = await createPasswordResetLink(
        { db: app.db, now, appOrigin: opts.appOrigin },
        actorId,
        request.params.userId,
      );
      return reply.status(201).send(link);
    },
  );

  // --- Convites --------------------------------------------------------------

  app.get(
    '/api/admin/invites',
    {
      schema: {
        tags: ['admin'],
        summary: 'Convites dos últimos 30 dias e pendentes, mais recentes primeiro',
        response: { 200: invitesResponseSchema, ...errorResponses(401, 403) },
      },
    },
    async () => ({ invites: await listInvites(app.db, app.clock()) }),
  );

  app.post(
    '/api/admin/invites',
    {
      schema: {
        tags: ['admin'],
        summary: 'Cria convite (URL exibida uma única vez)',
        body: createInviteRequestSchema,
        response: { 201: createInviteResponseSchema, ...errorResponses(400, 401, 403, 409) },
      },
    },
    async (request, reply) => {
      const { actorId, now } = ctx(request);
      const created = await createInvite(
        { db: app.db, now, appOrigin: opts.appOrigin },
        actorId,
        request.body,
      );
      return reply.status(201).send(created);
    },
  );

  app.delete(
    '/api/admin/invites/:inviteId',
    {
      schema: {
        tags: ['admin'],
        summary: 'Revoga o convite, se pendente (idempotente)',
        params: inviteIdParamsSchema,
        response: { 204: noContentSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request, reply) => {
      await revokeInvite(app.db, request.params.inviteId, app.clock());
      return reply.status(204).send(null);
    },
  );

  // --- Workspace -------------------------------------------------------------

  app.patch(
    '/api/admin/workspace',
    {
      schema: {
        tags: ['admin'],
        summary: 'Altera nome e/ou fuso do workspace',
        body: updateWorkspaceRequestSchema,
        response: { 200: workspaceResponseSchema, ...errorResponses(400, 401, 403) },
      },
    },
    async (request) => ({
      workspace: await updateWorkspace(app.db, request.body, app.clock()),
    }),
  );

  done();
};
