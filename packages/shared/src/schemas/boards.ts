import { z } from 'zod';

import {
  BOARD_COVER_CONTENT_TYPES,
  BOARD_COVER_MAX_BYTES,
  BOARD_COVER_MAX_DIMENSION,
} from '../domain/constants';

import { cardSummarySchema } from './cards';
import {
  boardVisibilitySchema,
  booleanQuerySchema,
  isoDateTimeSchema,
  textFieldSchema,
  uuidSchema,
} from './common';
import { labelSchema } from './labels';
import { listSchema } from './lists';

// ---------------------------------------------------------------------------
// Quadros (api.md §2 e §9, Fatia 3; visibilidade e capa na Fatia 11)
// ---------------------------------------------------------------------------

/** Nome de quadro: 1 a 100 caracteres após `trim`. */
export const boardNameSchema = textFieldSchema({
  min: 1,
  max: 100,
  required: 'Nome do quadro obrigatório',
  tooLong: 'O nome do quadro pode ter no máximo 100 caracteres',
});

/**
 * Capa do quadro (Fatia 11, ADR 0016). `url` é assinada e de curta duração (validade efetiva de 10
 * a 15 minutos, api.md §18.7 item 55); `expiresAt` diz até quando vale. `width`/`height` são as do
 * arquivo enviado, informadas pelo cliente, e servem só para reservar espaço na tela.
 */
