import { z } from 'zod';

import {
  CARD_COVER_CONTENT_TYPES,
  CARD_COVER_MAX_BYTES,
  CARD_COVER_MAX_DIMENSION,
} from '../domain/constants';

import { checklistSchema } from './checklists';
import { commentSchema } from './comments';
import {
  AT_LEAST_ONE_FIELD_MESSAGE,
  cardPrioritySchema,
  cardStatusSchema,
  cardVisibilitySchema,
  dueInputSchema,
  hasAtLeastOneField,
  isoDateTimeSchema,
  paletteColorSchema,
  placementSchema,
  uuidSchema,
} from './common';

// ---------------------------------------------------------------------------
// Cards (api.md §2 e §11, Fatias 4, 5 e 8)
// ---------------------------------------------------------------------------

/**
 * Título do card: quebras de linha viram espaço, depois `trim`; 1 a 500 caracteres.
 */
export const cardTitleSchema = z
  .string({ error: 'Título obrigatório' })
  .overwrite((value) => value.replace(/\r\n|[\r\n]/g, ' '))
  .trim()
  .min(1, { error: 'Título obrigatório' })
  .max(500, { error: 'O título pode ter no máximo 500 caracteres' });

/** Descrição (Markdown): 0 a 20.000 caracteres após `trim`. */
export const cardDescriptionSchema = z
  .string({ error: 'Descrição inválida' })
  .trim()
  .max(20_000, { error: 'A descrição pode ter no máximo 20.000 caracteres' });

/** Parâmetro `:cardId`. */
export const cardIdParamsSchema = z.object({
  cardId: uuidSchema,
});

