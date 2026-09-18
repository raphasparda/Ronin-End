import { z } from 'zod';

import {
  NOTIFICATIONS_DEFAULT_LIMIT,
  NOTIFICATIONS_MAX_LIMIT,
} from '../../tools/kanban/domain/constants';
import { isoDateTimeSchema, uuidSchema } from './common';

// ---------------------------------------------------------------------------
// Notificações no app (api.md §15, Fatia 7)
// ---------------------------------------------------------------------------

export const NOTIFICATION_TYPES = ['card_assigned', 'card_commented'] as const;
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

export const notificationSchema = z.object({
  id: uuidSchema,
  type: notificationTypeSchema,
  actorId: uuidSchema,
  card: z.object({
    id: uuidSchema,
    title: z.string(),
    boardId: uuidSchema,
    boardName: z.string(),
  }),
  /** Preenchido em `card_commented`. */
  commentId: uuidSchema.nullable(),
  readAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});

/** Parâmetro `:notificationId`. Notificação de outro usuário → 404. */
export const notificationIdParamsSchema = z.object({
  notificationId: uuidSchema,
});

/**
 * `GET /api/notifications?limit=30&before=<IsoDateTime>` (query).
 * `limit` 1–100 (padrão 30). `before` = `createdAt` do último item da página anterior.
 */
export const notificationsQuerySchema = z.object({
  limit: z.coerce
    .number({ error: 'Limite inválido' })
    .int({ error: 'Limite inválido' })
    .min(1, { error: `O limite deve ficar entre 1 e ${NOTIFICATIONS_MAX_LIMIT}` })
    .max(NOTIFICATIONS_MAX_LIMIT, {
      error: `O limite deve ficar entre 1 e ${NOTIFICATIONS_MAX_LIMIT}`,
    })
    .default(NOTIFICATIONS_DEFAULT_LIMIT),
  before: isoDateTimeSchema.optional(),
});

/** `GET /api/notifications` → 200. `nextBefore` nulo = não há mais páginas. */
export const notificationsResponseSchema = z.object({
  notifications: z.array(notificationSchema),
  unreadCount: z.number().int().nonnegative(),
  nextBefore: isoDateTimeSchema.nullable(),
});

/** `GET /api/notifications/unread-count` → 200. */
export const unreadCountResponseSchema = z.object({
  unreadCount: z.number().int().nonnegative(),
});

// `POST /api/notifications/:notificationId/read` e `POST /api/notifications/read-all` → 204.

export type NotificationType = z.infer<typeof notificationTypeSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type NotificationIdParams = z.infer<typeof notificationIdParamsSchema>;
/** Query como o cliente envia (tudo opcional). */
export type NotificationsQueryInput = z.input<typeof notificationsQuerySchema>;
/** Query após validação (`limit` numérico preenchido). */
export type NotificationsQuery = z.output<typeof notificationsQuerySchema>;
export type NotificationsResponse = z.infer<typeof notificationsResponseSchema>;
export type UnreadCountResponse = z.infer<typeof unreadCountResponseSchema>;
