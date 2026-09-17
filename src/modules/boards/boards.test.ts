import {
  boardArchivedResponseSchema,
  boardPayloadSchema,
  boardResponseSchema,
  boardsResponseSchema,
  createBoardResponseSchema,
} from '@raphasparda/ronin-shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { expectError, MISSING_ID, seedTeam, type Actor } from '../../../test/actors';
import { csrfHeaders } from '../../../test/app';
import { createDbTestApp, createTestClock } from '../../../test/auth';
import { describeDb, useTestDatabase } from '../../../test/db';
import type { App } from '../../app';
import { boards, cardAssignees, cardLabels, cards, checklistItems, lists } from '../../db/schema';
import {
  insertBoard,
  insertCard,
  insertChecklist,
  insertComment,
  insertLabel,
  insertList,
} from '../../db/test-fixtures';

describeDb('rotas de quadros (kanban_test)', () => {
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

  const createBoard = async (name: string, actor: Actor = member) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/boards',
      headers: actor.headers,
      payload: { name },
    });
    expect(res.statusCode).toBe(201);
    return createBoardResponseSchema.parse(res.json());
  };

  describe('POST /api/boards', () => {
    it('201: cria o quadro com "A fazer" azul, "Fazendo" laranja e "Concluído" verde (conclusão)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/boards',
        headers: member.headers,
        payload: { name: '  Produto  ' },
      });
      expect(res.statusCode).toBe(201);
      const body = createBoardResponseSchema.strict().parse(res.json());
      expect(body.board).toMatchObject({
        name: 'Produto',
        archivedAt: null,
        createdAt: '2026-09-16T12:00:00.000Z',
      });
      expect(
        body.lists.map(({ name, color, isDoneList, archivedAt, boardId }) => ({
          name,
          color,
          isDoneList,
          archivedAt,
          boardId,
        })),
      ).toEqual([
        {
          name: 'A fazer',
          color: 'blue',
          isDoneList: false,
          archivedAt: null,
          boardId: body.board.id,
        },
        {
          name: 'Fazendo',
          color: 'orange',
          isDoneList: false,
          archivedAt: null,
          boardId: body.board.id,
        },
        {
          name: 'Concluído',
          color: 'green',
          isDoneList: true,
          archivedAt: null,
          boardId: body.board.id,
        },
      ]);
      const positions = body.lists.map((l) => l.position);
      expect([...positions].sort()).toEqual(positions);
      expect(new Set(positions).size).toBe(3);

      const [row] = await db().select().from(boards).where(eq(boards.id, body.board.id));
      expect(row?.createdBy).toBe(member.user.id);
      expect(await db().$count(lists, eq(lists.boardId, body.board.id))).toBe(3);
    });

    it('401 sem sessão, 403 sem CSRF, 400 com nome vazio ou longo', async () => {
      const noSession = await app.inject({
        method: 'POST',
        url: '/api/boards',
        headers: csrfHeaders(),
        payload: { name: 'X' },
      });
      expectError(noSession, 401, 'UNAUTHENTICATED');

      const noCsrf = await app.inject({
        method: 'POST',
        url: '/api/boards',
        headers: { cookie: member.cookie },
        payload: { name: 'X' },
      });
      expectError(noCsrf, 403, 'CSRF_REJECTED');

      for (const name of ['   ', 'x'.repeat(101)]) {
        const invalid = await app.inject({
          method: 'POST',
          url: '/api/boards',
          headers: member.headers,
          payload: { name },
        });
        expect(expectError(invalid, 400, 'VALIDATION_ERROR').details?.[0]?.path).toBe('name');
      }
      expect(await db().$count(boards)).toBe(0);
    });
  });

  describe('GET /api/boards', () => {
    it('ativos por nome por padrão; archived=true só arquivados; outro valor → 400', async () => {
      const b = await createBoard('Beta');
      await createBoard('Alfa');
      const archived = await createBoard('Gama');
      await app.inject({
        method: 'POST',
        url: `/api/boards/${archived.board.id}/archive`,
        headers: member.headers,
      });

      const active = await app.inject({
        method: 'GET',
        url: '/api/boards',
        headers: { cookie: member.cookie },
      });
      expect(active.statusCode).toBe(200);
      expect(boardsResponseSchema.parse(active.json()).boards.map((x) => x.name)).toEqual([
        'Alfa',
        'Beta',
      ]);

      const onlyArchived = await app.inject({
        method: 'GET',
        url: '/api/boards?archived=true',
        headers: { cookie: member.cookie },
      });
      expect(boardsResponseSchema.parse(onlyArchived.json()).boards).toEqual([
        expect.objectContaining({ name: 'Gama', archivedAt: '2026-09-16T12:00:00.000Z' }),
      ]);

      const falseValue = await app.inject({
        method: 'GET',
        url: '/api/boards?archived=false',
        headers: { cookie: member.cookie },
      });
      expect(boardsResponseSchema.parse(falseValue.json()).boards.map((x) => x.id)).toContain(
        b.board.id,
      );

      const invalid = await app.inject({
        method: 'GET',
        url: '/api/boards?archived=1',
        headers: { cookie: member.cookie },
      });
      expectError(invalid, 400, 'VALIDATION_ERROR');
    });

    it('401 sem sessão', async () => {
      expectError(await app.inject({ method: 'GET', url: '/api/boards' }), 401, 'UNAUTHENTICATED');
    });
  });

  describe('GET /api/boards/:boardId (payload)', () => {
    it('listas ativas por posição; cards ativos de listas ativas com agregados, etiquetas e responsáveis', async () => {
      const board = await insertBoard(db(), admin.user.id, { name: 'Payload' });
      const second = await insertList(db(), board.id, {
        name: 'Segunda',
        position: 'a1',
        color: 'red',
      });
      const first = await insertList(db(), board.id, {
        name: 'Primeira',
        position: 'Zz',
        color: 'gray',
      });
      const archivedList = await insertList(db(), board.id, {
        name: 'Arquivada',
        position: 'a2',
        archivedAt: clock.now(),
      });

      const c2 = await insertCard(db(), first, admin.user.id, { title: 'B', position: 'a1' });
      const c1 = await insertCard(db(), first, admin.user.id, {
        title: 'A',
        position: 'a0',
        description: 'tem descrição',
        dueAt: new Date('2026-09-20T15:00:00.000Z'),
        dueHasTime: true,
        priority: 'high',
      });
      const c3 = await insertCard(db(), second, admin.user.id, { title: 'C', position: 'a0' });
      await insertCard(db(), first, admin.user.id, {
        title: 'Arquivado',
        position: 'a2',
        archivedAt: clock.now(),
      });
      await insertCard(db(), archivedList, admin.user.id, { title: 'Em lista arquivada' });

      const checklist = await insertChecklist(db(), c1.id);
      const other = await insertChecklist(db(), c1.id);
      await db()
        .insert(checklistItems)
        .values([
          {
            checklistId: checklist.id,
            text: '1',
            position: 'a0',
            isChecked: true,
            checkedBy: admin.user.id,
            checkedAt: clock.now(),
          },
          { checklistId: checklist.id, text: '2', position: 'a1' },
          { checklistId: other.id, text: '3', position: 'a0' },
        ]);
      await insertComment(db(), c1.id, admin.user.id);
      await insertComment(db(), c1.id, member.user.id);
      const label = await insertLabel(db(), board.id);
      await db().insert(cardLabels).values({ cardId: c1.id, labelId: label.id });
      await db()
        .insert(cardAssignees)
        .values([
          {
            cardId: c1.id,
            userId: member.user.id,
            assignedBy: admin.user.id,
            createdAt: new Date('2026-09-16T10:00:00Z'),
          },
          {
            cardId: c1.id,
            userId: admin.user.id,
            assignedBy: admin.user.id,
            createdAt: new Date('2026-09-16T11:00:00Z'),
          },
        ]);

      const res = await app.inject({
        method: 'GET',
        url: `/api/boards/${board.id}`,
        headers: { cookie: member.cookie },
      });
      expect(res.statusCode).toBe(200);
      const payload = boardPayloadSchema.strict().parse(res.json());
      expect(payload.board.id).toBe(board.id);
      expect(payload.lists.map((l) => l.name)).toEqual(['Primeira', 'Segunda']);
      expect(payload.labels).toEqual([
        { id: label.id, boardId: board.id, name: 'Bug', color: 'red' },
      ]);

      const expectedOrder =
        [first.id, second.id].sort()[0] === first.id
          ? [c1.id, c2.id, c3.id]
          : [c3.id, c1.id, c2.id];
      expect(payload.cards.map((c) => c.id)).toEqual(expectedOrder);

      expect(payload.cards.find((c) => c.id === c1.id)).toEqual({
        id: c1.id,
        boardId: board.id,
        listId: first.id,
        title: 'A',
        position: 'a0',
        status: 'open',
        completedAt: null,
        dueAt: '2026-09-20T15:00:00.000Z',
        dueHasTime: true,
        priority: 'high',
        labelIds: [label.id],
        assigneeIds: [member.user.id, admin.user.id],
        checklist: { done: 1, total: 3 },
        commentCount: 2,
        hasDescription: true,
        archivedAt: null,
      });
      expect(payload.cards.find((c) => c.id === c2.id)).toMatchObject({
        checklist: { done: 0, total: 0 },
        commentCount: 0,
        hasDescription: false,
        labelIds: [],
        assigneeIds: [],
      });
    });

    it('quadro arquivado pode ser lido; 404 inexistente; 400 id inválido; 401 sem sessão', async () => {
      const created = await createBoard('Velho');
      await db()
        .update(boards)
        .set({ archivedAt: clock.now() })
        .where(eq(boards.id, created.board.id));
      const archived = await app.inject({
        method: 'GET',
        url: `/api/boards/${created.board.id}`,
        headers: { cookie: member.cookie },
      });
      expect(archived.statusCode).toBe(200);
      expect(boardPayloadSchema.parse(archived.json()).lists).toHaveLength(3);

      expectError(
        await app.inject({
          method: 'GET',
          url: `/api/boards/${MISSING_ID}`,
          headers: { cookie: member.cookie },
        }),
        404,
        'NOT_FOUND',
      );
      expectError(
        await app.inject({
          method: 'GET',
          url: '/api/boards/nao-e-uuid',
          headers: { cookie: member.cookie },
        }),
        400,
        'VALIDATION_ERROR',
      );
      expectError(
        await app.inject({ method: 'GET', url: `/api/boards/${created.board.id}` }),
        401,
        'UNAUTHENTICATED',
      );
    });
  });

  describe('PATCH /api/boards/:boardId', () => {
    it('200 renomeia; 409 BOARD_ARCHIVED; 404; 400; 403 CSRF; 401', async () => {
      const { board } = await createBoard('Antigo');
      clock.advance(60_000);
      const ok = await app.inject({
        method: 'PATCH',
        url: `/api/boards/${board.id}`,
        headers: member.headers,
        payload: { name: ' Novo ' },
      });
      expect(ok.statusCode).toBe(200);
      expect(boardResponseSchema.parse(ok.json()).board).toMatchObject({
        name: 'Novo',
        updatedAt: '2026-09-16T12:01:00.000Z',
      });

      const invalid = await app.inject({
        method: 'PATCH',
        url: `/api/boards/${board.id}`,
        headers: member.headers,
        payload: { name: '' },
      });
      expectError(invalid, 400, 'VALIDATION_ERROR');

      expectError(
        await app.inject({
          method: 'PATCH',
          url: `/api/boards/${MISSING_ID}`,
          headers: member.headers,
          payload: { name: 'X' },
        }),
        404,
        'NOT_FOUND',
      );
      expectError(
        await app.inject({
          method: 'PATCH',
          url: `/api/boards/${board.id}`,
          headers: { cookie: member.cookie },
          payload: { name: 'X' },
        }),
        403,
        'CSRF_REJECTED',
      );
      expectError(
        await app.inject({
          method: 'PATCH',
          url: `/api/boards/${board.id}`,
          headers: csrfHeaders(),
          payload: { name: 'X' },
        }),
        401,
        'UNAUTHENTICATED',
      );

      await app.inject({
        method: 'POST',
        url: `/api/boards/${board.id}/archive`,
        headers: member.headers,
      });
      const archived = await app.inject({
        method: 'PATCH',
        url: `/api/boards/${board.id}`,
        headers: member.headers,
        payload: { name: 'Proibido' },
      });
      expectError(archived, 409, 'BOARD_ARCHIVED');
      const [row] = await db().select().from(boards).where(eq(boards.id, board.id));
      expect(row?.name).toBe('Novo');
    });
  });

  describe('POST /api/boards/:boardId/archive|restore', () => {
    it('arquiva e restaura de forma idempotente', async () => {
      const { board } = await createBoard('Ciclo');
      const archive = () =>
        app.inject({
          method: 'POST',
          url: `/api/boards/${board.id}/archive`,
          headers: member.headers,
        });
      const restore = () =>
        app.inject({
          method: 'POST',
          url: `/api/boards/${board.id}/restore`,
          headers: member.headers,
        });

      const first = await archive();
      expect(first.statusCode).toBe(200);
      expect(boardResponseSchema.parse(first.json()).board.archivedAt).toBe(
        '2026-09-16T12:00:00.000Z',
      );
      clock.advance(5_000);
      const again = await archive();
      expect(boardResponseSchema.parse(again.json()).board.archivedAt).toBe(
        '2026-09-16T12:00:00.000Z',
      );

      const restored = await restore();
      expect(restored.statusCode).toBe(200);
      expect(boardResponseSchema.parse(restored.json()).board.archivedAt).toBeNull();
      expect((await restore()).statusCode).toBe(200);
    });

    it('404, 400, 403 CSRF e 401', async () => {
      for (const action of ['archive', 'restore']) {
        expectError(
          await app.inject({
            method: 'POST',
            url: `/api/boards/${MISSING_ID}/${action}`,
            headers: member.headers,
          }),
          404,
          'NOT_FOUND',
        );
        expectError(
          await app.inject({
            method: 'POST',
            url: `/api/boards/x/${action}`,
            headers: member.headers,
          }),
          400,
          'VALIDATION_ERROR',
        );
        expectError(
          await app.inject({
            method: 'POST',
            url: `/api/boards/${MISSING_ID}/${action}`,
            headers: { cookie: member.cookie },
          }),
          403,
          'CSRF_REJECTED',
        );
        expectError(
          await app.inject({
            method: 'POST',
            url: `/api/boards/${MISSING_ID}/${action}`,
            headers: csrfHeaders(),
          }),
          401,
          'UNAUTHENTICATED',
        );
      }
    });
  });

  describe('DELETE /api/boards/:boardId', () => {
    it('Admin com o nome certo → 204 e cascata; Member → 403; nome errado → 400', async () => {
      const { board, lists: boardLists } = await createBoard('Excluir');
      const todo = boardLists[0];
      if (!todo) throw new Error('sem lista');
      await insertCard(db(), todo, member.user.id);

      const asMember = await app.inject({
        method: 'DELETE',
        url: `/api/boards/${board.id}`,
        headers: member.headers,
        payload: { confirmName: 'Excluir' },
      });
      expectError(asMember, 403, 'FORBIDDEN');

      const wrongName = await app.inject({
        method: 'DELETE',
        url: `/api/boards/${board.id}`,
        headers: admin.headers,
        payload: { confirmName: 'excluir' },
      });
      expectError(wrongName, 400, 'CONFIRMATION_MISMATCH');

      const missingBody = await app.inject({
        method: 'DELETE',
        url: `/api/boards/${board.id}`,
        headers: admin.headers,
        payload: {},
      });
      expectError(missingBody, 400, 'VALIDATION_ERROR');
      expect(await db().$count(boards)).toBe(1);

      const ok = await app.inject({
        method: 'DELETE',
        url: `/api/boards/${board.id}`,
        headers: admin.headers,
        payload: { confirmName: '  Excluir ' },
      });
      expect(ok.statusCode).toBe(204);
      expect(ok.body).toBe('');
      expect(await db().$count(boards)).toBe(0);
      expect(await db().$count(lists)).toBe(0);
      expect(await db().$count(cards)).toBe(0);
    });

    it('quadro arquivado também pode ser excluído; 404; 403 CSRF; 401', async () => {
      const { board } = await createBoard('Arquivado');
      await app.inject({
        method: 'POST',
        url: `/api/boards/${board.id}/archive`,
        headers: member.headers,
      });
      const ok = await app.inject({
        method: 'DELETE',
        url: `/api/boards/${board.id}`,
        headers: admin.headers,
        payload: { confirmName: 'Arquivado' },
      });
      expect(ok.statusCode).toBe(204);

      expectError(
        await app.inject({
          method: 'DELETE',
          url: `/api/boards/${MISSING_ID}`,
          headers: member.headers,
          payload: { confirmName: 'X' },
        }),
        404,
        'NOT_FOUND',
      );
      expectError(
        await app.inject({
          method: 'DELETE',
          url: `/api/boards/${MISSING_ID}`,
          headers: { cookie: admin.cookie },
          payload: { confirmName: 'X' },
        }),
        403,
        'CSRF_REJECTED',
      );
      expectError(
        await app.inject({
          method: 'DELETE',
          url: `/api/boards/${MISSING_ID}`,
          headers: csrfHeaders(),
          payload: { confirmName: 'X' },
        }),
        401,
        'UNAUTHENTICATED',
      );
    });
  });

  describe('GET /api/boards/:boardId/archived', () => {
    it('listas arquivadas e cards arquivados individualmente, por archivedAt desc', async () => {
      const board = await insertBoard(db(), admin.user.id);
      const active = await insertList(db(), board.id, { name: 'Ativa', position: 'a0' });
      const oldArchived = await insertList(db(), board.id, {
        name: 'Arquivada antes',
        position: 'a1',
        archivedAt: new Date('2026-09-10T00:00:00Z'),
      });
      const newArchived = await insertList(db(), board.id, {
        name: 'Arquivada depois',
        position: 'a2',
        archivedAt: new Date('2026-09-12T00:00:00Z'),
      });
      const cardA = await insertCard(db(), active, admin.user.id, {
        title: 'Card arquivado',
        archivedAt: new Date('2026-09-11T00:00:00Z'),
      });
      const cardB = await insertCard(db(), oldArchived, admin.user.id, {
        title: 'Card arquivado em lista arquivada',
        archivedAt: new Date('2026-09-13T00:00:00Z'),
      });
      await insertCard(db(), newArchived, admin.user.id, { title: 'Só a lista arquivada' });

      const res = await app.inject({
        method: 'GET',
        url: `/api/boards/${board.id}/archived`,
        headers: { cookie: member.cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = boardArchivedResponseSchema.strict().parse(res.json());
      expect(body.lists.map((l) => l.id)).toEqual([newArchived.id, oldArchived.id]);
      expect(body.cards.map((c) => [c.id, c.listName, c.listArchived])).toEqual([
        [cardB.id, 'Arquivada antes', true],
        [cardA.id, 'Ativa', false],
      ]);

      expectError(
        await app.inject({
          method: 'GET',
          url: `/api/boards/${MISSING_ID}/archived`,
          headers: { cookie: member.cookie },
        }),
        404,
        'NOT_FOUND',
      );
      expectError(
        await app.inject({ method: 'GET', url: `/api/boards/${board.id}/archived` }),
        401,
        'UNAUTHENTICATED',
      );
    });
  });
});
