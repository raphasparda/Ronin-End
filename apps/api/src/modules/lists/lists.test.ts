import {
  boardPayloadSchema,
  createBoardResponseSchema,
  listResponseSchema,
  PALETTE,
  updateListResponseSchema,
  type List,
} from '@kanban/shared';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { expectError, MISSING_ID, seedTeam, type Actor } from '../../../test/actors';
import { csrfHeaders } from '../../../test/app';
import { createDbTestApp, createTestClock } from '../../../test/auth';
import { describeDb, useTestDatabase } from '../../../test/db';
import type { App } from '../../app';
import { boards, cardActivities, cards, lists } from '../../db/schema';
import { insertBoard, insertCard, insertList } from '../../db/test-fixtures';

describeDb('rotas de listas (kanban_test)', () => {
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

  const createList = (boardId: string, body: unknown, headers = member.headers) =>
    app.inject({
      method: 'POST',
      url: `/api/boards/${boardId}/lists`,
      headers,
      payload: body as object,
    });

  const patchList = (listId: string, body: unknown, headers = member.headers) =>
    app.inject({ method: 'PATCH', url: `/api/lists/${listId}`, headers, payload: body as object });

  const moveList = (listId: string, placement: unknown, headers = member.headers) =>
    app.inject({
      method: 'POST',
      url: `/api/lists/${listId}/move`,
      headers,
      payload: { placement },
    });

  const action = (listId: string, name: 'archive' | 'restore', headers = member.headers) =>
    app.inject({ method: 'POST', url: `/api/lists/${listId}/${name}`, headers });

  const names = (items: List[]) => items.map((l) => l.name);

  describe('POST /api/boards/:boardId/lists', () => {
    it('sem cor: próxima da paleta após a última lista ativa; no fim por padrão', async () => {
      const { board } = await newBoard();
      const res = await createList(board.id, { name: ' Revisão ' });
      expect(res.statusCode).toBe(201);
      const { list } = listResponseSchema.strict().parse(res.json());
      // Última lista ativa é "Concluído" (green) → cyan.
      expect(list).toMatchObject({
        name: 'Revisão',
        color: 'cyan',
        isDoneList: false,
        archivedAt: null,
      });
      expect(names((await payload(board.id)).lists)).toEqual([
        'A fazer',
        'Fazendo',
        'Concluído',
        'Revisão',
      ]);
    });

    it('ciclo da paleta volta ao início depois de magenta; quadro sem listas ativas começa em gray', async () => {
      const board = await insertBoard(db(), admin.user.id);
      const colors: string[] = [];
      for (let i = 0; i < PALETTE.length + 1; i++) {
        const res = await createList(board.id, { name: `L${i}` });
        colors.push(listResponseSchema.parse(res.json()).list.color);
      }
      expect(colors).toEqual([...PALETTE, 'gray']);

      const magentaLast = await insertBoard(db(), admin.user.id);
      await insertList(db(), magentaLast.id, { position: 'a0', color: 'magenta' });
      await insertList(db(), magentaLast.id, {
        position: 'a1',
        color: 'red',
        archivedAt: clock.now(),
      });
      const res = await createList(magentaLast.id, { name: 'Próxima' });
      expect(listResponseSchema.parse(res.json()).list.color).toBe('gray');
    });

    it('cor informada e placement start/after', async () => {
      const { board, todo, doing } = await newBoard();
      const start = await createList(board.id, {
        name: 'Início',
        color: 'purple',
        placement: { type: 'start' },
      });
      expect(listResponseSchema.parse(start.json()).list.color).toBe('purple');
      const after = await createList(board.id, {
        name: 'Meio',
        placement: { type: 'after', id: todo.id },
      });
      expect(after.statusCode).toBe(201);
      expect(names((await payload(board.id)).lists)).toEqual([
        'Início',
        'A fazer',
        'Meio',
        'Fazendo',
        'Concluído',
      ]);
      expect(doing.id).toBeDefined();
    });

    it('409 INVALID_PLACEMENT (inexistente, arquivada, de outro quadro); 409 BOARD_ARCHIVED', async () => {
      const { board, todo } = await newBoard('Um');
      const other = await newBoard('Dois');
      await action(todo.id, 'archive');
      for (const id of [MISSING_ID, todo.id, other.todo.id]) {
        const res = await createList(board.id, { name: 'X', placement: { type: 'after', id } });
        expectError(res, 409, 'INVALID_PLACEMENT');
      }
      await app.inject({
        method: 'POST',
        url: `/api/boards/${board.id}/archive`,
        headers: member.headers,
      });
      expectError(await createList(board.id, { name: 'X' }), 409, 'BOARD_ARCHIVED');
      expect(await db().$count(lists, eq(lists.boardId, board.id))).toBe(3);
    });

    it('400 (nome, cor fora da paleta, placement), 404, 403 CSRF, 401', async () => {
      const { board } = await newBoard();
      for (const body of [
        { name: '' },
        { name: 'X', color: '#ff0000' },
        { name: 'X', placement: { type: 'after' } },
      ]) {
        expectError(await createList(board.id, body), 400, 'VALIDATION_ERROR');
      }
      expectError(await createList(MISSING_ID, { name: 'X' }), 404, 'NOT_FOUND');
      expectError(
        await createList(board.id, { name: 'X' }, { cookie: member.cookie }),
        403,
        'CSRF_REJECTED',
      );
      expectError(await createList(board.id, { name: 'X' }, csrfHeaders()), 401, 'UNAUTHENTICATED');
    });
  });

  describe('PATCH /api/lists/:listId', () => {
    it('renomeia e troca a cor; a nova cor aparece no payload', async () => {
      const { board, doing } = await newBoard();
      const res = await patchList(doing.id, { name: 'Em andamento', color: 'yellow' });
      expect(res.statusCode).toBe(200);
      const body = updateListResponseSchema.strict().parse(res.json());
      expect(body.completedCardIds).toEqual([]);
      expect(body.lists.find((l) => l.id === doing.id)).toMatchObject({
        name: 'Em andamento',
        color: 'yellow',
      });
      expect((await payload(board.id)).lists.find((l) => l.id === doing.id)?.color).toBe('yellow');
    });

    it('marcar outra lista como conclusão desmarca a anterior, responde todas e conclui os cards abertos', async () => {
      const { board, doing, done } = await newBoard();
      const open1 = await insertCard(db(), doing, member.user.id, { position: 'a0' });
      const open2 = await insertCard(db(), doing, member.user.id, { position: 'a1' });
      const open3 = await insertCard(db(), doing, member.user.id, { position: 'a2' });
      const archivedCard = await insertCard(db(), doing, member.user.id, {
        position: 'a3',
        archivedAt: clock.now(),
      });
      const alreadyDone = await insertCard(db(), doing, member.user.id, {
        position: 'a4',
        status: 'completed',
        completedAt: new Date('2026-09-01T00:00:00Z'),
        completedBy: admin.user.id,
      });

      clock.advance(1_000);
      const res = await patchList(doing.id, { isDoneList: true });
      expect(res.statusCode).toBe(200);
      const body = updateListResponseSchema.strict().parse(res.json());
      expect(body.lists.map((l) => [l.id, l.isDoneList])).toEqual([
        [body.lists[0]?.id, false],
        [doing.id, true],
        [done.id, false],
      ]);
      expect(body.completedCardIds).toEqual([open1.id, open2.id, open3.id].sort());

      const rows = await db().select().from(cards).where(eq(cards.listId, doing.id));
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const id of [open1.id, open2.id, open3.id]) {
        expect(byId.get(id)).toMatchObject({
          status: 'completed',
          completedBy: member.user.id,
          completedAt: new Date('2026-09-16T12:00:01.000Z'),
        });
      }
      expect(byId.get(open1.id)?.position).toBe('a0');
      expect(byId.get(archivedCard.id)?.status).toBe('open');
      expect(byId.get(alreadyDone.id)?.completedBy).toBe(admin.user.id);

      const activities = await db()
        .select()
        .from(cardActivities)
        .where(eq(cardActivities.type, 'card_completed'));
      expect(activities.map((a) => a.cardId).sort()).toEqual([open1.id, open2.id, open3.id].sort());
      expect(activities.every((a) => a.actorId === member.user.id && a.boardId === board.id)).toBe(
        true,
      );

      // Marcar de novo é no-op.
      const again = updateListResponseSchema.parse(
        (await patchList(doing.id, { isDoneList: true })).json(),
      );
      expect(again.completedCardIds).toEqual([]);

      // Desmarcar não reabre ninguém.
      const unmark = updateListResponseSchema.parse(
        (await patchList(doing.id, { isDoneList: false })).json(),
      );
      expect(unmark.completedCardIds).toEqual([]);
      expect(unmark.lists.every((l) => !l.isDoneList)).toBe(true);
      expect(
        await db().$count(cards, and(eq(cards.listId, doing.id), eq(cards.status, 'completed'))),
      ).toBe(4);
    });

    it('409 LIST_ARCHIVED ao marcar lista arquivada; 409 BOARD_ARCHIVED', async () => {
      const { board, todo, doing } = await newBoard();
      await action(todo.id, 'archive');
      expectError(await patchList(todo.id, { isDoneList: true }), 409, 'LIST_ARCHIVED');
      await app.inject({
        method: 'POST',
        url: `/api/boards/${board.id}/archive`,
        headers: member.headers,
      });
      expectError(await patchList(doing.id, { name: 'X' }), 409, 'BOARD_ARCHIVED');
    });

    it('400 (vazio, campos desconhecidos, cor inválida), 404, 403 CSRF, 401', async () => {
      const { todo } = await newBoard();
      for (const body of [{}, { foo: 'bar' }, { color: 'pink' }, { isDoneList: 'sim' }]) {
        expectError(await patchList(todo.id, body), 400, 'VALIDATION_ERROR');
      }
      expectError(await patchList(MISSING_ID, { name: 'X' }), 404, 'NOT_FOUND');
      expectError(
        await app.inject({
          method: 'PATCH',
          url: '/api/lists/123',
          headers: member.headers,
          payload: { name: 'X' },
        }),
        400,
        'VALIDATION_ERROR',
      );
      expectError(
        await patchList(todo.id, { name: 'X' }, { cookie: member.cookie }),
        403,
        'CSRF_REJECTED',
      );
      expectError(await patchList(todo.id, { name: 'X' }, csrfHeaders()), 401, 'UNAUTHENTICATED');
    });
  });

  describe('POST /api/lists/:listId/move', () => {
    it('start, end e after', async () => {
      const { board, todo, doing, done } = await newBoard();
      expect(
        listResponseSchema.parse((await moveList(done.id, { type: 'start' })).json()).list.id,
      ).toBe(done.id);
      expect(names((await payload(board.id)).lists)).toEqual(['Concluído', 'A fazer', 'Fazendo']);
      await moveList(done.id, { type: 'end' });
      expect(names((await payload(board.id)).lists)).toEqual(['A fazer', 'Fazendo', 'Concluído']);
      await moveList(todo.id, { type: 'after', id: doing.id });
      expect(names((await payload(board.id)).lists)).toEqual(['Fazendo', 'A fazer', 'Concluído']);
    });

    it('409 INVALID_PLACEMENT (o próprio item, arquivada, outro quadro); 409 LIST_ARCHIVED; 409 BOARD_ARCHIVED', async () => {
      const { board, todo, doing, done } = await newBoard('Um');
      const other = await newBoard('Dois');
      await action(doing.id, 'archive');
      for (const id of [todo.id, doing.id, other.todo.id]) {
        expectError(await moveList(todo.id, { type: 'after', id }), 409, 'INVALID_PLACEMENT');
      }
      expectError(await moveList(doing.id, { type: 'start' }), 409, 'LIST_ARCHIVED');
      await app.inject({
        method: 'POST',
        url: `/api/boards/${board.id}/archive`,
        headers: member.headers,
      });
      expectError(await moveList(done.id, { type: 'start' }), 409, 'BOARD_ARCHIVED');
    });

    it('400, 404, 403 CSRF, 401', async () => {
      const { todo } = await newBoard();
      expectError(await moveList(todo.id, { type: 'meio' }), 400, 'VALIDATION_ERROR');
      expectError(await moveList(MISSING_ID, { type: 'start' }), 404, 'NOT_FOUND');
      expectError(
        await moveList(todo.id, { type: 'start' }, { cookie: member.cookie }),
        403,
        'CSRF_REJECTED',
      );
      expectError(
        await moveList(todo.id, { type: 'start' }, csrfHeaders()),
        401,
        'UNAUTHENTICATED',
      );
    });

    it('20 movimentos concorrentes geram posições únicas e ordem coerente', async () => {
      const board = await insertBoard(db(), admin.user.id);
      const created: string[] = [];
      for (let i = 0; i < 21; i++) {
        const res = await createList(board.id, { name: `L${String(i).padStart(2, '0')}` });
        created.push(listResponseSchema.parse(res.json()).list.id);
      }
      const anchor = created[0] as string;
      const moving = created.slice(1);
      const results = await Promise.all(
        moving.map((id, i) =>
          moveList(id, i % 2 === 0 ? { type: 'start' } : { type: 'after', id: anchor }),
        ),
      );
      expect(results.map((r) => r.statusCode)).toEqual(moving.map(() => 200));

      const rows = await db().select().from(lists).where(eq(lists.boardId, board.id));
      expect(new Set(rows.map((r) => r.position)).size).toBe(21);
      const fromDb = [...rows].sort((a, b) => (a.position < b.position ? -1 : 1)).map((r) => r.id);
      expect((await payload(board.id)).lists.map((l) => l.id)).toEqual(fromDb);
    });
  });

  describe('POST /api/lists/:listId/archive|restore', () => {
    it('arquivar a lista de conclusão desmarca; cards somem do payload; restaurar vai para o fim', async () => {
      const { board, todo, doing, done } = await newBoard();
      const card = await insertCard(db(), done, member.user.id, {
        status: 'completed',
        completedAt: clock.now(),
        completedBy: member.user.id,
      });
      await insertCard(db(), todo, member.user.id);

      const archived = await action(done.id, 'archive');
      expect(archived.statusCode).toBe(200);
      expect(listResponseSchema.parse(archived.json()).list).toMatchObject({
        isDoneList: false,
        archivedAt: '2026-09-16T12:00:00.000Z',
      });
      const again = await action(done.id, 'archive');
      expect(listResponseSchema.parse(again.json()).list.archivedAt).toBe(
        '2026-09-16T12:00:00.000Z',
      );

      const afterArchive = await payload(board.id);
      expect(names(afterArchive.lists)).toEqual(['A fazer', 'Fazendo']);
      expect(afterArchive.cards.map((c) => c.id)).not.toContain(card.id);
      const [cardRow] = await db().select().from(cards).where(eq(cards.id, card.id));
      expect(cardRow).toMatchObject({ archivedAt: null, status: 'completed' });

      await moveList(doing.id, { type: 'start' });
      const restored = await action(done.id, 'restore');
      expect(restored.statusCode).toBe(200);
      expect(listResponseSchema.parse(restored.json()).list).toMatchObject({
        archivedAt: null,
        isDoneList: false,
      });
      expect((await action(done.id, 'restore')).statusCode).toBe(200);
      const afterRestore = await payload(board.id);
      expect(names(afterRestore.lists)).toEqual(['Fazendo', 'A fazer', 'Concluído']);
      expect(afterRestore.cards.map((c) => c.id)).toContain(card.id);
    });

    it('restaurar com a posição antiga ocupada gera nova posição no fim', async () => {
      const board = await insertBoard(db(), admin.user.id);
      const old = await insertList(db(), board.id, {
        name: 'Velha',
        position: 'a0',
        archivedAt: clock.now(),
      });
      await insertList(db(), board.id, { name: 'Ocupa', position: 'a0' });
      const res = await action(old.id, 'restore');
      expect(res.statusCode).toBe(200);
      expect(listResponseSchema.parse(res.json()).list.position > 'a0').toBe(true);
    });

    it('409 BOARD_ARCHIVED, 404, 400, 403 CSRF, 401', async () => {
      const { board, todo } = await newBoard();
      await db().update(boards).set({ archivedAt: clock.now() }).where(eq(boards.id, board.id));
      for (const name of ['archive', 'restore'] as const) {
        expectError(await action(todo.id, name), 409, 'BOARD_ARCHIVED');
        expectError(await action(MISSING_ID, name), 404, 'NOT_FOUND');
        expectError(
          await app.inject({
            method: 'POST',
            url: `/api/lists/x/${name}`,
            headers: member.headers,
          }),
          400,
          'VALIDATION_ERROR',
        );
        expectError(await action(todo.id, name, { cookie: member.cookie }), 403, 'CSRF_REJECTED');
        expectError(await action(todo.id, name, csrfHeaders()), 401, 'UNAUTHENTICATED');
      }
    });
  });
});
