import {
  activitiesResponseSchema,
  boardArchivedResponseSchema,
  boardPayloadSchema,
  cardDetailResponseSchema,
  cardMutationResultSchema,
  cardSummaryResponseSchema,
  createBoardResponseSchema,
  type ActivityType,
  type List,
} from '@raphasparda/ronin-shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { expectError, MISSING_ID, seedTeam, type Actor } from '../../../../../test/actors';
import { boardActor } from '../../../../../test/actor-context';
import { csrfHeaders } from '../../../../../test/app';
import { createDbTestApp, createTestClock } from '../../../../../test/auth';
import { describeDb, useTestDatabase } from '../../../../../test/db';
import type { App } from '../../../../app';
import {
  boards,
  cardActivities,
  cardAssignees,
  cardLabels,
  cards,
  checklistItems,
  checklists,
  lists,
} from '../../../../db/schema';
import {
  insertCard,
  insertChecklist,
  insertComment,
  insertLabel,
  insertList,
} from '../../../../db/test-fixtures';

import { findCardAssigneePairs, findCardLabelPairs } from './repository';

describeDb('rotas de cards (ronin_test)', () => {
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

  const createCard = (listId: string, body: unknown, headers = member.headers) =>
    app.inject({
      method: 'POST',
      url: `/api/lists/${listId}/cards`,
      headers,
      payload: body as object,
    });

  async function card(list: Pick<List, 'id'>, title = 'Card') {
    const res = await createCard(list.id, { title });
    expect(res.statusCode).toBe(201);
    return cardSummaryResponseSchema.parse(res.json()).card;
  }

  const getCard = (cardId: string, headers: Record<string, string> = { cookie: member.cookie }) =>
    app.inject({ method: 'GET', url: `/api/cards/${cardId}`, headers });

  const detail = async (cardId: string) =>
    cardDetailResponseSchema.parse((await getCard(cardId)).json()).card;

  const patchCard = (cardId: string, body: unknown, headers = member.headers) =>
    app.inject({ method: 'PATCH', url: `/api/cards/${cardId}`, headers, payload: body as object });

  const moveCard = (cardId: string, body: unknown, headers = member.headers) =>
    app.inject({
      method: 'POST',
      url: `/api/cards/${cardId}/move`,
      headers,
      payload: body as object,
    });

  const cardAction = (cardId: string, name: 'archive' | 'restore', headers = member.headers) =>
    app.inject({ method: 'POST', url: `/api/cards/${cardId}/${name}`, headers });

  const deleteCard = (cardId: string, headers = admin.headers) =>
    app.inject({ method: 'DELETE', url: `/api/cards/${cardId}`, headers });

  const activityRes = (
    cardId: string,
    headers: Record<string, string> = { cookie: member.cookie },
  ) => app.inject({ method: 'GET', url: `/api/cards/${cardId}/activity`, headers });

  const activities = async (cardId: string) => {
    const res = await activityRes(cardId);
    expect(res.statusCode).toBe(200);
    return activitiesResponseSchema.strict().parse(res.json()).activities;
  };

  const types = async (cardId: string): Promise<ActivityType[]> =>
    (await activities(cardId)).map((a) => a.type);

  const payload = async (boardId: string) =>
    boardPayloadSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/boards/${boardId}`,
          headers: { cookie: member.cookie },
        })
      ).json(),
    );

  const idsInList = async (boardId: string, listId: string) =>
    (await payload(boardId)).cards.filter((c) => c.listId === listId).map((c) => c.id);

  const archiveBoard = (boardId: string) =>
    db().update(boards).set({ archivedAt: clock.now() }).where(eq(boards.id, boardId));

  const row = async (cardId: string) => {
    const [found] = await db().select().from(cards).where(eq(cards.id, cardId));
    if (!found) throw new Error('card ausente');
    return found;
  };

  describe('POST /api/lists/:listId/cards', () => {
    it('cria no fim da lista, troca quebras de linha por espaço e registra card_created', async () => {
      const { board, todo } = await newBoard();
      const first = await card(todo, 'Primeiro');
      const res = await createCard(todo.id, { title: '  Segundo\r\ncard\n ' });
      expect(res.statusCode).toBe(201);
      const second = cardSummaryResponseSchema.strict().parse(res.json()).card;
      expect(second).toEqual({
        id: second.id,
        boardId: board.id,
        listId: todo.id,
        title: 'Segundo card',
        position: second.position,
        status: 'open',
        completedAt: null,
        dueAt: null,
        dueHasTime: false,
        priority: null,
        labelIds: [],
        assigneeIds: [],
        checklist: { done: 0, total: 0 },
        commentCount: 0,
        hasDescription: false,
        archivedAt: null,
      });
      expect(second.position > first.position).toBe(true);
      expect(await idsInList(board.id, todo.id)).toEqual([first.id, second.id]);

      const [created] = await activities(second.id);
      expect(created).toEqual({
        id: created?.id,
        cardId: second.id,
        actorId: member.user.id,
        type: 'card_created',
        data: { listId: todo.id, listName: 'A fazer' },
        createdAt: '2026-09-16T12:00:00.000Z',
      });
    });

    it('409 LIST_IS_DONE_LIST, LIST_ARCHIVED e BOARD_ARCHIVED', async () => {
      const { board, todo, doing, done } = await newBoard();
      expectError(await createCard(done.id, { title: 'X' }), 409, 'LIST_IS_DONE_LIST');
      await db().update(lists).set({ archivedAt: clock.now() }).where(eq(lists.id, doing.id));
      expectError(await createCard(doing.id, { title: 'X' }), 409, 'LIST_ARCHIVED');
      await archiveBoard(board.id);
      expectError(await createCard(todo.id, { title: 'X' }), 409, 'BOARD_ARCHIVED');
      expect(await db().$count(cards)).toBe(0);
      expect(await db().$count(cardActivities)).toBe(0);
    });

    it('400 (título vazio, só quebras de linha, > 500, id inválido), 404, 403 CSRF, 401', async () => {
      const { todo } = await newBoard();
      for (const body of [{}, { title: '' }, { title: '\r\n\n' }, { title: 'x'.repeat(501) }]) {
        expectError(await createCard(todo.id, body), 400, 'VALIDATION_ERROR');
      }
      expect((await createCard(todo.id, { title: 'x'.repeat(500) })).statusCode).toBe(201);
      expectError(await createCard('abc', { title: 'X' }), 400, 'VALIDATION_ERROR');
      expectError(await createCard(MISSING_ID, { title: 'X' }), 404, 'NOT_FOUND');
      expectError(
        await createCard(todo.id, { title: 'X' }, { cookie: member.cookie }),
        403,
        'CSRF_REJECTED',
      );
      expectError(await createCard(todo.id, { title: 'X' }, csrfHeaders()), 401, 'UNAUTHENTICATED');
    });
  });

  describe('GET /api/cards/:cardId', () => {
    it('detalhe com quadro, lista (cor), checklists por criação com itens por posição e comentários crescentes', async () => {
      const { board, doing } = await newBoard();
      const created = await card(doing, 'Detalhe');
      const later = await insertChecklist(db(), created.id);
      await db()
        .update(checklists)
        .set({ createdAt: new Date('2026-09-16T13:00:00Z') })
        .where(eq(checklists.id, later.id));
      const earlier = await insertChecklist(db(), created.id);
      await db()
        .update(checklists)
        .set({ createdAt: new Date('2026-09-16T11:00:00Z') })
        .where(eq(checklists.id, earlier.id));
      await db()
        .insert(checklistItems)
        .values([
          { checklistId: earlier.id, text: 'B', position: 'a1' },
          {
            checklistId: earlier.id,
            text: 'A',
            position: 'a0',
            isChecked: true,
            checkedBy: admin.user.id,
            checkedAt: clock.now(),
          },
        ]);
      const c1 = await insertComment(db(), created.id, member.user.id);
      const c2 = await insertComment(db(), created.id, admin.user.id);

      const res = await getCard(created.id);
      expect(res.statusCode).toBe(200);
      const body = cardDetailResponseSchema.strict().parse(res.json()).card;
      expect(body).toMatchObject({
        id: created.id,
        title: 'Detalhe',
        description: '',
        completedBy: null,
        createdBy: member.user.id,
        createdAt: '2026-09-16T12:00:00.000Z',
        updatedAt: '2026-09-16T12:00:00.000Z',
        board: { id: board.id, name: 'Quadro', archived: false },
        list: {
          id: doing.id,
          name: 'Fazendo',
          color: 'orange',
          isDoneList: false,
          archived: false,
        },
        checklist: { done: 1, total: 2 },
        commentCount: 2,
      });
      expect(body.checklists.map((c) => c.id)).toEqual([earlier.id, later.id]);
      expect(body.checklists[0]?.items.map((i) => i.text)).toEqual(['A', 'B']);
      expect(body.checklists[0]?.items[0]).toMatchObject({
        isChecked: true,
        checkedBy: admin.user.id,
        checkedAt: '2026-09-16T12:00:00.000Z',
      });
      expect(body.comments.map((c) => c.id).sort()).toEqual([c1.id, c2.id].sort());
    });

    it('card arquivado e quadro arquivado também são retornados', async () => {
      const { board, todo } = await newBoard();
      const created = await card(todo);
      await cardAction(created.id, 'archive');
      await archiveBoard(board.id);
      const body = await detail(created.id);
      expect(body.archivedAt).toBe('2026-09-16T12:00:00.000Z');
      expect(body.board.archived).toBe(true);
    });

    it('404, 400, 401', async () => {
      expectError(await getCard(MISSING_ID), 404, 'NOT_FOUND');
      expectError(await getCard('nao-e-uuid'), 400, 'VALIDATION_ERROR');
      expectError(await getCard(MISSING_ID, {}), 401, 'UNAUTHENTICATED');
    });
  });

  describe('PATCH /api/cards/:cardId', () => {
    it('título e descrição: atividade só para título alterado; descrição não gera atividade', async () => {
      const { todo } = await newBoard();
      const created = await card(todo, 'Antigo');
      clock.advance(1_000);

      const res = await patchCard(created.id, { title: 'Novo\ntítulo', description: '  **oi**  ' });
      expect(res.statusCode).toBe(200);
      const body = cardDetailResponseSchema.strict().parse(res.json()).card;
      expect(body).toMatchObject({
        title: 'Novo título',
        description: '**oi**',
        hasDescription: true,
        updatedAt: '2026-09-16T12:00:01.000Z',
      });

      // Mesmo título e descrição: sem atividade nova.
      await patchCard(created.id, { title: 'Novo título', description: 'outra' });
      const list = await activities(created.id);
      expect(list.map((a) => a.type)).toEqual(['card_title_changed', 'card_created']);
      expect(list[0]?.data).toEqual({ from: 'Antigo', to: 'Novo título' });

      const cleared = await patchCard(created.id, { description: '' });
      expect(cardDetailResponseSchema.parse(cleared.json()).card.hasDescription).toBe(false);
    });

    it('prazo só com data vira 23:59:59.999 em São Paulo; com hora; remover; atividades de prazo e prioridade', async () => {
      const { todo } = await newBoard();
      const created = await card(todo);

      const dateOnly = await patchCard(created.id, { due: { date: '2026-09-20', time: null } });
      expect(dateOnly.statusCode).toBe(200);
      expect(cardDetailResponseSchema.parse(dateOnly.json()).card).toMatchObject({
        dueAt: '2026-09-21T02:59:59.999Z',
        dueHasTime: false,
      });
      // Mesmo prazo: sem atividade.
      await patchCard(created.id, { due: { date: '2026-09-20', time: null } });

      const withTime = await patchCard(created.id, {
        due: { date: '2026-09-20', time: '14:30' },
        priority: 'high',
      });
      expect(cardDetailResponseSchema.parse(withTime.json()).card).toMatchObject({
        dueAt: '2026-09-20T17:30:00.000Z',
        dueHasTime: true,
        priority: 'high',
      });

      const removed = await patchCard(created.id, { due: null, priority: null });
      expect(cardDetailResponseSchema.parse(removed.json()).card).toMatchObject({
        dueAt: null,
        dueHasTime: false,
        priority: null,
      });

      const list = await activities(created.id);
      expect(list.map((a) => [a.type, a.data])).toEqual([
        ['card_priority_changed', { from: 'high', to: null }],
        ['card_due_changed', { from: '2026-09-20T17:30:00.000Z', to: null, hasTime: false }],
        ['card_priority_changed', { from: null, to: 'high' }],
        [
          'card_due_changed',
          { from: '2026-09-21T02:59:59.999Z', to: '2026-09-20T17:30:00.000Z', hasTime: true },
        ],
        ['card_due_changed', { from: null, to: '2026-09-21T02:59:59.999Z', hasTime: false }],
        ['card_created', { listId: todo.id, listName: 'A fazer' }],
      ]);
    });

    it('card arquivado pode ser editado; 409 BOARD_ARCHIVED', async () => {
      const { board, todo } = await newBoard();
      const created = await card(todo);
      await cardAction(created.id, 'archive');
      expect((await patchCard(created.id, { title: 'Ainda editável' })).statusCode).toBe(200);
      await archiveBoard(board.id);
      expectError(await patchCard(created.id, { title: 'X' }), 409, 'BOARD_ARCHIVED');
      expect((await row(created.id)).title).toBe('Ainda editável');
    });

    it('400 (vazio, título vazio, data inexistente, hora fora do intervalo, prioridade inválida), 404, 403 CSRF, 401', async () => {
      const { todo } = await newBoard();
      const created = await card(todo);
      for (const body of [
        {},
        { foo: 1 },
        { title: '' },
        { title: 'x'.repeat(501) },
        { description: 'x'.repeat(20_001) },
        { due: { date: '2026-02-30', time: null } },
        { due: { date: '2026-09-20', time: '24:00' } },
        { due: { date: '2026-09-20', time: '9:00' } },
        { due: { date: '2026-09-20' } },
        { priority: 'critical' },
      ]) {
        expectError(await patchCard(created.id, body), 400, 'VALIDATION_ERROR');
      }
      expectError(await patchCard(MISSING_ID, { title: 'X' }), 404, 'NOT_FOUND');
      expectError(
        await patchCard(created.id, { title: 'X' }, { cookie: member.cookie }),
        403,
        'CSRF_REJECTED',
      );
      expectError(
        await patchCard(created.id, { title: 'X' }, csrfHeaders()),
        401,
        'UNAUTHENTICATED',
      );
      expect(await types(created.id)).toEqual(['card_created']);
    });
  });

  describe('POST /api/cards/:cardId/move', () => {
    it('reordenar na mesma lista (start, after, end) não gera atividade', async () => {
      const { board, todo } = await newBoard();
      const a = await card(todo, 'A');
      const b = await card(todo, 'B');
      const c = await card(todo, 'C');

      const res = await moveCard(c.id, { toListId: todo.id, placement: { type: 'start' } });
      expect(res.statusCode).toBe(200);
      expect(cardMutationResultSchema.strict().parse(res.json())).toMatchObject({
        card: { id: c.id, listId: todo.id },
        completionChange: null,
        removedLabelIds: [],
      });
      expect(await idsInList(board.id, todo.id)).toEqual([c.id, a.id, b.id]);

      await moveCard(c.id, { toListId: todo.id, placement: { type: 'after', id: a.id } });
      expect(await idsInList(board.id, todo.id)).toEqual([a.id, c.id, b.id]);
      await moveCard(a.id, { toListId: todo.id, placement: { type: 'end' } });
      expect(await idsInList(board.id, todo.id)).toEqual([c.id, b.id, a.id]);

      expect(await types(c.id)).toEqual(['card_created']);
      expect(await types(a.id)).toEqual(['card_created']);
    });

    it('outra lista: card_moved com nomes fotografados; posição pedida', async () => {
      const { board, todo, doing } = await newBoard();
      const x = await card(doing, 'X');
      const moving = await card(todo, 'M');
      clock.advance(5_000);

      const res = await moveCard(moving.id, {
        toListId: doing.id,
        placement: { type: 'start' },
      });
      expect(res.statusCode).toBe(200);
      expect(await idsInList(board.id, doing.id)).toEqual([moving.id, x.id]);
      const [moved] = await activities(moving.id);
      expect(moved).toMatchObject({
        type: 'card_moved',
        actorId: member.user.id,
        createdAt: '2026-09-16T12:00:05.000Z',
        data: {
          fromListId: todo.id,
          fromListName: 'A fazer',
          toListId: doing.id,
          toListName: 'Fazendo',
          fromBoardId: board.id,
          fromBoardName: 'Quadro',
          toBoardId: board.id,
          toBoardName: 'Quadro',
        },
      });
      expect((await row(moving.id)).updatedAt).toEqual(new Date('2026-09-16T12:00:05.000Z'));
    });

    it('outro quadro: atualiza board_id, remove etiquetas do quadro de origem e mantém responsáveis', async () => {
      const one = await newBoard('Um');
      const two = await newBoard('Dois');
      const moving = await card(one.todo, 'Viajante');
      const labelA = await insertLabel(db(), one.board.id);
      const labelB = await insertLabel(db(), one.board.id);
      await db()
        .insert(cardLabels)
        .values([
          { cardId: moving.id, labelId: labelA.id },
          { cardId: moving.id, labelId: labelB.id },
        ]);
      await db()
        .insert(cardAssignees)
        .values({ cardId: moving.id, userId: admin.user.id, assignedBy: member.user.id });

      const res = await moveCard(moving.id, {
        toListId: two.doing.id,
        placement: { type: 'end' },
      });
      expect(res.statusCode).toBe(200);
      const body = cardMutationResultSchema.strict().parse(res.json());
      expect(body.removedLabelIds).toEqual([labelA.id, labelB.id].sort());
      expect(body.completionChange).toBeNull();
      expect(body.card).toMatchObject({
        boardId: two.board.id,
        listId: two.doing.id,
        labelIds: [],
        assigneeIds: [admin.user.id],
      });
      expect(await row(moving.id)).toMatchObject({
        boardId: two.board.id,
        listId: two.doing.id,
      });
      expect(await db().$count(cardLabels)).toBe(0);
      expect((await payload(one.board.id)).cards).toHaveLength(0);
      expect((await payload(two.board.id)).cards.map((c) => c.id)).toEqual([moving.id]);

      const [moved] = await activities(moving.id);
      expect(moved?.data).toMatchObject({
        fromBoardId: one.board.id,
        fromBoardName: 'Um',
        toBoardId: two.board.id,
        toBoardName: 'Dois',
        toListName: 'Fazendo',
      });
      const [activityRow] = await db()
        .select()
        .from(cardActivities)
        .where(eq(cardActivities.type, 'card_moved'));
      expect(activityRow?.boardId).toBe(two.board.id);
    });

    it('conclusão: entrar na lista de conclusão conclui; sair reabre na posição pedida; demais só movem', async () => {
      const one = await newBoard('Um');
      const two = await newBoard('Dois');
      const anchor = await card(one.todo, 'Âncora');
      const c = await card(one.todo, 'Ciclo');
      clock.advance(1_000);

      // aberto → lista de conclusão: conclui.
      let res = await moveCard(c.id, { toListId: one.done.id, placement: { type: 'end' } });
      let body = cardMutationResultSchema.parse(res.json());
      expect(body.completionChange).toBe('completed');
      expect(body.card).toMatchObject({
        status: 'completed',
        completedAt: '2026-09-16T12:00:01.000Z',
        listId: one.done.id,
      });
      expect((await row(c.id)).completedBy).toBe(member.user.id);
      expect(await types(c.id)).toEqual(['card_completed', 'card_moved', 'card_created']);

      // Reordenar dentro da lista de conclusão: nada muda.
      res = await moveCard(c.id, { toListId: one.done.id, placement: { type: 'start' } });
      expect(cardMutationResultSchema.parse(res.json()).completionChange).toBeNull();

      // Concluído na lista de conclusão → lista de conclusão de outro quadro: continua concluído.
      res = await moveCard(c.id, { toListId: two.done.id, placement: { type: 'end' } });
      body = cardMutationResultSchema.parse(res.json());
      expect(body.completionChange).toBeNull();
      expect(body.card.status).toBe('completed');

      // Concluído saindo da lista de conclusão para lista comum (outro quadro): reabre onde pediu.
      clock.advance(1_000);
      res = await moveCard(c.id, {
        toListId: one.todo.id,
        placement: { type: 'after', id: anchor.id },
      });
      body = cardMutationResultSchema.parse(res.json());
      expect(body.completionChange).toBe('reopened');
      expect(body.card).toMatchObject({ status: 'open', completedAt: null, listId: one.todo.id });
      expect(await row(c.id)).toMatchObject({ completedAt: null, completedBy: null });
      expect(await idsInList(one.board.id, one.todo.id)).toEqual([anchor.id, c.id]);
      expect((await types(c.id)).slice(0, 2)).toEqual(['card_reopened', 'card_moved']);

      // Concluído fora da lista de conclusão (pelo botão) movido entre listas comuns: só move.
      await db()
        .update(cards)
        .set({ status: 'completed', completedAt: clock.now(), completedBy: admin.user.id })
        .where(eq(cards.id, anchor.id));
      res = await moveCard(anchor.id, { toListId: one.doing.id, placement: { type: 'end' } });
      body = cardMutationResultSchema.parse(res.json());
      expect(body.completionChange).toBeNull();
      expect(body.card.status).toBe('completed');
      expect((await row(anchor.id)).completedBy).toBe(admin.user.id);

      // Concluído (pelo botão) entrando na lista de conclusão: continua concluído, sem nova atividade.
      res = await moveCard(anchor.id, { toListId: one.done.id, placement: { type: 'end' } });
      expect(cardMutationResultSchema.parse(res.json()).completionChange).toBeNull();
      expect(await types(anchor.id)).toEqual(['card_moved', 'card_moved', 'card_created']);

      // Aberto entrando na lista de conclusão de outro quadro: conclui.
      res = await moveCard(c.id, { toListId: two.done.id, placement: { type: 'start' } });
      expect(cardMutationResultSchema.parse(res.json()).completionChange).toBe('completed');

      // Quadro sem lista de conclusão: movimentos não mudam o status.
      await app.inject({
        method: 'PATCH',
        url: `/api/lists/${two.done.id}`,
        headers: member.headers,
        payload: { isDoneList: false },
      });
      res = await moveCard(c.id, { toListId: two.todo.id, placement: { type: 'end' } });
      body = cardMutationResultSchema.parse(res.json());
      expect(body.completionChange).toBeNull();
      expect(body.card.status).toBe('completed');
    });

    it('409 BOARD_ARCHIVED (destino e origem), LIST_ARCHIVED, CONFLICT (card arquivado), INVALID_PLACEMENT', async () => {
      const one = await newBoard('Um');
      const two = await newBoard('Dois');
      const moving = await card(one.todo, 'M');
      const sibling = await card(one.doing, 'S');
      const other = await card(one.todo, 'O');

      for (const id of [moving.id, other.id, MISSING_ID]) {
        expectError(
          await moveCard(moving.id, { toListId: one.doing.id, placement: { type: 'after', id } }),
          409,
          'INVALID_PLACEMENT',
        );
      }
      // Irmão arquivado não serve de âncora.
      await cardAction(sibling.id, 'archive');
      expectError(
        await moveCard(moving.id, {
          toListId: one.doing.id,
          placement: { type: 'after', id: sibling.id },
        }),
        409,
        'INVALID_PLACEMENT',
      );

      await cardAction(other.id, 'archive');
      expectError(
        await moveCard(other.id, { toListId: one.doing.id, placement: { type: 'end' } }),
        409,
        'CONFLICT',
      );

      await db().update(lists).set({ archivedAt: clock.now() }).where(eq(lists.id, one.doing.id));
      expectError(
        await moveCard(moving.id, { toListId: one.doing.id, placement: { type: 'end' } }),
        409,
        'LIST_ARCHIVED',
      );

      await archiveBoard(two.board.id);
      expectError(
        await moveCard(moving.id, { toListId: two.todo.id, placement: { type: 'end' } }),
        409,
        'BOARD_ARCHIVED',
      );
      await db().update(boards).set({ archivedAt: null }).where(eq(boards.id, two.board.id));
      await archiveBoard(one.board.id);
      expectError(
        await moveCard(moving.id, { toListId: two.todo.id, placement: { type: 'end' } }),
        409,
        'BOARD_ARCHIVED',
      );

      expect(await row(moving.id)).toMatchObject({ listId: one.todo.id, boardId: one.board.id });
      expect(await types(moving.id)).toEqual(['card_created']);
    });

    it('400, 404 (card e lista), 403 CSRF, 401', async () => {
      const { todo, doing } = await newBoard();
      const moving = await card(todo);
      const valid = { toListId: doing.id, placement: { type: 'end' } };
      for (const body of [
        {},
        { toListId: doing.id },
        { toListId: 'x', placement: { type: 'end' } },
        { toListId: doing.id, placement: { type: 'after' } },
        { toListId: doing.id, placement: { type: 'meio' } },
      ]) {
        expectError(await moveCard(moving.id, body), 400, 'VALIDATION_ERROR');
      }
      expectError(await moveCard(MISSING_ID, valid), 404, 'NOT_FOUND');
      expectError(
        await moveCard(moving.id, { toListId: MISSING_ID, placement: { type: 'end' } }),
        404,
        'NOT_FOUND',
      );
      expectError(
        await moveCard(moving.id, valid, { cookie: member.cookie }),
        403,
        'CSRF_REJECTED',
      );
      expectError(await moveCard(moving.id, valid, csrfHeaders()), 401, 'UNAUTHENTICATED');
    });

    it('20 movimentos concorrentes para a mesma lista geram posições únicas e ordem coerente', async () => {
      const { board, todo, doing } = await newBoard();
      const anchor = await card(doing, 'Âncora');
      const moving: string[] = [];
      for (let i = 0; i < 20; i++) moving.push((await card(todo, `C${i}`)).id);

      const results = await Promise.all(
        moving.map((id, i) =>
          moveCard(id, {
            toListId: doing.id,
            placement: i % 2 === 0 ? { type: 'start' } : { type: 'after', id: anchor.id },
          }),
        ),
      );
      expect(results.map((r) => r.statusCode)).toEqual(moving.map(() => 200));

      const rows = await db().select().from(cards).where(eq(cards.listId, doing.id));
      expect(rows).toHaveLength(21);
      expect(new Set(rows.map((r) => r.position)).size).toBe(21);
      const fromDb = [...rows].sort((a, b) => (a.position < b.position ? -1 : 1)).map((r) => r.id);
      expect(await idsInList(board.id, doing.id)).toEqual(fromDb);
      expect(await db().$count(cardActivities, eq(cardActivities.type, 'card_moved'))).toBe(20);
    });

    it('o mesmo card movido em paralelo para listas diferentes (e cruzado entre quadros) termina consistente', async () => {
      const one = await newBoard('Um');
      const two = await newBoard('Dois');
      const a = await card(one.todo, 'A');
      const b = await card(two.todo, 'B');

      const targets = [one.doing, two.doing, one.todo, two.todo, one.doing, two.doing];
      const results = await Promise.all([
        ...targets.map((list) =>
          moveCard(a.id, { toListId: list.id, placement: { type: 'start' } }),
        ),
        ...targets.map((list) => moveCard(b.id, { toListId: list.id, placement: { type: 'end' } })),
      ]);
      expect(results.map((r) => r.statusCode)).toEqual(results.map(() => 200));

      for (const id of [a.id, b.id]) {
        const current = await row(id);
        const [list] = await db().select().from(lists).where(eq(lists.id, current.listId));
        expect(list?.boardId).toBe(current.boardId);
        // Cada `card_moved` parte da lista em que o anterior terminou.
        const moves = (await activities(id))
          .filter((act) => act.type === 'card_moved')
          .reverse()
          .map((act) => act.data as { fromListId: string; toListId: string });
        for (let i = 1; i < moves.length; i++) {
          expect(moves[i]?.fromListId).toBe(moves[i - 1]?.toListId);
        }
        expect(moves.at(-1)?.toListId ?? (id === a.id ? one.todo.id : two.todo.id)).toBe(
          current.listId,
        );
      }
    });
  });

  describe('POST /api/cards/:cardId/archive|restore', () => {
    it('arquivar: some do payload, status não muda, idempotente (uma atividade), aparece em arquivados', async () => {
      const { board, todo, done } = await newBoard();
      const created = await card(todo);
      await moveCard(created.id, { toListId: done.id, placement: { type: 'end' } });

      clock.advance(1_000);
      const res = await cardAction(created.id, 'archive');
      expect(res.statusCode).toBe(200);
      expect(cardSummaryResponseSchema.strict().parse(res.json()).card).toMatchObject({
        archivedAt: '2026-09-16T12:00:01.000Z',
        status: 'completed',
      });
      clock.advance(1_000);
      const again = await cardAction(created.id, 'archive');
      expect(cardSummaryResponseSchema.parse(again.json()).card.archivedAt).toBe(
        '2026-09-16T12:00:01.000Z',
      );
      expect((await payload(board.id)).cards).toHaveLength(0);
      const archived = boardArchivedResponseSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/api/boards/${board.id}/archived`,
            headers: { cookie: member.cookie },
          })
        ).json(),
      );
      expect(archived.cards.map((c) => c.id)).toEqual([created.id]);
      expect((await types(created.id)).filter((t) => t === 'card_archived')).toHaveLength(1);
    });

    it('restaurar: fim da lista original (posição antiga ocupada), card_restored, idempotente', async () => {
      const { board, todo } = await newBoard();
      const first = await card(todo, 'Primeiro');
      const second = await card(todo, 'Segundo');
      await cardAction(first.id, 'archive');
      // Ocupa a posição antiga do card arquivado.
      const intruder = await insertCard(db(), todo, member.user.id, {
        title: 'Intruso',
        position: first.position,
      });

      const res = await cardAction(first.id, 'restore');
      expect(res.statusCode).toBe(200);
      const restored = cardSummaryResponseSchema.parse(res.json()).card;
      expect(restored.archivedAt).toBeNull();
      expect(await idsInList(board.id, todo.id)).toEqual([intruder.id, second.id, first.id]);

      expect((await cardAction(first.id, 'restore')).statusCode).toBe(200);
      expect(await types(first.id)).toEqual(['card_restored', 'card_archived', 'card_created']);
    });

    it('restaurar card aberto numa lista de conclusão também conclui', async () => {
      const { doing } = await newBoard();
      const created = await card(doing, 'Aberto');
      await cardAction(created.id, 'archive');
      // A lista passa a ser de conclusão com o card arquivado (arquivados não são concluídos).
      await app.inject({
        method: 'PATCH',
        url: `/api/lists/${doing.id}`,
        headers: member.headers,
        payload: { isDoneList: true },
      });
      expect((await row(created.id)).status).toBe('open');

      clock.advance(1_000);
      const res = await cardAction(created.id, 'restore', admin.headers);
      expect(cardSummaryResponseSchema.parse(res.json()).card).toMatchObject({
        status: 'completed',
        completedAt: '2026-09-16T12:00:01.000Z',
        archivedAt: null,
      });
      expect((await row(created.id)).completedBy).toBe(admin.user.id);
      expect((await types(created.id)).slice(0, 2)).toEqual(['card_completed', 'card_restored']);
    });

    it('409 LIST_ARCHIVED ao restaurar em lista arquivada; 409 BOARD_ARCHIVED', async () => {
      const { board, todo, doing } = await newBoard();
      const inArchivedList = await card(doing);
      await cardAction(inArchivedList.id, 'archive');
      await app.inject({
        method: 'POST',
        url: `/api/lists/${doing.id}/archive`,
        headers: member.headers,
      });
      expectError(await cardAction(inArchivedList.id, 'restore'), 409, 'LIST_ARCHIVED');
      expect((await row(inArchivedList.id)).archivedAt).not.toBeNull();

      const other = await card(todo);
      await archiveBoard(board.id);
      expectError(await cardAction(other.id, 'archive'), 409, 'BOARD_ARCHIVED');
      expectError(await cardAction(inArchivedList.id, 'restore'), 409, 'BOARD_ARCHIVED');
    });

    it('404, 400, 403 CSRF, 401', async () => {
      const { todo } = await newBoard();
      const created = await card(todo);
      for (const name of ['archive', 'restore'] as const) {
        expectError(await cardAction(MISSING_ID, name), 404, 'NOT_FOUND');
        expectError(await cardAction('x', name), 400, 'VALIDATION_ERROR');
        expectError(
          await cardAction(created.id, name, { cookie: member.cookie }),
          403,
          'CSRF_REJECTED',
        );
        expectError(await cardAction(created.id, name, csrfHeaders()), 401, 'UNAUTHENTICATED');
      }
    });
  });

  describe('DELETE /api/cards/:cardId', () => {
    it('Admin exclui em cascata; Member → 403; 404; 409 BOARD_ARCHIVED; 400; CSRF; 401', async () => {
      const { board, todo } = await newBoard();
      const created = await card(todo);
      await insertChecklist(db(), created.id);
      await insertComment(db(), created.id, member.user.id);

      expectError(await deleteCard(created.id, member.headers), 403, 'FORBIDDEN');
      expectError(await deleteCard(MISSING_ID, member.headers), 404, 'NOT_FOUND');
      expectError(await deleteCard('x'), 400, 'VALIDATION_ERROR');
      expectError(await deleteCard(created.id, { cookie: admin.cookie }), 403, 'CSRF_REJECTED');
      expectError(await deleteCard(created.id, csrfHeaders()), 401, 'UNAUTHENTICATED');

      const res = await deleteCard(created.id);
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
      expect(await db().$count(cards)).toBe(0);
      expect(await db().$count(cardActivities)).toBe(0);
      expectError(await getCard(created.id), 404, 'NOT_FOUND');
      expectError(await deleteCard(created.id), 404, 'NOT_FOUND');

      const kept = await card(todo);
      await archiveBoard(board.id);
      expectError(await deleteCard(kept.id), 409, 'BOARD_ARCHIVED');
    });
  });

  describe('GET /api/cards/:cardId/activity', () => {
    it('mais recentes primeiro (inclusive no mesmo instante), limite de 500, card arquivado', async () => {
      const { todo, doing } = await newBoard();
      const created = await card(todo, 'A');
      // Mesmo instante do relógio: a ordem de gravação é preservada.
      await patchCard(created.id, { title: 'B' });
      await moveCard(created.id, { toListId: doing.id, placement: { type: 'end' } });
      await patchCard(created.id, { title: 'C' });
      await cardAction(created.id, 'archive');
      expect(await types(created.id)).toEqual([
        'card_archived',
        'card_title_changed',
        'card_moved',
        'card_title_changed',
        'card_created',
      ]);

      await db()
        .insert(cardActivities)
        .values(
          Array.from({ length: 500 }, (_, i) => ({
            cardId: created.id,
            boardId: created.boardId,
            actorId: admin.user.id,
            type: 'card_archived' as const,
            data: {},
            createdAt: new Date(Date.UTC(2020, 0, 1, 0, 0, i)),
          })),
        );
      const list = await activities(created.id);
      expect(list).toHaveLength(500);
      expect(list[0]?.type).toBe('card_archived');
      expect(list[0]?.createdAt).toBe('2026-09-16T12:00:00.000Z');
      // 5 recentes + as 495 antigas mais novas (i = 5..499).
      expect(list.at(-1)?.createdAt).toBe('2020-01-01T00:00:05.000Z');
    });

    it('404, 400, 401', async () => {
      expectError(await activityRes(MISSING_ID), 404, 'NOT_FOUND');
      expectError(await activityRes('x'), 400, 'VALIDATION_ERROR');
      expectError(await activityRes(MISSING_ID, {}), 401, 'UNAUTHENTICATED');
    });
  });

  describe('payload do quadro com cards', () => {
    it('500 cards em menos de 300 ms', async () => {
      const { board, todo } = await newBoard();
      const extra = await insertList(db(), board.id, { name: 'Extra', position: 'z0' });
      await db()
        .insert(cards)
        .values(
          Array.from({ length: 500 }, (_, i) => ({
            boardId: board.id,
            listId: i % 2 === 0 ? todo.id : extra.id,
            title: `Card ${i}`,
            position: `a${String(i).padStart(4, '0')}`,
            createdBy: member.user.id,
          })),
        );
      // Aquece a conexão e o plano de consulta.
      await payload(board.id);
      const started = performance.now();
      const res = await app.inject({
        method: 'GET',
        url: `/api/boards/${board.id}`,
        headers: { cookie: member.cookie },
      });
      const elapsed = performance.now() - started;
      expect(res.statusCode).toBe(200);
      expect(boardPayloadSchema.parse(res.json()).cards).toHaveLength(500);
      expect(elapsed).toBeLessThan(300);
    });

    it('pares de etiquetas e responsáveis só dos cards do escopo (sem arquivados nem de lista arquivada)', async () => {
      const { board, todo } = await newBoard();
      const archivedList = await insertList(db(), board.id, {
        name: 'Velha',
        position: 'z0',
        archivedAt: clock.now(),
      });
      const label = await insertLabel(db(), board.id);
      const active = await insertCard(db(), todo, member.user.id, { position: 'a0' });
      const archivedCard = await insertCard(db(), todo, member.user.id, {
        position: 'a1',
        archivedAt: clock.now(),
      });
      const inArchivedList = await insertCard(db(), archivedList, member.user.id);
      for (const c of [active, archivedCard, inArchivedList]) {
        await db().insert(cardLabels).values({ cardId: c.id, labelId: label.id });
        await db()
          .insert(cardAssignees)
          .values({ cardId: c.id, userId: member.user.id, assignedBy: member.user.id });
      }
      const activeScope = { boardId: board.id, state: 'active' } as const;
      expect((await findCardLabelPairs(db(), activeScope)).map((p) => p.cardId)).toEqual([
        active.id,
      ]);
      expect((await findCardAssigneePairs(db(), activeScope)).map((p) => p.cardId)).toEqual([
        active.id,
      ]);
      const archivedScope = { boardId: board.id, state: 'archived' } as const;
      expect((await findCardLabelPairs(db(), archivedScope)).map((p) => p.cardId)).toEqual([
        archivedCard.id,
      ]);
      const mine = { assigneeId: member.user.id, actor: boardActor(member) };
      expect((await findCardAssigneePairs(db(), mine)).map((p) => p.cardId)).toEqual([active.id]);
    });
  });
});
