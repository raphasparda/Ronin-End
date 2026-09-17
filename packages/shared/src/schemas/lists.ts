import { z } from 'zod';

import {
  AT_LEAST_ONE_FIELD_MESSAGE,
  hasAtLeastOneField,
  isoDateTimeSchema,
  paletteColorSchema,
  placementSchema,
  textFieldSchema,
  uuidSchema,
} from './common';

// ---------------------------------------------------------------------------
// Listas (api.md §2 e §10, Fatias 3 e 8)
// ---------------------------------------------------------------------------

/** Nome de lista: 1 a 100 caracteres após `trim`. */
export const listNameSchema = textFieldSchema({
  min: 1,
  max: 100,
  required: 'Nome da lista obrigatório',
  tooLong: 'O nome da lista pode ter no máximo 100 caracteres',
});

export const listSchema = z.object({
  id: uuidSchema,
  boardId: uuidSchema,
  name: z.string(),
  position: z.string(),
  isDoneList: z.boolean(),
  color: paletteColorSchema,
  archivedAt: isoDateTimeSchema.nullable(),
});

/** Parâmetro `:listId`. */
export const listIdParamsSchema = z.object({
  listId: uuidSchema,
});

/**
 * `POST /api/boards/:boardId/lists` (corpo).
 * `color` ausente: o servidor usa `nextPaletteColor(cor da última lista ativa)`.
 * `placement` ausente vira `{ type: 'end' }`.
 */
export const createListRequestSchema = z.object({
  name: listNameSchema,
  color: paletteColorSchema.optional(),
  placement: placementSchema.default({ type: 'end' }),
});

/** `{ list }`: criar (201), mover, arquivar e restaurar (200). */
export const listResponseSchema = z.object({
  list: listSchema,
});

/** `PATCH /api/lists/:listId` (corpo): ao menos um campo. Cor fora da paleta → 400. */
export const updateListRequestSchema = z
  .object({
    name: listNameSchema.optional(),
    isDoneList: z.boolean({ error: 'Valor inválido' }).optional(),
    color: paletteColorSchema.optional(),
  })
  .refine(hasAtLeastOneField, { error: AT_LEAST_ONE_FIELD_MESSAGE });

/**
 * `PATCH /api/lists/:listId` → 200: **todas** as listas ativas do quadro (a marcação de
 * conclusão pode ter mudado em outra) e os cards concluídos por esta ação (`[]` se nenhum).
 */
export const updateListResponseSchema = z.object({
  lists: z.array(listSchema),
  completedCardIds: z.array(uuidSchema),
});

/** `POST /api/lists/:listId/move` (corpo): dentro do mesmo quadro. */
export const moveListRequestSchema = z.object({
  placement: placementSchema,
});

export type List = z.infer<typeof listSchema>;
export type ListIdParams = z.infer<typeof listIdParamsSchema>;
/** Corpo como o cliente envia (`color` e `placement` opcionais). */
export type CreateListRequestInput = z.input<typeof createListRequestSchema>;
/** Corpo após validação (`placement` preenchido). */
export type CreateListRequest = z.output<typeof createListRequestSchema>;
export type ListResponse = z.infer<typeof listResponseSchema>;
export type UpdateListRequest = z.infer<typeof updateListRequestSchema>;
export type UpdateListResponse = z.infer<typeof updateListResponseSchema>;
export type MoveListRequest = z.infer<typeof moveListRequestSchema>;
