import { z } from 'zod';

import {
  AVATAR_CONTENT_TYPES,
  AVATAR_MAX_BASE64_LENGTH,
  AVATAR_MAX_BYTES,
} from '../../tools/kanban/domain/constants';

import { loginPasswordSchema, sessionUserSchema } from './auth';
import { cardSummarySchema } from '../../tools/kanban/schemas/cards';
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

// ---------------------------------------------------------------------------
// Foto de perfil (api.md §6)
// ---------------------------------------------------------------------------

export const AVATAR_TOO_LARGE_MESSAGE = `A imagem pode ter no máximo ${Math.round(
  AVATAR_MAX_BYTES / 1024,
)} KB`;

/**
 * `PUT /api/me/avatar` (corpo). A imagem vai em base64 porque a API só aceita JSON
 * (overview.md §6.3); o front já envia um quadrado de `AVATAR_SIZE_PX` em WebP.
 * O servidor ainda confere o tamanho em bytes depois de decodificar.
 */
export const updateAvatarRequestSchema = z.object({
  contentType: z.enum(AVATAR_CONTENT_TYPES, { error: 'Formato de imagem não suportado' }),
  data: z
    .base64({ error: 'Imagem inválida' })
    .min(1, { error: 'Imagem inválida' })
    .max(AVATAR_MAX_BASE64_LENGTH, { error: AVATAR_TOO_LARGE_MESSAGE }),
});

/** `PUT /api/me/avatar` → 200. Mesmo formato de `PATCH /api/me`. */
export const updateAvatarResponseSchema = updateMeResponseSchema;

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
export type UpdateAvatarRequest = z.infer<typeof updateAvatarRequestSchema>;
export type UpdateAvatarResponse = z.infer<typeof updateAvatarResponseSchema>;
export type UpdateMeResponse = z.infer<typeof updateMeResponseSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
export type MyCard = z.infer<typeof myCardSchema>;
export type MyCardsResponse = z.infer<typeof myCardsResponseSchema>;
