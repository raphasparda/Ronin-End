import { ACTIVITY_TYPES, activitySchema } from '@raphasparda/ronin-shared';
import { eq, sql } from 'drizzle-orm';
import { expect, expectTypeOf, it } from 'vitest';

import { describeDb, pgError, useTestDatabase } from '../../../test/db';
import { cardActivities } from '../../db/schema';
import { insertCardGraph } from '../../db/test-fixtures';

import { listCardActivities, recordActivity, type RecordActivityInput } from './service';

it('recordActivity: `data` precisa casar com `type` (checado pelo tsc)', () => {
  const base = { cardId: 'c', boardId: 'b', actorId: 'a', now: new Date() };
  const ok: RecordActivityInput = {
    ...base,
    type: 'card_title_changed',
    data: { from: 'a', to: 'b' },
  };
  expectTypeOf(ok).toExtend<RecordActivityInput>();

  // @ts-expect-error: `card_moved` exige os ids e nomes de origem e destino.
  const missing: RecordActivityInput = { ...base, type: 'card_moved', data: { toListId: 'x' } };
  const badPriority: RecordActivityInput = {
    ...base,
    type: 'card_priority_changed',
    // @ts-expect-error: prioridade fora do enum.
    data: { from: null, to: 'max' },
  };
  // @ts-expect-error: tipo inexistente.
  const badType: RecordActivityInput = { ...base, type: 'card_deleted', data: {} };
  expect([missing, badPriority, badType]).toHaveLength(3);
});

describeDb('recordActivity (kanban_test)', () => {
  const { db } = useTestDatabase();

  it('grava os 11 tipos; leitura do mais recente ao mais antigo, mesmo no mesmo instante; append-only', async () => {
    const { user, board, list, card } = await insertCardGraph(db());
    const now = new Date('2026-09-16T12:00:00.000Z');
    const base = { cardId: card.id, boardId: board.id, actorId: user.id, now };
    const moved = {
      fromListId: list.id,
      fromListName: 'A',
      toListId: list.id,
      toListName: 'B',
      fromBoardId: board.id,
      fromBoardName: 'Q1',
      toBoardId: board.id,
      toBoardName: 'Q2',
    };
    const entries: RecordActivityInput[] = [
      { ...base, type: 'card_created', data: { listId: list.id, listName: 'A' } },
      { ...base, type: 'card_title_changed', data: { from: 'a', to: 'b' } },
      { ...base, type: 'card_moved', data: moved },
      { ...base, type: 'card_assignee_added', data: { userId: user.id } },
      { ...base, type: 'card_assignee_removed', data: { userId: user.id } },
      {
        ...base,
        type: 'card_due_changed',
        data: { from: null, to: now.toISOString(), hasTime: true },
      },
      { ...base, type: 'card_priority_changed', data: { from: null, to: 'urgent' } },
      { ...base, type: 'card_completed', data: {} },
      { ...base, type: 'card_reopened', data: {} },
      { ...base, type: 'card_archived', data: {} },
      { ...base, type: 'card_restored', data: {} },
    ];
    await db().transaction(async (tx) => {
      for (const entry of entries) await recordActivity(tx, entry);
    });

    const read = await listCardActivities(db(), card.id);
    expect(read.map((a) => a.type)).toEqual([...ACTIVITY_TYPES].reverse());
    for (const activity of read) {
      expect(activitySchema.safeParse(activity).success).toBe(true);
      expect(activity.createdAt).toBe('2026-09-16T12:00:00.000Z');
    }

    // Relógio atrasado não inverte a ordem.
    await recordActivity(db(), {
      ...base,
      now: new Date('2020-01-01T00:00:00Z'),
      type: 'card_archived',
      data: {},
    });
    expect((await listCardActivities(db(), card.id))[0]?.createdAt).toBe(
      '2026-09-16T12:00:00.000Z',
    );

    const { code } = await pgError(
      db()
        .update(cardActivities)
        .set({ data: sql`'{}'::jsonb` })
        .where(eq(cardActivities.cardId, card.id)),
    );
    expect(code).toBe('23001');
  });
});