/** Progresso somado de todos os checklists do card. */
export const checklistCountSchema = z.object({
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

/**
 * Capa do card (Fatia 11, ADR 0016). `url` é assinada e de curta duração (validade efetiva de 10 a
 * 15 minutos, api.md §18.7 item 55); `expiresAt` diz até quando vale. `width`/`height` são as do
 * arquivo enviado, informadas pelo cliente, e servem só para reservar espaço na tela.
 */
export const cardCoverSchema = z.object({
  url: z.string(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  expiresAt: isoDateTimeSchema,
});

/** Face do card (payload do quadro). `locked: false` discrimina a união `BoardCard`. */
export const cardSummarySchema = z.object({
  locked: z.literal(false),
  id: uuidSchema,
  boardId: uuidSchema,
  listId: uuidSchema,
  title: z.string(),
  position: z.string(),
  status: cardStatusSchema,
  completedAt: isoDateTimeSchema.nullable(),
  dueAt: isoDateTimeSchema.nullable(),
  dueHasTime: z.boolean(),
  priority: cardPrioritySchema.nullable(),
  visibility: cardVisibilitySchema,
  labelIds: z.array(uuidSchema),
  assigneeIds: z.array(uuidSchema),
  checklist: checklistCountSchema,
  commentCount: z.number().int().nonnegative(),
  hasDescription: z.boolean(),
  /** `null` sem capa ou com o R2 desligado (`features.cardCovers: false`). */
  cover: cardCoverSchema.nullable(),
  archivedAt: isoDateTimeSchema.nullable(),
});

/**
 * Card restrito visto por quem não tem acesso (ADR 0015). São **todos** os campos: sem etiquetas,
 * responsáveis, prazo, prioridade, contadores, capa, status ou `archivedAt`.
 */
export const lockedCardSchema = z.object({
  id: uuidSchema,
  listId: uuidSchema,
  position: z.string(),
  title: z.string(),
  locked: z.literal(true),
});

/**
 * Onde cards aparecem em lista (payload do quadro), o item é uma união discriminada por `locked`:
 * o serializer do Fastify corta qualquer campo fora do formato escolhido.
 */
export const boardCardSchema = z.discriminatedUnion('locked', [
  cardSummarySchema,
  lockedCardSchema,
]);

/** Detalhe do card (`GET /api/cards/:cardId`). */
export const cardDetailSchema = cardSummarySchema.extend({
  description: z.string(),
  /** Lista de acesso (ordem de inclusão). Vazia quando `visibility` é `team` (ADR 0015). */
  viewerIds: z.array(uuidSchema),
  completedBy: uuidSchema.nullable(),
  createdBy: uuidSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  board: z.object({
    id: uuidSchema,
    name: z.string(),
    archived: z.boolean(),
  }),
  list: z.object({
    id: uuidSchema,
    name: z.string(),
    color: paletteColorSchema,
    isDoneList: z.boolean(),
    archived: z.boolean(),
  }),
  /** Ordem de criação. */
  checklists: z.array(checklistSchema),
  /** Ordem cronológica crescente. */
  comments: z.array(commentSchema),
});

/** `POST /api/lists/:listId/cards` (corpo). Cria no fim da lista. */
export const createCardRequestSchema = z.object({
  title: cardTitleSchema,
});

/** `{ card: CardSummary }`: criar (201), arquivar e restaurar (200). */
export const cardSummaryResponseSchema = z.object({
  card: cardSummarySchema,
});

/** `{ card: CardDetail }`: `GET` e `PATCH /api/cards/:cardId` (200). */
export const cardDetailResponseSchema = z.object({
  card: cardDetailSchema,
});

/**
 * `PATCH /api/cards/:cardId` (corpo): ao menos um campo.
 * `due: null` remove o prazo; `priority: null` remove a prioridade.
 */
export const updateCardRequestSchema = z
  .object({
    title: cardTitleSchema.optional(),
    description: cardDescriptionSchema.optional(),
    due: dueInputSchema.nullable().optional(),
    priority: cardPrioritySchema.nullable().optional(),
  })
  .refine(hasAtLeastOneField, { error: AT_LEAST_ONE_FIELD_MESSAGE });

/** `POST /api/cards/:cardId/move` (corpo). */
export const moveCardRequestSchema = z.object({
  toListId: uuidSchema,
  placement: placementSchema,
});

export const COMPLETION_CHANGES = ['completed', 'reopened'] as const;
export const completionChangeSchema = z.enum(COMPLETION_CHANGES);

/**
 * Resultado de `move`, `complete` e `reopen` (200).
 * `completionChange` nulo = status não mudou. `removedLabelIds` só é não vazio em move
 * entre quadros.
 */
export const cardMutationResultSchema = z.object({
  card: cardSummarySchema,
  completionChange: completionChangeSchema.nullable(),
  removedLabelIds: z.array(uuidSchema),
});

// `DELETE /api/cards/:cardId` (Admin) → 204 sem corpo.

/** Parâmetros de `PUT|DELETE /api/cards/:cardId/assignees/:userId`. */
export const cardAssigneeParamsSchema = z.object({
  cardId: uuidSchema,
  userId: uuidSchema,
});

/** `PUT|DELETE /api/cards/:cardId/assignees/:userId` → 200. */
export const cardAssigneesResponseSchema = z.object({
  assigneeIds: z.array(uuidSchema),
});

// ---------------------------------------------------------------------------
// Visibilidade e lista de acesso (api.md §11, Fatia 11, ADR 0015)
// ---------------------------------------------------------------------------

/** `PUT /api/cards/:cardId/visibility` (corpo). Idempotente. */
export const updateCardVisibilityRequestSchema = z.object({
  visibility: cardVisibilitySchema,
});

/** Parâmetros de `PUT|DELETE /api/cards/:cardId/viewers/:userId`. */
export const cardViewerParamsSchema = z.object({
  cardId: uuidSchema,
  userId: uuidSchema,
});

/** `PUT|DELETE /api/cards/:cardId/viewers/:userId` → 200 (ordem de inclusão). */
export const cardViewersResponseSchema = z.object({
  viewerIds: z.array(uuidSchema),
});

// ---------------------------------------------------------------------------
// Capa do card (api.md §11, Fatia 11, ADR 0016)
// ---------------------------------------------------------------------------

/** Tipo de conteúdo aceito na capa (RN21). */
export const cardCoverContentTypeSchema = z.enum(CARD_COVER_CONTENT_TYPES, {
  error: 'Formato não aceito. Use JPEG, PNG ou WebP.',
});

/** Tamanho do arquivo em bytes: 1 a 5 MiB (RN22). */
export const cardCoverSizeSchema = z
  .number({ error: 'Tamanho inválido' })
  .int({ error: 'Tamanho inválido' })
  .min(1, { error: 'Tamanho inválido' })
  .max(CARD_COVER_MAX_BYTES, { error: 'A imagem passa do limite de 5 MB' });

/** Dimensão informada pelo cliente: 1 a 20.000, ou ausente. */
const cardCoverDimensionSchema = z
  .number({ error: 'Dimensão inválida' })
  .int({ error: 'Dimensão inválida' })
  .min(1, { error: 'Dimensão inválida' })
  .max(CARD_COVER_MAX_DIMENSION, { error: 'Dimensão inválida' });

/**
 * Chave do objeto no R2: `covers/<cardId>/<32 caracteres base64url>`. O `cardId` precisa ser o da
 * própria rota — conferido no servidor com `isCardCoverKey` (ADR 0016, I14).
 */
export const cardCoverObjectKeySchema = z
  .string({ error: 'Chave inválida' })
  .regex(/^covers\/[0-9a-fA-F-]{36}\/[A-Za-z0-9_-]{32}$/, { error: 'Chave inválida' });

/** `POST /api/cards/:cardId/cover/upload-url` (corpo). Não grava nada. */
export const cardCoverUploadUrlRequestSchema = z.object({
  contentType: cardCoverContentTypeSchema,
  sizeBytes: cardCoverSizeSchema,
});

/**
 * `POST /api/cards/:cardId/cover/upload-url` → 200. A URL vale 5 minutos e assina tipo e tamanho;
 * `headers` traz o que o `PUT` no R2 precisa repetir.
 */
export const cardCoverUploadUrlResponseSchema = z.object({
  uploadUrl: z.string(),
  objectKey: cardCoverObjectKeySchema,
  expiresAt: isoDateTimeSchema,
  headers: z.record(z.string(), z.string()),
});

/** `PUT /api/cards/:cardId/cover` (corpo): confirma o upload direto. */
export const confirmCardCoverRequestSchema = z.object({
  objectKey: cardCoverObjectKeySchema,
  width: cardCoverDimensionSchema.optional(),
  height: cardCoverDimensionSchema.optional(),
});

export type CardIdParams = z.infer<typeof cardIdParamsSchema>;
export type ChecklistCount = z.infer<typeof checklistCountSchema>;
export type CardCover = z.infer<typeof cardCoverSchema>;
export type CardSummary = z.infer<typeof cardSummarySchema>;
export type LockedCard = z.infer<typeof lockedCardSchema>;
export type BoardCard = z.infer<typeof boardCardSchema>;
export type CardDetail = z.infer<typeof cardDetailSchema>;
export type CreateCardRequest = z.infer<typeof createCardRequestSchema>;
export type CardSummaryResponse = z.infer<typeof cardSummaryResponseSchema>;
export type CardDetailResponse = z.infer<typeof cardDetailResponseSchema>;
export type UpdateCardRequest = z.infer<typeof updateCardRequestSchema>;
export type MoveCardRequest = z.infer<typeof moveCardRequestSchema>;
export type CompletionChange = z.infer<typeof completionChangeSchema>;
export type CardMutationResult = z.infer<typeof cardMutationResultSchema>;
export type CardAssigneeParams = z.infer<typeof cardAssigneeParamsSchema>;
export type CardAssigneesResponse = z.infer<typeof cardAssigneesResponseSchema>;
export type UpdateCardVisibilityRequest = z.infer<typeof updateCardVisibilityRequestSchema>;
export type CardViewerParams = z.infer<typeof cardViewerParamsSchema>;
export type CardViewersResponse = z.infer<typeof cardViewersResponseSchema>;
export type CardCoverUploadUrlRequest = z.infer<typeof cardCoverUploadUrlRequestSchema>;
export type CardCoverUploadUrlResponse = z.infer<typeof cardCoverUploadUrlResponseSchema>;
export type ConfirmCardCoverRequest = z.infer<typeof confirmCardCoverRequestSchema>;
