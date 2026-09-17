import { BOARD_VISIBILITIES, CARD_PRIORITIES, PALETTE } from '@raphasparda/ronin-shared';
import { expect, it } from 'vitest';

import { describeDb, useTestDatabase } from '../../../test/db';

import {
  activityType,
  boardVisibility,
  cardPriority,
  notificationType,
  paletteColor,
} from './index';

/** Estrutura aplicada pelas migrations (catálogo do PostgreSQL), não só o que o Drizzle declara. */
describeDb('schema: catálogo do MVP (fatias 2–9) e da fatia 11', () => {
  const { pool } = useTestDatabase();

  async function enumValues(name: string): Promise<string[]> {
    const { rows } = await pool().query<{ values: string[] }>(
      `SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS values
         FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = $1`,
      [name],
    );
    return rows[0]?.values ?? [];
  }

  it('todas as tabelas do MVP existem e não há tabelas de gamificação', async () => {
    const { rows } = await pool().query<{ name: string }>(
      `SELECT tablename::text AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`,
    );
    expect(rows.map((r) => r.name)).toEqual([
      'auth_throttle',
      'auth_tokens',
      'board_covers',
      'board_viewers',
      'boards',
      'card_activities',
      'card_assignees',
      'card_labels',
      'cards',
      'checklist_items',
      'checklists',
      'comments',
      'labels',
      'lists',
      'notifications',
      'sessions',
      'users',
      'workspace',
    ]);
  });

  it('enums com a mesma ordem de @raphasparda/ronin-shared e do Drizzle', async () => {
    expect(await enumValues('palette_color')).toEqual([...PALETTE]);
    expect(paletteColor.enumValues).toEqual([...PALETTE]);
    expect(await enumValues('card_priority')).toEqual([...CARD_PRIORITIES]);
    expect(cardPriority.enumValues).toEqual([...CARD_PRIORITIES]);
    expect(await enumValues('activity_type')).toEqual(activityType.enumValues);
    expect(await enumValues('activity_type')).toContain('card_priority_changed');
    // Fatia 11 (migration 0009): visibilidade e capa saíram do card e os tipos correspondentes
    // saíram do enum; o quadro não tem histórico próprio (api.md §18.9).
    expect(await enumValues('activity_type')).not.toContain('card_visibility_changed');
    expect(await enumValues('activity_type')).not.toContain('card_cover_changed');
    expect(await enumValues('board_visibility')).toEqual([...BOARD_VISIBILITIES]);
    expect(boardVisibility.enumValues).toEqual([...BOARD_VISIBILITIES]);
    expect(await enumValues('notification_type')).toEqual(notificationType.enumValues);
    expect(await enumValues('auth_token_kind')).toEqual(['invite', 'password_reset']);
    expect(await enumValues('card_status')).toEqual(['open', 'completed']);
  });

  it('toda coluna position usa COLLATE "C"', async () => {
    const { rows } = await pool().query<{ tbl: string; collation: string | null }>(
      `SELECT table_name::text AS tbl, collation_name::text AS collation
         FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'position'
        ORDER BY table_name`,
    );
    expect(rows).toEqual([
      { tbl: 'cards', collation: 'C' },
      { tbl: 'checklist_items', collation: 'C' },
      { tbl: 'lists', collation: 'C' },
    ]);
  });

  it('índices parciais com os predicados esperados', async () => {
    const { rows } = await pool().query<{ name: string; def: string }>(
      `SELECT indexname::text AS name, indexdef AS def FROM pg_indexes
        WHERE schemaname = 'public' AND indexdef LIKE '% WHERE %' ORDER BY indexname`,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.def]));
    expect(Object.keys(byName)).toEqual([
      'auth_tokens_target_user_id_idx',
      'cards_due_at_open_idx',
      'cards_list_position_active_unique',
      'lists_board_done_list_unique',
      'lists_board_position_active_unique',
      'notifications_comment_id_idx',
      'notifications_user_id_unread_idx',
    ]);
    expect(byName.lists_board_done_list_unique).toMatch(
      /UNIQUE INDEX .*\(board_id\) WHERE is_done_list/,
    );
    expect(byName.lists_board_position_active_unique).toMatch(
      /UNIQUE INDEX .*\(board_id, "position"\) WHERE \(archived_at IS NULL\)/,
    );
    expect(byName.cards_list_position_active_unique).toMatch(
      /UNIQUE INDEX .*\(list_id, "position"\) WHERE \(archived_at IS NULL\)/,
    );
    expect(byName.cards_due_at_open_idx).toMatch(
      /\(due_at\) WHERE \(\(status = 'open'::card_status\) AND \(archived_at IS NULL\)\)/,
    );
    expect(byName.notifications_user_id_unread_idx).toMatch(
      /\(user_id\) WHERE \(read_at IS NULL\)/,
    );
  });

  it('toda FK (exceto para users, que nunca são excluídos) tem índice liderado pela 1ª coluna', async () => {
    const { rows } = await pool().query<{ fk: string }>(
      `SELECT c.conname::text AS fk
         FROM pg_constraint c
        WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
          AND c.confrelid <> 'public.users'::regclass
          AND NOT EXISTS (
            SELECT 1 FROM pg_index i
             WHERE i.indrelid = c.conrelid
               AND (i.indpred IS NULL OR pg_get_expr(i.indpred, i.indrelid) LIKE '%IS NOT NULL%')
               AND i.indkey[0] = c.conkey[1]
          )
        ORDER BY 1`,
    );
    expect(rows.map((r) => r.fk)).toEqual([]);
  });
});
