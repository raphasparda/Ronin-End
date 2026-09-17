import { z } from 'zod';

import { isoDateTimeSchema, textFieldSchema, uuidSchema } from './common';

// ---------------------------------------------------------------------------
// Comentários (api.md §2 e §14, Fatia 6)
// ---------------------------------------------------------------------------

/** Corpo do comentário (Markdown): 1 a 10.000 caracteres após `trim`. */
export const commentBodySchema = textFieldSchema({
  min: 1,
  max: 10_000,
  required: 'Comentário vazio',
  tooLong: 'O comentário pode ter no máximo 10.000 caracteres',
});

export const commentSchema = z.object({
  id: uuidSchema,
  cardId: uuidSchema,
  authorId: uuidSchema,
  body: z.string(),
  editedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});

/** Parâmetro `:commentId`. */
export const commentIdParamsSchema = z.object({
  commentId: uuidSchema,
});

/** `POST /api/cards/:cardId/comments` (corpo). */
export const createCommentRequestSchema = z.object({
  body: commentBodySchema,
});

/** `PATCH /api/comments/:commentId` (corpo). Só o autor. */
export const updateCommentRequestSchema = z.object({
  body: commentBodySchema,
});

/** `{ comment }`: criar (201) e editar (200). `DELETE` → 204. */
export const commentResponseSchema = z.object({
  comment: commentSchema,
});

export type Comment = z.infer<typeof commentSchema>;
export type CommentIdParams = z.infer<typeof commentIdParamsSchema>;
export type CreateCommentRequest = z.infer<typeof createCommentRequestSchema>;
export type UpdateCommentRequest = z.infer<typeof updateCommentRequestSchema>;
export type CommentResponse = z.infer<typeof commentResponseSchema>;
