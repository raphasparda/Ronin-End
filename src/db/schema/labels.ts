import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';

import { createdAt, updatedAt } from '../types';

import { boards, paletteColor } from './boards';
import { cards } from './cards';

/** Etiquetas por quadro (C6), cor da paleta fixa (RN15). */
export const labels = pgTable(
  'labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: paletteColor('color').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Payload do quadro (`labels WHERE board_id = $1`) e cascata ao excluir quadro.
    index('labels_board_id_idx').on(t.boardId),
    check('labels_name_length_check', sql`char_length(${t.name}) BETWEEN 1 AND 50`),
  ],
);

/**
 * Etiquetas aplicadas. A regra "etiqueta do mesmo quadro do card" fica no service (5.3): mover o
 * card entre quadros remove as etiquetas estranhas na mesma transação.
 */
export const cardLabels = pgTable(
  'card_labels',
  {
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => [
    // PK atende o payload (`card_id = ANY(...)`) e a idempotência de PUT/DELETE.
    primaryKey({ name: 'card_labels_pkey', columns: [t.cardId, t.labelId] }),
    // Excluir etiqueta remove de todos os cards (cascata).
    index('card_labels_label_id_idx').on(t.labelId),
  ],
);

export type LabelRow = typeof labels.$inferSelect;
export type NewLabelRow = typeof labels.$inferInsert;
export type CardLabelRow = typeof cardLabels.$inferSelect;
