import { z } from 'zod';

import {
  AT_LEAST_ONE_FIELD_MESSAGE,
  hasAtLeastOneField,
  paletteColorSchema,
  textFieldSchema,
  uuidSchema,
} from './common';

// ---------------------------------------------------------------------------
// Etiquetas (api.md §2, §11 e §12, Fatia 5)
// ---------------------------------------------------------------------------

/** Nome de etiqueta: 1 a 50 caracteres após `trim`. */
export const labelNameSchema = textFieldSchema({
  min: 1,
  max: 50,
  required: 'Nome da etiqueta obrigatório',
  tooLong: 'O nome da etiqueta pode ter no máximo 50 caracteres',
});

export const labelSchema = z.object({
  id: uuidSchema,
  boardId: uuidSchema,
  name: z.string(),
  color: paletteColorSchema,
});

/** Parâmetro `:labelId`. */
export const labelIdParamsSchema = z.object({
  labelId: uuidSchema,
});

/** `POST /api/boards/:boardId/labels` (corpo). */
export const createLabelRequestSchema = z.object({
  name: labelNameSchema,
  color: paletteColorSchema,
});

/** `PATCH /api/labels/:labelId` (corpo): ao menos um campo. */
export const updateLabelRequestSchema = z
  .object({
    name: labelNameSchema.optional(),
    color: paletteColorSchema.optional(),
  })
  .refine(hasAtLeastOneField, { error: AT_LEAST_ONE_FIELD_MESSAGE });

/** `{ label }`: resposta de criar (201) e editar (200). `DELETE` → 204. */
export const labelResponseSchema = z.object({
  label: labelSchema,
});

/** Parâmetros de `PUT|DELETE /api/cards/:cardId/labels/:labelId`. */
export const cardLabelParamsSchema = z.object({
  cardId: uuidSchema,
  labelId: uuidSchema,
});

/** `PUT|DELETE /api/cards/:cardId/labels/:labelId` → 200. */
export const cardLabelsResponseSchema = z.object({
  labelIds: z.array(uuidSchema),
});

export type Label = z.infer<typeof labelSchema>;
export type LabelIdParams = z.infer<typeof labelIdParamsSchema>;
export type CreateLabelRequest = z.infer<typeof createLabelRequestSchema>;
export type UpdateLabelRequest = z.infer<typeof updateLabelRequestSchema>;
export type LabelResponse = z.infer<typeof labelResponseSchema>;
export type CardLabelParams = z.infer<typeof cardLabelParamsSchema>;
export type CardLabelsResponse = z.infer<typeof cardLabelsResponseSchema>;
