import {
  boardPayloadSchema,
  cardDetailResponseSchema,
  cardSummaryResponseSchema,
  checklistItemResponseSchema,
  checklistResponseSchema,
  createBoardResponseSchema,
  type List,
} from '@raphasparda/ronin-shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { expectError, MISSING_ID, seedTeam, type Actor } from '../../../test/actors';
import { csrfHeaders } from '../../../test/app';
import { createDbTestApp, createTestClock } from '../../../test/auth';
import { describeDb, useTestDatabase } from '../../../test/db';
import type { App } from '../../app';
import { boards, cardActivities, cards, checklistItems, checklists } from '../../db/schema';

describeDb('rotas de checklists (kanban_test)', () => {
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

  async function newCard() {
    const boardRes = await app.inject({
      method: 'POST',
      url: '/api/boards',
      headers: member.headers,
      payload: { name: 'Quadro' },
    });
    const { board, lists } = createBoardResponseSchema.parse(boardRes.json());
    const [todo] = lists as [List];
    const res = await app.inject({
      method: 'POST',
      url: `/api/lists/${todo.id}/cards`,
      headers: member.headers,
      payload: { title: 'Card' },
    });
    return { board, todo, card: cardSummaryResponseSchema.parse(res.json()).card };
  }

  const send = (
    method: 'POST' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
    headers = member.headers,
  ) =>
    app.inject({
      method,
      url,
      headers,
      ...(body === undefined ? {} : { payload: body as object }),
    });

  async function checklist(cardId: string, title = 'Tarefas') {
    const res = await send('POST', `/api/cards/${cardId}/checklists`, { title });
    expect(res.statusCode).toBe(201);
    return checklistResponseSchema.strict().parse(res.json()).checklist;
  }

  async function item(checklistId: string, text: string) {
    const res = await send('POST', `/api/checklists/${checklistId}/items`, { text });
    expect(res.statusCode).toBe(201);
    return checklistItemResponseSchema.strict().parse(res.json()).item;
  }

  const patchItem = (itemId: string, body: unknown, headers = member.headers) =>
    send('PATCH', `/api/checklist-items/${itemId}`, body, headers);

  const moveItem = (itemId: string, body: unknown, headers = member.headers) =>
    send('POST', `/api/checklist-items/${itemId}/move`, body, headers);

  const detail = async (cardId: string) =>
    cardDetailResponseSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/cards/${cardId}`,
          headers: { cookie: member.cookie },
        })
      ).json(),
    ).card;

  const itemTexts = async (cardId: string, index = 0) =>
    (await detail(cardId)).checklists[index]?.items.map((i) => i.text);

  const archiveBoard = (boardId: string) =>
    db().update(boards).set({ archivedAt: clock.now() }).where(eq(boards.id, boardId));

  describe('checklists', () => {
    it('cria (título aparado), renomeia, exclui com itens em cascata; detalhe em ordem de criação', async () => {
      const { card } = await newCard();
      const res = await send('POST', `/api/cards/${card.id}/checklists`, { title: '  Passos  ' });
      expect(res.statusCode).toBe(201);
      const first = checklistResponseSchema.strict().parse(res.json()).checklist;
      expect(first).toEqual({
        id: first.id,
        cardId: card.id,
        title: 'Passos',
        createdAt: '2026-09-16T12:00:00.000Z',
        items: [],
      });
      clock.advance(1_000);
      const second = await checklist(card.id, 'Revisão');
      await item(first.id, 'A');

      const renamed = await send('PATCH', `/api/checklists/${first.id}`, { title: 'Etapas' });
      expect(renamed.statusCode).toBe(200);
      expect(checklistResponseSchema.strict().parse(renamed.json()).checklist).toMatchObject({
        id: first.id,
        title: 'Etapas',
        items: [{ text: 'A' }],
      });
      expect((await detail(card.id)).checklists.map((c) => c.title)).toEqual(['Etapas', 'Revisão']);

      const removed = await send('DELETE', `/api/checklists/${first.id}`);
      expect(removed.statusCode).toBe(204);
      expect(removed.body).toBe('');
      expect(await db().$count(checklistItems)).toBe(0);
      expect((await detail(card.id)).checklists.map((c) => c.id)).toEqual([second.id]);
      expectError(await send('DELETE', `/api/checklists/${first.id}`), 404, 'NOT_FOUND');
      expect(await db().$count(cardActivities)).toBe(1); // só card_created
    });

    it('400 (título vazio, > 200, ids inválidos), 404, 409 BOARD_ARCHIVED, CSRF, 401; card arquivado aceita', async () => {
      const { board, card } = await newCard();
      const created = await checklist(card.id);
      for (const body of [{}, { title: '' }, { title: ' ' }, { title: 'x'.repeat(201) }]) {
        expectError(
          await send('POST', `/api/cards/${card.id}/checklists`, body),
          400,
          'VALIDATION_ERROR',
        );
        expectError(
          await send('PATCH', `/api/checklists/${created.id}`, body),
          400,
          'VALIDATION_ERROR',
        );
      }
      expectError(
        await send('POST', '/api/cards/x/checklists', { title: 'A' }),
        400,
        'VALIDATION_ERROR',
      );
      expectError(
        await send('PATCH', '/api/checklists/x', { title: 'A' }),
        400,
        'VALIDATION_ERROR',
      );
      expectError(await send('DELETE', '/api/checklists/x'), 400, 'VALIDATION_ERROR');

      expectError(
        await send('POST', `/api/cards/${MISSING_ID}/checklists`, { title: 'A' }),
        404,
        'NOT_FOUND',
      );
      expectError(
        await send('PATCH', `/api/checklists/${MISSING_ID}`, { title: 'A' }),
        404,
        'NOT_FOUND',
      );
      expectError(await send('DELETE', `/api/checklists/${MISSING_ID}`), 404, 'NOT_FOUND');

      const noCsrf = { cookie: member.cookie };
      expectError(
        await send('POST', `/api/cards/${card.id}/checklists`, { title: 'A' }, noCsrf),
        403,
        'CSRF_REJECTED',
      );
      expectError(
        await send('PATCH', `/api/checklists/${created.id}`, { title: 'A' }, noCsrf),
        403,
        'CSRF_REJECTED',
      );
      expectError(
        await send('DELETE', `/api/checklists/${created.id}`, undefined, noCsrf),
        403,
        'CSRF_REJECTED',
      );
      const anon = csrfHeaders();
      expectError(
        await send('POST', `/api/cards/${card.id}/checklists`, { title: 'A' }, anon),
        401,
        'UNAUTHENTICATED',
      );
      expectError(
        await send('PATCH', `/api/checklists/${created.id}`, { title: 'A' }, anon),
        401,
        'UNAUTHENTICATED',
      );
      expectError(
        await send('DELETE', `/api/checklists/${created.id}`, undefined, anon),
        401,
        'UNAUTHENTICATED',
      );

      await db().update(cards).set({ archivedAt: clock.now() }).where(eq(cards.id, card.id));
      expect(
        (await send('PATCH', `/api/checklists/${created.id}`, { title: 'Ok' })).statusCode,
      ).toBe(200);

      await archiveBoard(board.id);
      expectError(
        await send('POST', `/api/cards/${card.id}/checklists`, { title: 'A' }),
        409,
        'BOARD_ARCHIVED',
      );
      expectError(
        await send('PATCH', `/api/checklists/${created.id}`, { title: 'A' }),
        409,
        'BOARD_ARCHIVED',
      );
      expectError(await send('DELETE', `/api/checklists/${created.id}`), 409, 'BOARD_ARCHIVED');
      expect(await db().$count(checklists)).toBe(1);
    });
  });

  describe('itens', () => {
    it('adiciona no fim, edita texto; marcar grava checkedBy/checkedAt; remarcar mantém; desmarcar limpa; sem atividade', async () => {
      const { card } = await newCard();
      const list = await checklist(card.id);
      const a = await item(list.id, '  Primeiro ');
      const b = await item(list.id, 'Segundo');
      expect(a).toEqual({
        id: a.id,
        checklistId: list.id,
        text: 'Primeiro',
        position: a.position,
        isChecked: false,
        checkedBy: null,
        checkedAt: null,
      });
      expect(b.position > a.position).toBe(true);

      const edited = await patchItem(a.id, { text: 'Primeiro passo' });
      expect(checklistItemResponseSchema.strict().parse(edited.json()).item.text).toBe(
        'Primeiro passo',
      );

      clock.advance(60_000);
      const checked = await patchItem(a.id, { isChecked: true }, admin.headers);
      expect(checked.statusCode).toBe(200);
      expect(checklistItemResponseSchema.parse(checked.json()).item).toMatchObject({
        isChecked: true,
        checkedBy: admin.user.id,
        checkedAt: '2026-09-16T12:01:00.000Z',
      });

      clock.advance(60_000);
      const again = await patchItem(a.id, { isChecked: true, text: 'Passo 1' });
      expect(checklistItemResponseSchema.parse(again.json()).item).toMatchObject({
        text: 'Passo 1',
        isChecked: true,
        checkedBy: admin.user.id,
        checkedAt: '2026-09-16T12:01:00.000Z',
      });

      const unchecked = await patchItem(a.id, { isChecked: false });
      expect(checklistItemResponseSchema.parse(unchecked.json()).item).toMatchObject({
        isChecked: false,
        checkedBy: null,
        checkedAt: null,
      });
      expect(await itemTexts(card.id)).toEqual(['Passo 1', 'Segundo']);
      expect(await db().$count(cardActivities)).toBe(1);
    });

    it('marcar todos os itens não conclui o card; contagem {done,total} soma vários checklists no payload, detalhe e move', async () => {
      const { board, todo, card } = await newCard();
      const one = await checklist(card.id, 'Um');
      const two = await checklist(card.id, 'Dois');
      const items = [await item(one.id, 'a'), await item(one.id, 'b'), await item(two.id, 'c')];
      await patchItem(items[0]!.id, { isChecked: true });
      await patchItem(items[2]!.id, { isChecked: true });

      const payload = boardPayloadSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/api/boards/${board.id}`,
            headers: { cookie: member.cookie },
          })
        ).json(),
      );
      expect(payload.cards[0]?.checklist).toEqual({ done: 2, total: 3 });

      await patchItem(items[1]!.id, { isChecked: true });
      const full = await detail(card.id);
      expect(full).toMatchObject({ status: 'open', checklist: { done: 3, total: 3 } });

      const moved = await app.inject({
        method: 'POST',
        url: `/api/cards/${card.id}/move`,
        headers: member.headers,
        payload: { toListId: todo.id, placement: { type: 'end' } },
      });
      expect(moved.json()).toMatchObject({ card: { checklist: { done: 3, total: 3 } } });
      expect((await db().select().from(cardActivities)).map((a) => a.type)).toEqual([
        'card_created',
      ]);
    });

    it('move: start, after e end no mesmo checklist; 409 INVALID_PLACEMENT (outro checklist, o próprio item, inexistente)', async () => {
      const { card } = await newCard();
      const list = await checklist(card.id);
      clock.advance(1_000);
      const other = await checklist(card.id, 'Outro');
      const a = await item(list.id, 'A');
      const b = await item(list.id, 'B');
      const c = await item(list.id, 'C');
      const foreign = await item(other.id, 'X');

      const res = await moveItem(c.id, { placement: { type: 'start' } });
      expect(res.statusCode).toBe(200);
      expect(checklistItemResponseSchema.strict().parse(res.json()).item.id).toBe(c.id);
      expect(await itemTexts(card.id)).toEqual(['C', 'A', 'B']);
      await moveItem(c.id, { placement: { type: 'after', id: a.id } });
      expect(await itemTexts(card.id)).toEqual(['A', 'C', 'B']);
      await moveItem(a.id, { placement: { type: 'end' } });
      expect(await itemTexts(card.id)).toEqual(['C', 'B', 'A']);

      for (const id of [foreign.id, b.id, MISSING_ID]) {
        const target = id === b.id ? b.id : c.id;
        expectError(
          await moveItem(target, { placement: { type: 'after', id } }),
          409,
          'INVALID_PLACEMENT',
        );
      }
      expect(await itemTexts(card.id)).toEqual(['C', 'B', 'A']);
      expect(await itemTexts(card.id, 1)).toEqual(['X']);
    });

    it('10 itens criados e 10 movimentos concorrentes mantêm posições únicas', async () => {
      const { card } = await newCard();
      const list = await checklist(card.id);
      const created = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          send('POST', `/api/checklists/${list.id}/items`, { text: `I${i}` }),
        ),
      );
      expect(created.map((r) => r.statusCode)).toEqual(Array(10).fill(201));
      const ids = created.map((r) => checklistItemResponseSchema.parse(r.json()).item.id);
      const moves = await Promise.all(
        ids.map((id) => moveItem(id, { placement: { type: 'start' } })),
      );
      expect(moves.map((r) => r.statusCode)).toEqual(Array(10).fill(200));
      const rows = await db()
        .select()
        .from(checklistItems)
        .where(eq(checklistItems.checklistId, list.id));
      expect(new Set(rows.map((r) => r.position)).size).toBe(10);
    });

    it('exclui item; 400; 404; 409 BOARD_ARCHIVED; CSRF; 401 em todas as rotas de item', async () => {
      const { board, card } = await newCard();
      const list = await checklist(card.id);
      const kept = await item(list.id, 'Fica');
      const gone = await item(list.id, 'Sai');

      const removed = await send('DELETE', `/api/checklist-items/${gone.id}`);
      expect(removed.statusCode).toBe(204);
      expect(await itemTexts(card.id)).toEqual(['Fica']);
      expectError(await send('DELETE', `/api/checklist-items/${gone.id}`), 404, 'NOT_FOUND');

      for (const body of [{}, { text: '' }, { text: 'x'.repeat(501) }]) {
        expectError(
          await send('POST', `/api/checklists/${list.id}/items`, body),
          400,
          'VALIDATION_ERROR',
        );
      }
      for (const body of [{}, { foo: 1 }, { text: '' }, { isChecked: 'sim' }]) {
        expectError(await patchItem(kept.id, body), 400, 'VALIDATION_ERROR');
      }
      for (const body of [{}, { placement: { type: 'meio' } }, { placement: { type: 'after' } }]) {
        expectError(await moveItem(kept.id, body), 400, 'VALIDATION_ERROR');
      }
      expectError(await patchItem('x', { text: 'a' }), 400, 'VALIDATION_ERROR');
      expectError(await send('DELETE', '/api/checklist-items/x'), 400, 'VALIDATION_ERROR');

      expectError(
        await send('POST', `/api/checklists/${MISSING_ID}/items`, { text: 'a' }),
        404,
        'NOT_FOUND',
      );
      expectError(await patchItem(MISSING_ID, { text: 'a' }), 404, 'NOT_FOUND');
      expectError(await moveItem(MISSING_ID, { placement: { type: 'end' } }), 404, 'NOT_FOUND');

      const noCsrf = { cookie: member.cookie };
      const anon = csrfHeaders();
      expectError(
        await send('POST', `/api/checklists/${list.id}/items`, { text: 'a' }, noCsrf),
        403,
        'CSRF_REJECTED',
      );
      expectError(await patchItem(kept.id, { text: 'a' }, noCsrf), 403, 'CSRF_REJECTED');
      expectError(
        await moveItem(kept.id, { placement: { type: 'end' } }, noCsrf),
        403,
        'CSRF_REJECTED',
      );
      expectError(
        await send('DELETE', `/api/checklist-items/${kept.id}`, undefined, noCsrf),
        403,
        'CSRF_REJECTED',
      );
      expectError(
        await send('POST', `/api/checklists/${list.id}/items`, { text: 'a' }, anon),
        401,
        'UNAUTHENTICATED',
      );
      expectError(await patchItem(kept.id, { text: 'a' }, anon), 401, 'UNAUTHENTICATED');
      expectError(
        await moveItem(kept.id, { placement: { type: 'end' } }, anon),
        401,
        'UNAUTHENTICATED',
      );
      expectError(
        await send('DELETE', `/api/checklist-items/${kept.id}`, undefined, anon),
        401,
        'UNAUTHENTICATED',
      );

      await archiveBoard(board.id);
      expectError(
        await send('POST', `/api/checklists/${list.id}/items`, { text: 'a' }),
        409,
        'BOARD_ARCHIVED',
      );
      expectError(await patchItem(kept.id, { isChecked: true }), 409, 'BOARD_ARCHIVED');
      expectError(await moveItem(kept.id, { placement: { type: 'start' } }), 409, 'BOARD_ARCHIVED');
      expectError(await send('DELETE', `/api/checklist-items/${kept.id}`), 409, 'BOARD_ARCHIVED');
      const [row] = await db().select().from(checklistItems).where(eq(checklistItems.id, kept.id));
      expect(row).toMatchObject({ isChecked: false, text: 'Fica' });
    });
  });
});
