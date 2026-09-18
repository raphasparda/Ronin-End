import { z } from 'zod';

import { workspaceSchema } from './auth';
import {
  AT_LEAST_ONE_FIELD_MESSAGE,
  emailSchema,
  hasAtLeastOneField,
  isoDateTimeSchema,
  roleSchema,
  timezoneSchema,
  uuidSchema,
  workspaceNameSchema,
} from './common';
import { adminUserSchema } from './users';

// ---------------------------------------------------------------------------
// Membros (api.md §8, tudo Admin)
// ---------------------------------------------------------------------------

/** `GET /api/admin/users` → 200. */
export const adminUsersResponseSchema = z.object({
  users: z.array(adminUserSchema),
});

/** `PATCH /api/admin/users/:userId` (corpo). */
export const updateAdminUserRequestSchema = z.object({
  role: roleSchema,
});

/**
 * `{ user }` com o usuário na visão de administração. Resposta de
 * `PATCH /api/admin/users/:userId` e de `deactivate`, `reactivate` e `anonymize`.
 */
export const adminUserResponseSchema = z.object({
  user: adminUserSchema,
});

/** `POST /api/admin/users/:userId/anonymize` (corpo): confirmação explícita. */
export const anonymizeUserRequestSchema = z.object({
  confirm: z.literal(true, { error: 'Confirme a anonimização' }),
});

/** `POST /api/admin/users/:userId/password-reset-links` → 201. URL exibida uma única vez. */
export const passwordResetLinkResponseSchema = z.object({
  url: z.string(),
  expiresAt: isoDateTimeSchema,
});

// ---------------------------------------------------------------------------
// Convites (api.md §8)
// ---------------------------------------------------------------------------

export const INVITE_STATES = ['pending', 'used', 'expired', 'revoked'] as const;
export const inviteStateSchema = z.enum(INVITE_STATES);

export const inviteSchema = z.object({
  id: uuidSchema,
  email: z.string().nullable(),
  role: roleSchema,
  createdBy: uuidSchema,
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  state: inviteStateSchema,
  usedByUserId: uuidSchema.nullable(),
});

/** Parâmetro `:inviteId`. */
export const inviteIdParamsSchema = z.object({
  inviteId: uuidSchema,
});

/** `GET /api/admin/invites` → 200. Mais recentes primeiro. */
export const invitesResponseSchema = z.object({
  invites: z.array(inviteSchema),
});

/**
 * `POST /api/admin/invites` (corpo). `email` ausente ou `null` = convite sem e-mail fixo.
 * O formulário deve enviar `null` para campo em branco (string vazia é e-mail inválido).
 */
export const createInviteRequestSchema = z.object({
  email: emailSchema.nullable().default(null),
  role: roleSchema,
});

/** `POST /api/admin/invites` → 201. `url` é exibida uma única vez. */
export const createInviteResponseSchema = z.object({
  invite: inviteSchema,
  url: z.string(),
});

// `DELETE /api/admin/invites/:inviteId` → 204 sem corpo.

// ---------------------------------------------------------------------------
// Workspace (api.md §8)
// ---------------------------------------------------------------------------

/** `PATCH /api/admin/workspace` (corpo): ao menos um campo. */
export const updateWorkspaceRequestSchema = z
  .object({
    name: workspaceNameSchema.optional(),
    timezone: timezoneSchema.optional(),
  })
  .refine(hasAtLeastOneField, { error: AT_LEAST_ONE_FIELD_MESSAGE });

/** `PATCH /api/admin/workspace` → 200. */
export const workspaceResponseSchema = z.object({
  workspace: workspaceSchema,
});

export type AdminUsersResponse = z.infer<typeof adminUsersResponseSchema>;
export type UpdateAdminUserRequest = z.infer<typeof updateAdminUserRequestSchema>;
export type AdminUserResponse = z.infer<typeof adminUserResponseSchema>;
export type AnonymizeUserRequest = z.infer<typeof anonymizeUserRequestSchema>;
export type PasswordResetLinkResponse = z.infer<typeof passwordResetLinkResponseSchema>;
export type InviteState = z.infer<typeof inviteStateSchema>;
export type Invite = z.infer<typeof inviteSchema>;
export type InviteIdParams = z.infer<typeof inviteIdParamsSchema>;
export type InvitesResponse = z.infer<typeof invitesResponseSchema>;
/** Corpo como o formulário envia (`email` opcional). */
export type CreateInviteRequestInput = z.input<typeof createInviteRequestSchema>;
/** Corpo após validação (`email` sempre `string | null`). */
export type CreateInviteRequest = z.output<typeof createInviteRequestSchema>;
export type CreateInviteResponse = z.infer<typeof createInviteResponseSchema>;
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>;
export type WorkspaceResponse = z.infer<typeof workspaceResponseSchema>;
