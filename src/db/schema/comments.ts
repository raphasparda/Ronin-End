import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { createdAt } from '../types';

import { cards } from './cards';
import { users } from './users';

/** Comentários do card (C8). Markdown; só o autor edita (`edited_at`). Dado pessoal: `body`. */
export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (t) => [
    // Detalhe do card (ordem cronológica), `commentCount` do payload e cascata.
    index('comments_card_id_created_at_idx').on(t.cardId, t.createdAt),
    check('comments_body_length_check', sql`char_length(${t.body}) BETWEEN 1 AND 10000`),
  ],
);

export type CommentRow = typeof comments.$inferSelect;
export type NewCommentRow = typeof comments.$inferInsert;
