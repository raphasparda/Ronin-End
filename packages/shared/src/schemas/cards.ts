import { z } from 'zod';

import { checklistSchema } from './checklists';
import { commentSchema } from './comments';
import {
  AT_LEAST_ONE_FIELD_MESSAGE,
  cardPrioritySchema,
  cardStatusSchema,
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

/** Face do card (payload do quadro). */
export const cardSummarySchema = z.object({
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
  labelIds: z.array(uuidSchema),
  assigneeIds: z.array(uuidSchema),
  checklist: checklistCountSchema,
  commentCount: z.number().int().nonnegative(),
  hasDescription: z.boolean(),
  archivedAt: isoDateTimeSchema.nullable(),
});

/** Detalhe do card (`GET /api/cards/:cardId`). */
export const cardDetailSchema = cardSummarySchema.extend({
  description: z.string(),
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

export type CardIdParams = z.infer<typeof cardIdParamsSchema>;
export type ChecklistCount = z.infer<typeof checklistCountSchema>;
export type CardSummary = z.infer<typeof cardSummarySchema>;
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
