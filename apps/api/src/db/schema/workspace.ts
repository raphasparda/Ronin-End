import { sql } from 'drizzle-orm';
import { check, pgTable, smallint, text } from 'drizzle-orm/pg-core';

import { createdAt, updatedAt } from '../types';

/** Instância única (overview.md §5.1): uma linha, `id = 1`, criada pelo setup inicial. */
export const workspace = pgTable(
  'workspace',
  {
    id: smallint('id').primaryKey().default(1),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('America/Sao_Paulo'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('workspace_singleton_check', sql`${t.id} = 1`),
    check('workspace_name_length_check', sql`char_length(${t.name}) BETWEEN 1 AND 100`),
    check('workspace_timezone_not_empty_check', sql`${t.timezone} <> ''`),
  ],
);

export type WorkspaceRow = typeof workspace.$inferSelect;
