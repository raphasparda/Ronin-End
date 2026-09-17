import { z } from 'zod';

import { loginPasswordSchema, sessionUserSchema } from './auth';
import { cardSummarySchema } from './cards';
import { paletteColorSchema, passwordSchema, userNameSchema } from './common';

// ---------------------------------------------------------------------------
// Usuário da sessão (api.md §6, Fatias 2 e 9)
// ---------------------------------------------------------------------------

/** `PATCH /api/me` (corpo). */
export const updateMeRequestSchema = z.object({
  name: userNameSchema,
});

/** `PATCH /api/me` → 200. */
export const updateMeResponseSchema = z.object({
  user: sessionUserSchema,
});

/**
 * `POST /api/me/password` (corpo) → 204.
 * `currentPassword` segue a regra do login (1–256, não revela política).
 * `newPassword` segue a política de cadastro; igual ao e-mail da sessão é recusada no
 * servidor com `isPasswordSameAsEmail` → 400 `VALIDATION_ERROR` em `newPassword`.
 * Senha atual errada → 400 `PASSWORD_INCORRECT`.
 */
export const changePasswordRequestSchema = z.object({
  currentPassword: loginPasswordSchema,
  newPassword: passwordSchema,
});

/** Item de "Meus cards": face do card com quadro e lista de origem. */
export const myCardSchema = cardSummarySchema.extend({
  boardName: z.string(),
  listName: z.string(),
  listColor: paletteColorSchema,
});

/**
 * `GET /api/me/cards` → 200. Ordem do servidor: `dueAt ASC NULLS LAST`, prioridade
 * (Urgente → sem prioridade), `createdAt ASC`. Agrupar com `groupMyCards`.
 */
export const myCardsResponseSchema = z.object({
  cards: z.array(myCardSchema),
});

export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>;
export type UpdateMeResponse = z.infer<typeof updateMeResponseSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
export type MyCard = z.infer<typeof myCardSchema>;
export type MyCardsResponse = z.infer<typeof myCardsResponseSchema>;
