import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { createdAt } from '../types';

import { cards } from './cards';
import { comments } from './comments';
import { users } from './users';

export const notificationType = pgEnum('notification_type', ['card_assigned', 'card_commented']);

/**
 * Notificações no app (D2). Sempre filtradas por `user_id` do destinatário (notificação de outro
 * → 404). Lidas há > 90 dias são apagadas pela manutenção (RN19); a anonimização apaga as recebidas.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Destinatário. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    type: notificationType('type').notNull(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Só em `card_commented`; vira null se o comentário for excluído. */
    commentId: uuid('comment_id').references(() => comments.id, { onDelete: 'set null' }),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (t) => [
    // Listagem paginada por cursor (`user_id = $me AND created_at < $before ORDER BY created_at DESC`).
    index('notifications_user_id_created_at_idx').on(t.userId, t.createdAt.desc()),
    // Contador de não lidas e "ler todas".
    index('notifications_user_id_unread_idx')
      .on(t.userId)
      .where(sql`${t.readAt} IS NULL`),
    // Cascata ao excluir card (ou quadro).
    index('notifications_card_id_idx').on(t.cardId),
    // `ON DELETE SET NULL` ao excluir comentário.
    index('notifications_comment_id_idx')
      .on(t.commentId)
      .where(sql`${t.commentId} IS NOT NULL`),
    // RN18: ninguém é notificado da própria ação.
    check('notifications_not_self_check', sql`${t.userId} <> ${t.actorId}`),
    // Atribuição não referencia comentário.
    check(
      'notifications_comment_type_check',
      sql`${t.type} = 'card_commented' OR ${t.commentId} IS NULL`,
    ),
  ],
);

export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;
export type NotificationTypeValue = (typeof notificationType.enumValues)[number];
