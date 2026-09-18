import { z } from 'zod';

import { isoDateTimeSchema, roleSchema, userStatusSchema, uuidSchema } from './common';

// ---------------------------------------------------------------------------
// Usuários (api.md §2 e §7, Fatia 2)
// ---------------------------------------------------------------------------

/**
 * Visão pública de usuário (listas, avatares, atribuição). **Sem e-mail**: membros não
 * veem o e-mail de colegas (overview.md §6.6). Como a resposta é serializada por este
 * schema, um `email` vindo do banco é descartado.
 */
export const userSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  role: roleSchema,
  status: userStatusSchema,
  anonymized: z.boolean(),
  /** Quando a foto foi enviada; `null` sem foto. Versiona a URL do avatar (api.md §7). */
  avatarUpdatedAt: isoDateTimeSchema.nullable(),
});

/** Usuário na administração (api.md §8): inclui e-mail (nulo se anonimizado) e criação. */
export const adminUserSchema = userSummarySchema.extend({
  email: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});

/** Parâmetro `:userId`. */
export const userIdParamsSchema = z.object({
  userId: uuidSchema,
});

/** `GET /api/users` → 200. Todos os usuários, por nome. */
export const usersResponseSchema = z.object({
  users: z.array(userSummarySchema),
});

export type UserSummary = z.infer<typeof userSummarySchema>;
export type AdminUser = z.infer<typeof adminUserSchema>;
export type UserIdParams = z.infer<typeof userIdParamsSchema>;
export type UsersResponse = z.infer<typeof usersResponseSchema>;
