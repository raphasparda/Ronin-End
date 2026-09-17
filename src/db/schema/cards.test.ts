import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { describeDb, pgError, useTestDatabase } from '../../../test/db';
import { insertBoard, insertCard, insertCardGraph, insertList, insertUser } from '../test-fixtures';

import { activityType, boards, cardActivities, cards, lists, users } from './index';

describeDb('schema: cards e card_activities (tarefas 4.2 e 5.2)', () => {
  const { db } = useTestDatabase();

  it('aplica defaults (aberto, descrição vazia, sem prazo, sem prioridade)', async () => {
    const { card } = await insertCardGraph(db());
    expect(card).toMatchObject({
      status: 'open',
      description: '',
      dueAt: null,
      dueHasTime: false,
      priority: null,
      completedAt: null,
      completedBy: null,
      archivedAt: null,
    });
  });

  it('CHECK de conclusão: completed ⇔ completed_at e completed_by', async () => {
    const { user, list, card } = await insertCardGraph(db());
    const byId = eq(cards.id, card.id);
    expect(await pgError(db().update(cards).set({ status: 'completed' }).where(byId))).toEqual({
      code: '23514',
      constraint: 'cards_completion_check',
    });
    expect(
      await pgError(
        db().update(cards).set({ status: 'completed', completedAt: new Date() }).where(byId),
      ),
    ).toMatchObject({ constraint: 'cards_completion_check' });
    expect(
      await pgError(
        db().update(cards).set({ completedAt: new Date(), completedBy: user.id }).where(byId),
      ),
    ).toMatchObject({ constraint: 'cards_completion_check' });

    await db()
      .update(cards)
      .set({ status: 'completed', completedAt: new Date(), completedBy: user.id })
      .where(byId);
    // Reabrir exige limpar os dois campos.
    expect(await pgError(db().update(cards).set({ status: 'open' }).where(byId))).toMatchObject({
      constraint: 'cards_completion_check',
    });
    await db()
      .update(cards)
      .set({ status: 'open', completedAt: null, completedBy: null })
      .where(byId);
    expect(
      await pgError(insertCard(db(), list, user.id, { position: 'a1', status: 'completed' })),
    ).toMatchObject({ constraint: 'cards_completion_check' });
  });

  it('título 1–500 sem quebra de linha; descrição até 20.000; prazo com hora exige prazo', async () => {
    const { user, list } = await insertCardGraph(db());
    const card = (title: string, position: string) =>
      insertCard(db(), list, user.id, { title, position });
    expect(await pgError(card('', 'b0'))).toEqual({
      code: '23514',
      constraint: 'cards_title_check',
    });
    expect(await pgError(card('x'.repeat(501), 'b1'))).toMatchObject({
      constraint: 'cards_title_check',
    });
    expect(await pgError(card('linha 1\nlinha 2', 'b2'))).toMatchObject({
      constraint: 'cards_title_check',
    });
    expect(await pgError(card('linha 1\rlinha 2', 'b3'))).toMatchObject({
      constraint: 'cards_title_check',
    });
    await card('x'.repeat(500), 'b4');
    await card('com \\r\\n escritos e barra \\ literal', 'b5');

    expect(
      await pgError(
        insertCard(db(), list, user.id, { position: 'c0', description: 'x'.repeat(20_001) }),
      ),
    ).toEqual({ code: '23514', constraint: 'cards_description_length_check' });
    expect(
      await pgError(insertCard(db(), list, user.id, { position: 'c1', dueHasTime: true })),
    ).toEqual({ code: '23514', constraint: 'cards_due_has_time_check' });
    await insertCard(db(), list, user.id, { position: 'c2', dueAt: new Date(), dueHasTime: true });
  });

  it('prioridade: nula, os 4 níveis, e fora do enum rejeitada', async () => {
    const { card } = await insertCardGraph(db());
    for (const priority of ['low', 'medium', 'high', 'urgent', null] as const) {
      await db().update(cards).set({ priority }).where(eq(cards.id, card.id));
    }
    const err = await pgError(
      db().execute(sql`UPDATE cards SET priority = 'critical' WHERE id = ${card.id}`),
    );
    expect(err.code).toBe('22P02');
  });

  it('I6: card só referencia lista do mesmo quadro (FK composta)', async () => {
    const { user, board, list, card } = await insertCardGraph(db());
    const board2 = await insertBoard(db(), user.id);
    const list2 = await insertList(db(), board2.id);

    expect(
      await pgError(
        insertCard(db(), { id: list2.id, boardId: board.id }, user.id, { position: 'z' }),
      ),
    ).toEqual({ code: '23503', constraint: 'cards_list_board_fk' });
    expect(
      await pgError(db().update(cards).set({ listId: list2.id }).where(eq(cards.id, card.id))),
    ).toEqual({ code: '23503', constraint: 'cards_list_board_fk' });

    // Mover entre quadros atualiza as duas colunas juntas.
    await db()
      .update(cards)
      .set({ listId: list2.id, boardId: board2.id })
      .where(eq(cards.id, card.id));
    expect(list.boardId).toBe(board.id);
  });

  it('posição única entre cards ativos da lista; arquivado libera a posição', async () => {
    const { user, list, card } = await insertCardGraph(db());
    expect(await pgError(insertCard(db(), list, user.id, { position: card.position }))).toEqual({
      code: '23505',
      constraint: 'cards_list_position_active_unique',
    });
    await db().update(cards).set({ archivedAt: new Date() }).where(eq(cards.id, card.id));
    await insertCard(db(), list, user.id, { position: card.position });
    // Restaurar sem nova posição colide com o ativo.
    expect(
      await pgError(db().update(cards).set({ archivedAt: null }).where(eq(cards.id, card.id))),
    ).toMatchObject({ code: '23505', constraint: 'cards_list_position_active_unique' });
  });

  it('ordena position byte a byte ("Zz" < "a")', async () => {
    const { user, list } = await insertCardGraph(db());
    await db().delete(cards);
    for (const position of ['a', 'Zz', 'a0', 'B']) {
      await insertCard(db(), list, user.id, { position });
    }
    const rows = await db()
      .select({ position: cards.position })
      .from(cards)
      .where(eq(cards.listId, list.id))
      .orderBy(cards.position);
    expect(rows.map((r) => r.position)).toEqual(['B', 'Zz', 'a', 'a0']);
  });

  it('cascatas: excluir lista remove cards; excluir quadro remove cards e atividades', async () => {
    const { user, board, list, card } = await insertCardGraph(db());
    await db()
      .insert(cardActivities)
      .values({ cardId: card.id, boardId: board.id, actorId: user.id, type: 'card_created' });
    await db().delete(lists).where(eq(lists.id, list.id));
    expect(await db().$count(cards)).toBe(0);
    expect(await db().$count(cardActivities)).toBe(0);

    const list2 = await insertList(db(), board.id);
    const card2 = await insertCard(db(), list2, user.id);
    await db()
      .insert(cardActivities)
      .values({ cardId: card2.id, boardId: board.id, actorId: user.id, type: 'card_created' });
    await db().delete(boards).where(eq(boards.id, board.id));
    expect(await db().$count(cards)).toBe(0);
    expect(await db().$count(cardActivities)).toBe(0);
  });

  it('autor de card e de conclusão não pode ser excluído (FK restrita)', async () => {
    const { user, card } = await insertCardGraph(db());
    const closer = await insertUser(db());
    await db()
      .update(cards)
      .set({ status: 'completed', completedAt: new Date(), completedBy: closer.id })
      .where(eq(cards.id, card.id));
    expect(await pgError(db().delete(users).where(eq(users.id, closer.id)))).toEqual({
      code: '23001',
      constraint: 'cards_completed_by_users_id_fk',
    });
    expect((await pgError(db().delete(users).where(eq(users.id, user.id)))).code).toBe('23001');
  });

  describe('card_activities', () => {
    it('grava todos os tipos (inclusive card_priority_changed) com data padrão {}', async () => {
      const { user, board, card } = await insertCardGraph(db());
      const [row] = await db()
        .insert(cardActivities)
        .values({ cardId: card.id, boardId: board.id, actorId: user.id, type: 'card_completed' })
        .returning();
      expect(row?.data).toEqual({});
      for (const type of activityType.enumValues) {
        await db()
          .insert(cardActivities)
          .values({
            cardId: card.id,
            boardId: board.id,
            actorId: user.id,
            type,
            data: type === 'card_priority_changed' ? { from: null, to: 'urgent' } : {},
          });
      }
      expect(await db().$count(cardActivities)).toBe(activityType.enumValues.length + 1);
      const err = await pgError(
        db().execute(
          sql`INSERT INTO card_activities (card_id, board_id, actor_id, type)
              VALUES (${card.id}, ${board.id}, ${user.id}, 'xp_gained')`,
        ),
      );
      expect(err.code).toBe('22P02');
    });

    it('data precisa ser objeto JSON', async () => {
      const { user, board, card } = await insertCardGraph(db());
      expect(
        await pgError(
          db().execute(
            sql`INSERT INTO card_activities (card_id, board_id, actor_id, type, data)
                VALUES (${card.id}, ${board.id}, ${user.id}, 'card_created', '[1]'::jsonb)`,
          ),
        ),
      ).toEqual({ code: '23514', constraint: 'card_activities_data_object_check' });
    });

    it('append-only: UPDATE recusado pelo trigger; exclusão só em cascata', async () => {
      const { user, board, card } = await insertCardGraph(db());
      const [row] = await db()
        .insert(cardActivities)
        .values({ cardId: card.id, boardId: board.id, actorId: user.id, type: 'card_created' })
        .returning();
      expect(
        await pgError(
          db()
            .update(cardActivities)
            .set({ data: { hacked: true } })
            .where(eq(cardActivities.id, row?.id ?? '')),
        ),
      ).toEqual({ code: '23001', constraint: 'card_activities_append_only' });
      await db().delete(cards).where(eq(cards.id, card.id));
      expect(await db().$count(cardActivities)).toBe(0);
    });
  });
});
