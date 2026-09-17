import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, textC, updatedAt } from '../types';

import { users } from './users';

/**
 * Chaves da paleta fixa de listas e etiquetas (RN15, ADR 0012). A ordem do enum é a ordem de
 * `PALETTE` em `@raphasparda/ronin-shared` (define o ciclo de `nextPaletteColor`). Valores visuais só em CSS.
 */
export const paletteColor = pgEnum('palette_color', [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'purple',
  'magenta',
]);

export const boards = pgTable(
  'boards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('boards_name_length_check', sql`char_length(${t.name}) BETWEEN 1 AND 100`)],
);

/**
 * Colunas do quadro. `position` é chave de `fractional-indexing` em `text COLLATE "C"` (ADR 0004).
 * No máximo uma lista de conclusão por quadro (RN06), e ela nunca está arquivada (arquivar desmarca).
 */
export const lists = pgTable(
  'lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: textC('position').notNull(),
    isDoneList: boolean('is_done_list').notNull().default(false),
    /** Sem default: a API escolhe (`nextPaletteColor` ou cores das listas padrão). */
    color: paletteColor('color').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // I5: posições únicas entre listas ativas; serve ao payload (`board_id = $1 ... ORDER BY position`).
    uniqueIndex('lists_board_position_active_unique')
      .on(t.boardId, t.position)
      .where(sql`${t.archivedAt} IS NULL`),
    // I4 / RN06: no máximo uma lista de conclusão por quadro.
    uniqueIndex('lists_board_done_list_unique')
      .on(t.boardId)
      .where(sql`${t.isDoneList}`),
    // Todas as listas do quadro (inclusive arquivadas): `GET /boards/:id/archived` e cascata da FK.
    index('lists_board_id_idx').on(t.boardId),
    // Alvo da FK composta `cards (list_id, board_id)`: garante I6 (card no mesmo quadro da lista).
    unique('lists_id_board_id_unique').on(t.id, t.boardId),
    check('lists_name_length_check', sql`char_length(${t.name}) BETWEEN 1 AND 100`),
    check('lists_position_not_empty_check', sql`${t.position} <> ''`),
    check(
      'lists_done_list_not_archived_check',
      sql`NOT (${t.isDoneList} AND ${t.archivedAt} IS NOT NULL)`,
    ),
  ],
);

export type BoardRow = typeof boards.$inferSelect;
export type NewBoardRow = typeof boards.$inferInsert;
export type ListRow = typeof lists.$inferSelect;
export type NewListRow = typeof lists.$inferInsert;
export type PaletteColorValue = (typeof paletteColor.enumValues)[number];