export const boardCoverSchema = z.object({
  url: z.string(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  expiresAt: isoDateTimeSchema,
});

/** Quadro que a pessoa pode abrir. `locked: false` discrimina a união `BoardListItem`. */
export const boardSchema = z.object({
  locked: z.literal(false),
  id: uuidSchema,
  name: z.string(),
  visibility: boardVisibilitySchema,
  /** `null` sem capa ou com o R2 desligado (`features.boardCovers: false`). */
  cover: boardCoverSchema.nullable(),
  archivedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

/**
 * Quadro restrito visto por quem não tem acesso (ADR 0015). São **todos** os campos: sem capa,
 * visibilidade, datas ou qualquer contador. O nome é o que permite reconhecer o cadeado na lista.
 */
export const lockedBoardSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  locked: z.literal(true),
});

/**
 * Item de `GET /api/boards`: união discriminada por `locked`, para que o serializer do Fastify
 * corte qualquer campo fora do formato escolhido.
 */
export const boardListItemSchema = z.discriminatedUnion('locked', [boardSchema, lockedBoardSchema]);

/** Quadro aberto, com a lista de acesso (ordem de inclusão; vazia quando `visibility` é `team`). */
export const boardDetailSchema = boardSchema.extend({
  viewerIds: z.array(uuidSchema),
});

/** Parâmetro `:boardId`. */
export const boardIdParamsSchema = z.object({
  boardId: uuidSchema,
});

/** `GET /api/boards?archived=false|true` (query). Padrão `false`. */
export const boardsQuerySchema = z.object({
  archived: booleanQuerySchema(false),
});

/** `GET /api/boards` → 200. Ordem `name ASC`; quadro restrito sem acesso vem como `LockedBoard`. */
export const boardsResponseSchema = z.object({
  boards: z.array(boardListItemSchema),
});

/** `POST /api/boards` (corpo). */
export const createBoardRequestSchema = z.object({
  name: boardNameSchema,
});

/** `POST /api/boards` → 201: quadro e as 3 listas padrão (`DEFAULT_BOARD_LISTS`). */
export const createBoardResponseSchema = z.object({
  board: boardDetailSchema,
  lists: z.array(listSchema),
});

/**
 * `GET /api/boards/:boardId` → 200 (payload do quadro). Quadro restrito sem acesso →
 * `403 BOARD_RESTRICTED` (ADR 0015).
 * `lists`: não arquivadas, por `position`. `cards`: não arquivados, de listas não
 * arquivadas, por `(listId, position)`. `labels`: por `name`.
 */
export const boardPayloadSchema = z.object({
  board: boardDetailSchema,
  lists: z.array(listSchema),
  cards: z.array(cardSummarySchema),
  labels: z.array(labelSchema),
});

/** `PATCH /api/boards/:boardId` (corpo). */
export const updateBoardRequestSchema = z.object({
  name: boardNameSchema,
});

/** `{ board }`: renomear, arquivar, restaurar, visibilidade e capa (200). */
export const boardResponseSchema = z.object({
  board: boardDetailSchema,
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

/** `GET /api/boards/:boardId/archived` → 200. Ambos por `archivedAt` desc. */
export const boardArchivedResponseSchema = z.object({
  lists: z.array(listSchema),
  cards: z.array(archivedCardSchema),
});

// ---------------------------------------------------------------------------
// Visibilidade e lista de acesso (api.md §9, Fatia 11, ADR 0015)
// ---------------------------------------------------------------------------

/** `PUT /api/boards/:boardId/visibility` (corpo). Idempotente. */
export const updateBoardVisibilityRequestSchema = z.object({
  visibility: boardVisibilitySchema,
});

/** Parâmetros de `PUT|DELETE /api/boards/:boardId/viewers/:userId`. */
export const boardViewerParamsSchema = z.object({
  boardId: uuidSchema,
  userId: uuidSchema,
});

/** `PUT|DELETE /api/boards/:boardId/viewers/:userId` → 200 (ordem de inclusão). */
export const boardViewersResponseSchema = z.object({
  viewerIds: z.array(uuidSchema),
});

// ---------------------------------------------------------------------------
// Capa do quadro (api.md §9, Fatia 11, ADR 0016)
// ---------------------------------------------------------------------------

/** Tipo de conteúdo aceito na capa (RN21). */
export const boardCoverContentTypeSchema = z.enum(BOARD_COVER_CONTENT_TYPES, {
  error: 'Formato não aceito. Use JPEG, PNG ou WebP.',
});

/** Tamanho do arquivo em bytes: 1 a 5 MiB (RN22). */
export const boardCoverSizeSchema = z
  .number({ error: 'Tamanho inválido' })
  .int({ error: 'Tamanho inválido' })
  .min(1, { error: 'Tamanho inválido' })
  .max(BOARD_COVER_MAX_BYTES, { error: 'A imagem passa do limite de 5 MB' });

/** Dimensão informada pelo cliente: 1 a 20.000, ou ausente. */
const boardCoverDimensionSchema = z
  .number({ error: 'Dimensão inválida' })
  .int({ error: 'Dimensão inválida' })
  .min(1, { error: 'Dimensão inválida' })
  .max(BOARD_COVER_MAX_DIMENSION, { error: 'Dimensão inválida' });

/**
 * Chave do objeto no R2: `covers/<boardId>/<32 caracteres base64url>`. O `boardId` precisa ser o da
 * própria rota — conferido no servidor com `isBoardCoverKey` (ADR 0016, I14).
 */
export const boardCoverObjectKeySchema = z
  .string({ error: 'Chave inválida' })
  .regex(/^covers\/[0-9a-fA-F-]{36}\/[A-Za-z0-9_-]{32}$/, { error: 'Chave inválida' });

/** `POST /api/boards/:boardId/cover/upload-url` (corpo). Não grava nada. */
export const boardCoverUploadUrlRequestSchema = z.object({
  contentType: boardCoverContentTypeSchema,
  sizeBytes: boardCoverSizeSchema,
});

/**
 * `POST /api/boards/:boardId/cover/upload-url` → 200. A URL vale 5 minutos e assina tipo e
 * tamanho; `headers` traz o que o `PUT` no R2 precisa repetir.
 */
export const boardCoverUploadUrlResponseSchema = z.object({
  uploadUrl: z.string(),
  objectKey: boardCoverObjectKeySchema,
  expiresAt: isoDateTimeSchema,
  headers: z.record(z.string(), z.string()),
});

/** `PUT /api/boards/:boardId/cover` (corpo): confirma o upload direto. */
export const confirmBoardCoverRequestSchema = z.object({
  objectKey: boardCoverObjectKeySchema,
  width: boardCoverDimensionSchema.optional(),
  height: boardCoverDimensionSchema.optional(),
});

export type BoardCover = z.infer<typeof boardCoverSchema>;
export type Board = z.infer<typeof boardSchema>;
export type LockedBoard = z.infer<typeof lockedBoardSchema>;
export type BoardListItem = z.infer<typeof boardListItemSchema>;
export type BoardDetail = z.infer<typeof boardDetailSchema>;
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
export type BoardArchivedResponse = z.infer<typeof boardArchivedResponseSchema>;
export type UpdateBoardVisibilityRequest = z.infer<typeof updateBoardVisibilityRequestSchema>;
export type BoardViewerParams = z.infer<typeof boardViewerParamsSchema>;
export type BoardViewersResponse = z.infer<typeof boardViewersResponseSchema>;
export type BoardCoverUploadUrlRequest = z.infer<typeof boardCoverUploadUrlRequestSchema>;
export type BoardCoverUploadUrlResponse = z.infer<typeof boardCoverUploadUrlResponseSchema>;
export type ConfirmBoardCoverRequest = z.infer<typeof confirmBoardCoverRequestSchema>;
