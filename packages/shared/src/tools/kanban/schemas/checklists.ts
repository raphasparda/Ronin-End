import { z } from 'zod';

import {
  AT_LEAST_ONE_FIELD_MESSAGE,
  hasAtLeastOneField,
  isoDateTimeSchema,
  placementSchema,
  textFieldSchema,
  uuidSchema,
} from '../../../platform/schemas/common';

// ---------------------------------------------------------------------------
// Checklists (api.md §2 e §13, Fatia 6)
// ---------------------------------------------------------------------------

/** Título de checklist: 1 a 200 caracteres após `trim`. */
export const checklistTitleSchema = textFieldSchema({
  min: 1,
  max: 200,
  required: 'Título do checklist obrigatório',
  tooLong: 'O título do checklist pode ter no máximo 200 caracteres',
});

/** Texto de item: 1 a 500 caracteres após `trim`. */
export const checklistItemTextSchema = textFieldSchema({
  min: 1,
  max: 500,
  required: 'Texto do item obrigatório',
  tooLong: 'O item pode ter no máximo 500 caracteres',
});

export const checklistItemSchema = z.object({
  id: uuidSchema,
  checklistId: uuidSchema,
  text: z.string(),
  position: z.string(),
  isChecked: z.boolean(),
  checkedBy: uuidSchema.nullable(),
  checkedAt: isoDateTimeSchema.nullable(),
});

/** Checklist com itens ordenados por `position` (comparação binária). */
export const checklistSchema = z.object({
  id: uuidSchema,
  cardId: uuidSchema,
  title: z.string(),
  createdAt: isoDateTimeSchema,
  items: z.array(checklistItemSchema),
});

/** Parâmetro `:checklistId`. */
export const checklistIdParamsSchema = z.object({
  checklistId: uuidSchema,
});

/** Parâmetro `:itemId`. */
export const checklistItemIdParamsSchema = z.object({
  itemId: uuidSchema,
});

/** `POST /api/cards/:cardId/checklists` (corpo). A UI sugere `DEFAULT_CHECKLIST_TITLE`. */
export const createChecklistRequestSchema = z.object({
  title: checklistTitleSchema,
});

/** `PATCH /api/checklists/:checklistId` (corpo). */
export const updateChecklistRequestSchema = z.object({
  title: checklistTitleSchema,
});

/** `{ checklist }`: criar (201) e renomear (200). `DELETE` → 204. */
export const checklistResponseSchema = z.object({
  checklist: checklistSchema,
});

/** `POST /api/checklists/:checklistId/items` (corpo). Cria no fim. */
export const createChecklistItemRequestSchema = z.object({
  text: checklistItemTextSchema,
});

/** `PATCH /api/checklist-items/:itemId` (corpo): ao menos um campo. */
export const updateChecklistItemRequestSchema = z
  .object({
    text: checklistItemTextSchema.optional(),
    isChecked: z.boolean({ error: 'Valor inválido' }).optional(),
  })
  .refine(hasAtLeastOneField, { error: AT_LEAST_ONE_FIELD_MESSAGE });

/** `POST /api/checklist-items/:itemId/move` (corpo): dentro do mesmo checklist. */
export const moveChecklistItemRequestSchema = z.object({
  placement: placementSchema,
});

/** `{ item }`: criar (201), editar e mover (200). `DELETE` → 204. */
export const checklistItemResponseSchema = z.object({
  item: checklistItemSchema,
});

export type ChecklistItem = z.infer<typeof checklistItemSchema>;
export type Checklist = z.infer<typeof checklistSchema>;
export type ChecklistIdParams = z.infer<typeof checklistIdParamsSchema>;
export type ChecklistItemIdParams = z.infer<typeof checklistItemIdParamsSchema>;
export type CreateChecklistRequest = z.infer<typeof createChecklistRequestSchema>;
export type UpdateChecklistRequest = z.infer<typeof updateChecklistRequestSchema>;
export type ChecklistResponse = z.infer<typeof checklistResponseSchema>;
export type CreateChecklistItemRequest = z.infer<typeof createChecklistItemRequestSchema>;
export type UpdateChecklistItemRequest = z.infer<typeof updateChecklistItemRequestSchema>;
export type MoveChecklistItemRequest = z.infer<typeof moveChecklistItemRequestSchema>;
export type ChecklistItemResponse = z.infer<typeof checklistItemResponseSchema>;
