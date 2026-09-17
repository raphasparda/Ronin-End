import { z } from 'zod';

import { cardPrioritySchema, cardVisibilitySchema, isoDateTimeSchema, uuidSchema } from './common';

// ---------------------------------------------------------------------------
// Atividade do card (api.md §11, overview.md §5.3, Fatia 4)
// ---------------------------------------------------------------------------

/** Mesma ordem do enum `activity_type` no banco. */
export const ACTIVITY_TYPES = [
  'card_created',
  'card_title_changed',
  'card_moved',
  'card_assignee_added',
  'card_assignee_removed',
  'card_due_changed',
  'card_priority_changed',
  'card_completed',
  'card_reopened',
  'card_archived',
  'card_restored',
  // Fatia 11 (ADR 0015 e 0016).
  'card_visibility_changed',
  'card_viewer_added',
  'card_viewer_removed',
  'card_cover_changed',
  'card_cover_removed',
] as const;

export const activityTypeSchema = z.enum(ACTIVITY_TYPES);

const emptyDataSchema = z.object({});

/**
 * Formato de `data` por tipo. Nomes de lista/quadro são "fotografados" no momento da ação;
 * nome de usuário é resolvido na leitura (anonimização se reflete).
 */
export const activityDataSchemas = {
  card_created: z.object({
    listId: uuidSchema,
    listName: z.string(),
  }),
  card_title_changed: z.object({
    from: z.string(),
    to: z.string(),
  }),
  card_moved: z.object({
    fromListId: uuidSchema,
    fromListName: z.string(),
    toListId: uuidSchema,
    toListName: z.string(),
    fromBoardId: uuidSchema,
    fromBoardName: z.string(),
    toBoardId: uuidSchema,
    toBoardName: z.string(),
  }),
  card_assignee_added: z.object({ userId: uuidSchema }),
  card_assignee_removed: z.object({ userId: uuidSchema }),
  /** `from`/`to`: `dueAt` ISO UTC. `hasTime`: `dueHasTime` do novo prazo (`false` se `to` nulo). */
  card_due_changed: z.object({
    from: isoDateTimeSchema.nullable(),
    to: isoDateTimeSchema.nullable(),
    hasTime: z.boolean(),
  }),
  card_priority_changed: z.object({
    from: cardPrioritySchema.nullable(),
    to: cardPrioritySchema.nullable(),
  }),
  card_completed: emptyDataSchema,
  card_reopened: emptyDataSchema,
  card_archived: emptyDataSchema,
  card_restored: emptyDataSchema,
  card_visibility_changed: z.object({
    from: cardVisibilitySchema,
    to: cardVisibilitySchema,
  }),
  card_viewer_added: z.object({ userId: uuidSchema }),
  card_viewer_removed: z.object({ userId: uuidSchema }),
  card_cover_changed: emptyDataSchema,
  card_cover_removed: emptyDataSchema,
} as const satisfies Record<(typeof ACTIVITY_TYPES)[number], z.ZodType>;

type DataSchemas = typeof activityDataSchemas;

const activityBaseShape = {
  id: uuidSchema,
  cardId: uuidSchema,
  actorId: uuidSchema,
  createdAt: isoDateTimeSchema,
};

function activityVariant<T extends keyof DataSchemas>(type: T) {
  return z.object({
    ...activityBaseShape,
    type: z.literal(type),
    data: activityDataSchemas[type],
  });
}

/** Registro de atividade: união discriminada por `type`. */
export const activitySchema = z.discriminatedUnion('type', [
  activityVariant('card_created'),
  activityVariant('card_title_changed'),
  activityVariant('card_moved'),
  activityVariant('card_assignee_added'),
  activityVariant('card_assignee_removed'),
  activityVariant('card_due_changed'),
  activityVariant('card_priority_changed'),
  activityVariant('card_completed'),
  activityVariant('card_reopened'),
  activityVariant('card_archived'),
  activityVariant('card_restored'),
  activityVariant('card_visibility_changed'),
  activityVariant('card_viewer_added'),
  activityVariant('card_viewer_removed'),
  activityVariant('card_cover_changed'),
  activityVariant('card_cover_removed'),
]);

/** `GET /api/cards/:cardId/activity` → 200. Até `ACTIVITY_LIMIT`, mais recentes primeiro. */
export const activitiesResponseSchema = z.object({
  activities: z.array(activitySchema),
});

export type ActivityType = z.infer<typeof activityTypeSchema>;
export type Activity = z.infer<typeof activitySchema>;
/** `data` de cada tipo de atividade. */
export type ActivityDataMap = { [K in ActivityType]: z.infer<DataSchemas[K]> };
/**
 * Par `{ type, data }` para gravar atividade (`recordActivity(tx, { cardId, actorId, ...entry })`):
 * `data` incompatível com `type` não compila.
 */
export type ActivityEntry = {
  [K in ActivityType]: { type: K; data: ActivityDataMap[K] };
}[ActivityType];
export type ActivitiesResponse = z.infer<typeof activitiesResponseSchema>;
