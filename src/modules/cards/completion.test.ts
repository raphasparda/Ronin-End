import {
  activitiesResponseSchema,
  boardPayloadSchema,
  cardMutationResultSchema,
  cardSummaryResponseSchema,
  createBoardResponseSchema,
  type ActivityType,
  type List,
} from '@raphasparda/ronin-shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { expectError, MISSING_ID, seedTeam, type Actor } from '../../../test/actors';
import { csrfHeaders } from '../../../test/app';
import { createDbTestApp, createTestClock } from '../../../test/auth';
import { describeDb, useTestDatabase } from '../../../test/db';
import type { App } from '../../app';
import { boards, cardActivities, cards, lists } from '../../db/schema';

describeDb('concluir e reabrir card (kanban_test)', () => {
  const { db } = useTestDatabase();
  const clock = createTestClock();
  let app: App;
  let admin: Actor;
  let member: Actor;

  beforeEach(async () => {
    clock.set(new Date('2026-09-16T12:00:00.000Z'));
    app = await createDbTestApp({ clock: clock.now });
    ({ admin, member } = await seedTeam(db(), clock.now()));
  });

  afterEach(async () => {
    await app.close();
  });

  async function newBoard(name = 'Quadro') {
    const res = await app.inject({
      method: 'POST',
      url: '/api/boards',
      headers: member.headers,
      payload: { name },
    });
    const body = createBoardResponseSchema.parse(res.json());
    const [todo, doing, done] = body.lists;
    if (!todo || !doing || !done) throw new Error('listas padrão ausentes');
    return { board: body.board, todo, doing, done };
  }

  async function card(list: Pick<List, 'id'>, title = 'Card') {
    const res = await app.inject({
      method: 'POST',
      url: `/api/lists/${list.id}/cards`,
      headers: member.headers,
      payload: { title },
    });
    expect(res.statusCode).toBe(201);
    return cardSummaryResponseSchema.parse(res.json()).card;
  }

  const action = (
    cardId: string,
    name: 'complete' | 'reopen',
    headers: Record<string, string> = member.headers,
  ) => app.inject({ method: 'POST', url: `/api/cards/${cardId}/${name}`, headers });

  const act = async (cardId: string, name: 'complete' | 'reopen', actor = member) => {
    const res = await action(cardId, name, actor.headers);
    expect(res.statusCode).toBe(200);
    return cardMutationResultSchema.strict().parse(res.json());
  };

  const move = (cardId: string, toListId: string) =>
    app.inject({
      method: 'POST',
      url: `/api/cards/${cardId}/move`,
      headers: member.headers,
      payload: { toListId, placement: { type: 'end' } },
    });

  const activities = async (cardId: string) => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/cards/${cardId}/activity`,
      headers: { cookie: member.cookie },
    });
    return activitiesResponseSchema.parse(res.json()).activities;
  };
  const types = async (cardId: string): Promise<ActivityType[]> =>
    (await activities(cardId)).map((a) => a.type);

  const idsInList = async (boardId: string, listId: string) => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/boards/${boardId}`,
      headers: { cookie: member.cookie },
    });
    return boardPayloadSchema
      .parse(res.json())
      .cards.filter((c) => c.listId === listId)
      .map((c) => c.id);
  };

  const row = async (cardId: string) => {
    const [found] = await db().select().from(cards).where(eq(cards.id, cardId));
    if (!found) throw new Error('card ausente');
    return found;
  };

  const unmarkDone = (listId: string) =>
    db().update(lists).set({ isDoneList: false }).where(eq(lists.id, listId));

  describe('POST /api/cards/:cardId/complete', () => {
    it('conclui e move para o FIM da lista de conclusão; card_moved antes de card_completed; no-op idempotente', async () => {
      const { board, todo, doing, done } = await newBoard();
      const already = await card(todo, 'Já feito');
      await move(already.id, done.id);
      const c = await card(doing, 'Fazer');
      clock.advance(1_000);

      const body = await act(c.id, 'complete', admin);
      expect(body).toMatchObject({
        card: {
          id: c.id,
          listId: done.id,
          status: 'completed',
          completedAt: '2026-09-16T12:00:01.000Z',
        },
        completionChange: 'completed',
        removedLabelIds: [],
      });
      expect(await row(c.id)).toMatchObject({ completedBy: admin.user.id, listId: done.id });
      expect(await idsInList(board.id, done.id)).toEqual([already.id, c.id]);
      const history = await activities(c.id);
      expect(history.map((a) => a.type)).toEqual(['card_completed', 'card_moved', 'card_created']);
      expect(history[1]).toMatchObject({
        actorId: admin.user.id,
        data: {
          fromListId: doing.id,
          fromListName: 'Fazendo',
          toListId: done.id,
          toListName: 'Concluído',
          fromBoardId: board.id,
          toBoardId: board.id,
        },
      });

      // Repetir: 200, completionChange null, nada muda.
      clock.advance(1_000);
      const again = await act(c.id, 'complete');
      expect(again.completionChange).toBeNull();
      expect(again.card).toEqual(body.card);
      expect(await types(c.id)).toHaveLength(3);
      expect((await row(c.id)).completedBy).toBe(admin.user.id);
    });

    it('quadro sem lista de conclusão: conclui sem mover; card aberto já na lista de conclusão: conclui sem mover', async () => {
      const { board, todo, done } = await newBoard();
      const first = await card(todo, 'A');
      const second = await card(todo, 'B');

      await unmarkDone(done.id);
      const body = await act(first.id, 'complete');
      expect(body.completionChange).toBe('completed');
      expect(body.card).toMatchObject({ listId: todo.id, position: first.position });
      expect(await idsInList(board.id, todo.id)).toEqual([first.id, second.id]);
      expect(await types(first.id)).toEqual(['card_completed', 'card_created']);

      // Estado legado: card aberto dentro da lista de conclusão (ex.: inserido antes da regra).
      await db().update(lists).set({ isDoneList: true }).where(eq(lists.id, done.id));
      await db().update(cards).set({ listId: done.id }).where(eq(cards.id, second.id));
      const inDone = await act(second.id, 'complete');
      expect(inDone.card).toMatchObject({ listId: done.id, status: 'completed' });
      expect(await types(second.id)).toEqual(['card_completed', 'card_created']);
    });

    it('10 complete concorrentes no mesmo card → 1 card_completed e 1 card_moved', async () => {
      const { todo, done } = await newBoard();
      const c = await card(todo);
      const results = await Promise.all(Array.from({ length: 10 }, () => action(c.id, 'complete')));
      expect(results.map((r) => r.statusCode)).toEqual(Array(10).fill(200));
      const changes = results.map((r) => cardMutationResultSchema.parse(r.json()).completionChange);
      expect(changes.filter((x) => x === 'completed')).toHaveLength(1);
      expect(changes.filter((x) => x === null)).toHaveLength(9);
      expect(await types(c.id)).toEqual(['card_completed', 'card_moved', 'card_created']);
      expect(await row(c.id)).toMatchObject({ status: 'completed', listId: done.id });
    });
  });

  describe('POST /api/cards/:cardId/reopen', () => {
    it('da lista de conclusão vai para o TOPO da primeira lista ativa não-conclusão (menor position)', async () => {
      const { board, todo, doing, done } = await newBoard();
      const top = await card(todo, 'Topo atual');
      const c = await card(todo, 'Ciclo');
      await act(c.id, 'complete');
      clock.advance(1_000);

      let body = await act(c.id, 'reopen', admin);
      expect(body.completionChange).toBe('reopened');
      expect(body.card).toMatchObject({ listId: todo.id, status: 'open', completedAt: null });
      expect(await row(c.id)).toMatchObject({ completedAt: null, completedBy: null });
      expect(await idsInList(board.id, todo.id)).toEqual([c.id, top.id]);
      expect((await activities(c.id)).slice(0, 2)).toMatchObject([
        { type: 'card_reopened', actorId: admin.user.id },
        { type: 'card_moved', data: { fromListId: done.id, toListId: todo.id } },
      ]);

      // Idempotente.
      body = await act(c.id, 'reopen');
      expect(body.completionChange).toBeNull();
      expect(await types(c.id)).toHaveLength(5);

      // "A fazer" arquivada: a primeira ativa passa a ser "Fazendo".
      await act(c.id, 'complete');
      const archived = await app.inject({
        method: 'POST',
        url: `/api/lists/${todo.id}/archive`,
        headers: member.headers,
      });
      expect(archived.statusCode).toBe(200);
      const moved = await card(doing, 'Em andamento');
      body = await act(c.id, 'reopen');
      expect(body.card.listId).toBe(doing.id);
      expect(await idsInList(board.id, doing.id)).toEqual([c.id, moved.id]);

      // Primeira lista por position, não por criação: mover "Concluído" para o início não importa.
      await act(c.id, 'complete');
      const moveList = await app.inject({
        method: 'POST',
        url: `/api/lists/${done.id}/move`,
        headers: member.headers,
        payload: { placement: { type: 'start' } },
      });
      expect(moveList.statusCode).toBe(200);
      body = await act(c.id, 'reopen');
      expect(body.card.listId).toBe(doing.id);
    });

    it('sem outra lista ativa, fora da lista de conclusão ou quadro sem ela: reabre sem mover', async () => {
      const { board, todo, doing, done } = await newBoard();
      const a = await card(todo, 'A');
      const b = await card(todo, 'B');
      const c = await card(todo, 'C');

      // Só a lista de conclusão ativa.
      await act(a.id, 'complete');
      await db().update(lists).set({ archivedAt: clock.now() }).where(eq(lists.id, todo.id));
      await db().update(lists).set({ archivedAt: clock.now() }).where(eq(lists.id, doing.id));
      let body = await act(a.id, 'reopen');
      expect(body).toMatchObject({ completionChange: 'reopened', card: { listId: done.id } });
      expect(await types(a.id)).toEqual([
        'card_reopened',
        'card_completed',
        'card_moved',
        'card_created',
      ]);
      await db().update(lists).set({ archivedAt: null }).where(eq(lists.id, todo.id));
      await db().update(lists).set({ archivedAt: null }).where(eq(lists.id, doing.id));

      // Concluído fora da lista de conclusão (quadro sem ela na hora de concluir).
      await unmarkDone(done.id);
      await act(b.id, 'complete');
      await db().update(lists).set({ isDoneList: true }).where(eq(lists.id, done.id));
      body = await act(b.id, 'reopen');
      expect(body.card).toMatchObject({ listId: todo.id, position: b.position, status: 'open' });

      // Quadro sem lista de conclusão.
      await unmarkDone(done.id);
      await act(c.id, 'complete');
      body = await act(c.id, 'reopen');
      expect(body.card).toMatchObject({ listId: todo.id, position: c.position });
      expect(await idsInList(board.id, todo.id)).toEqual([b.id, c.id]);
    });

    it('concluir → reabrir → concluir gera 3 registros (RN13)', async () => {
      const { todo } = await newBoard();
      const c = await card(todo);
      await act(c.id, 'complete');
      await act(c.id, 'reopen');
      await act(c.id, 'complete');
      expect((await types(c.id)).filter((t) => t !== 'card_moved')).toEqual([
        'card_completed',
        'card_reopened',
        'card_completed',
        'card_created',
      ]);
    });
  });

  describe('erros de complete e reopen', () => {
    it('409 CONFLICT (card arquivado, mesmo se já no estado), 409 BOARD_ARCHIVED, 404, 400, 403 CSRF, 401', async () => {
      const { board, todo } = await newBoard();
      const c = await card(todo);
      const archivedCard = await card(todo, 'Arquivado');
      const archive = await app.inject({
        method: 'POST',
        url: `/api/cards/${archivedCard.id}/archive`,
        headers: member.headers,
      });
      expect(archive.statusCode).toBe(200);

      for (const name of ['complete', 'reopen'] as const) {
        expectError(await action(archivedCard.id, name), 409, 'CONFLICT');
        expectError(await action(MISSING_ID, name), 404, 'NOT_FOUND');
        expectError(await action('abc', name), 400, 'VALIDATION_ERROR');
        expectError(await action(c.id, name, { cookie: member.cookie }), 403, 'CSRF_REJECTED');
        expectError(
          await action(c.id, name, { ...member.headers, origin: 'https://malicioso.example' }),
          403,
          'CSRF_REJECTED',
        );
        expectError(await action(c.id, name, csrfHeaders()), 401, 'UNAUTHENTICATED');
      }

      await db().update(boards).set({ archivedAt: clock.now() }).where(eq(boards.id, board.id));
      expectError(await action(c.id, 'complete'), 409, 'BOARD_ARCHIVED');
      expectError(await action(c.id, 'reopen'), 409, 'BOARD_ARCHIVED');
      // Quadro arquivado vem antes de card arquivado.
      expectError(await action(archivedCard.id, 'complete'), 409, 'BOARD_ARCHIVED');
      expect(await db().$count(cardActivities, eq(cardActivities.cardId, c.id))).toBe(1);
    });
  });
});
