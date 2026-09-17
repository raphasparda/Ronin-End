import { z } from 'zod';

import { boardCardSchema, cardSummarySchema, lockedCardSchema } from './cards';
import { booleanQuerySchema, isoDateTimeSchema, textFieldSchema, uuidSchema } from './common';
import { labelSchema } from './labels';
import { listSchema } from './lists';

// ---------------------------------------------------------------------------
// Quadros (api.md §2 e §9, Fatia 3)
// ---------------------------------------------------------------------------

/** Nome de quadro: 1 a 100 caracteres após `trim`. */
export const boardNameSchema = textFieldSchema({
  min: 1,
  max: 100,
  required: 'Nome do quadro obrigatório',
  tooLong: 'O nome do quadro pode ter no máximo 100 caracteres',
});

export const boardSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  archivedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

/** Parâmetro `:boardId`. */
export const boardIdParamsSchema = z.object({
  boardId: uuidSchema,
});

/** `GET /api/boards?archived=false|true` (query). Padrão `false`. */
export const boardsQuerySchema = z.object({
  archived: booleanQuerySchema(false),
});

/** `GET /api/boards` → 200. Ordem `name ASC`. */
export const boardsResponseSchema = z.object({
  boards: z.array(boardSchema),
});

/** `POST /api/boards` (corpo). */
export const createBoardRequestSchema = z.object({
  name: boardNameSchema,
});

/** `POST /api/boards` → 201: quadro e as 3 listas padrão (`DEFAULT_BOARD_LISTS`). */
export const createBoardResponseSchema = z.object({
  board: boardSchema,
  lists: z.array(listSchema),
});

/**
 * `GET /api/boards/:boardId` → 200 (payload do quadro).
 * `lists`: não arquivadas, por `position`. `cards`: não arquivados, de listas não
 * arquivadas, por `(listId, position)`; card restrito sem acesso entra como `LockedCard`
 * (ADR 0015). `labels`: por `name`.
 */
export const boardPayloadSchema = z.object({
  board: boardSchema,
  lists: z.array(listSchema),
  cards: z.array(boardCardSchema),
  labels: z.array(labelSchema),
});

/** `PATCH /api/boards/:boardId` (corpo). */
export const updateBoardRequestSchema = z.object({
  name: boardNameSchema,
});

/** `{ board }`: renomear, arquivar e restaurar (200). */
export const boardResponseSchema = z.object({
  board: boardSchema,
});

/**
 * `DELETE /api/boards/:boardId` (corpo, Admin) → 204.
 * Comparação exata com o nome após `trim`; diferente → 400 `CONFIRMATION_MISMATCH`.
 */
export const deleteBoardRequestSchema = z.object({
  confirmName: textFieldSchema({
    min: 1,
    max: 100,
    required: 'Digite o nome do quadro para confirmar',
    tooLong: 'O nome digitado não confere',
  }),
});

/** Card arquivado individualmente, com o contexto da lista. */
export const archivedCardSchema = cardSummarySchema.extend({
  listName: z.string(),
  listArchived: z.boolean(),
});

/**
 * Item da lista de arquivados: união discriminada por `locked`. Card restrito sem acesso vira
 * `LockedCard` — sem a lista de origem e sem nenhum outro campo (ADR 0015, scope §11 F4).
 */
export const boardArchivedCardSchema = z.discriminatedUnion('locked', [
  archivedCardSchema,
  lockedCardSchema,
]);

/** `GET /api/boards/:boardId/archived` → 200. Ambos por `archivedAt` desc. */
export const boardArchivedResponseSchema = z.object({
  lists: z.array(listSchema),
  cards: z.array(boardArchivedCardSchema),
});

export type Board = z.infer<typeof boardSchema>;
export type BoardIdParams = z.infer<typeof boardIdParamsSchema>;
/** Query como o cliente envia (`archived` opcional, string). */
export type BoardsQueryInput = z.input<typeof boardsQuerySchema>;
/** Query após validação (`archived` booleano). */
export type BoardsQuery = z.output<typeof boardsQuerySchema>;
export type BoardsResponse = z.infer<typeof boardsResponseSchema>;
export type CreateBoardRequest = z.infer<typeof createBoardRequestSchema>;
export type CreateBoardResponse = z.infer<typeof createBoardResponseSchema>;
export type BoardPayload = z.infer<typeof boardPayloadSchema>;
export type UpdateBoardRequest = z.infer<typeof updateBoardRequestSchema>;
export type BoardResponse = z.infer<typeof boardResponseSchema>;
export type DeleteBoardRequest = z.infer<typeof deleteBoardRequestSchema>;
export type ArchivedCard = z.infer<typeof archivedCardSchema>;
export type BoardArchivedCard = z.infer<typeof boardArchivedCardSchema>;
export type BoardArchivedResponse = z.infer<typeof boardArchivedResponseSchema>;
