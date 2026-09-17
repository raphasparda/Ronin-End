import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, textC, updatedAt } from '../types';

import { cards } from './cards';
import { users } from './users';

/** Checklists do card (C7). Ordem: `created_at, id`. */
export const checklists = pgTable(
  'checklists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Detalhe do card (`card_id = $1 ORDER BY created_at, id`), contagem do payload e cascata.
    index('checklists_card_id_created_at_idx').on(t.cardId, t.createdAt, t.id),
    check('checklists_title_length_check', sql`char_length(${t.title}) BETWEEN 1 AND 200`),
  ],
);

/**
 * Itens de checklist. `position` em `text COLLATE "C"` (ADR 0004); itens não são arquivados, então
 * a unicidade de posição vale para todos. Marcar item nunca conclui o card.
 */
export const checklistItems = pgTable(
  'checklist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    checklistId: uuid('checklist_id')
      .notNull()
      .references(() => checklists.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    position: textC('position').notNull(),
    isChecked: boolean('is_checked').notNull().default(false),
    checkedBy: uuid('checked_by').references(() => users.id, { onDelete: 'restrict' }),
    checkedAt: timestamp('checked_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // I5 e ordenação dos itens do checklist; também atende a cascata por `checklist_id`.
    uniqueIndex('checklist_items_checklist_position_unique').on(t.checklistId, t.position),
    check('checklist_items_text_length_check', sql`char_length(${t.text}) BETWEEN 1 AND 500`),
    check('checklist_items_position_not_empty_check', sql`${t.position} <> ''`),
    // Marcado <=> quem e quando marcou.
    check(
      'checklist_items_checked_check',
      sql`(${t.isChecked} AND ${t.checkedBy} IS NOT NULL AND ${t.checkedAt} IS NOT NULL) OR (NOT ${t.isChecked} AND ${t.checkedBy} IS NULL AND ${t.checkedAt} IS NULL)`,
    ),
  ],
);

export type ChecklistRow = typeof checklists.$inferSelect;
export type NewChecklistRow = typeof checklists.$inferInsert;
export type ChecklistItemRow = typeof checklistItems.$inferSelect;
export type NewChecklistItemRow = typeof checklistItems.$inferInsert;
