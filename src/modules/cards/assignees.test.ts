import {
  activitiesResponseSchema,
  boardPayloadSchema,
  cardAssigneesResponseSchema,
  cardDetailResponseSchema,
  cardSummaryResponseSchema,
  createBoardResponseSchema,
  labelResponseSchema,
  type List,
} from '@raphasparda/ronin-shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectError, MISSING_ID, seedActor, seedTeam, type Actor } from '../../../test/actors';
import { cardActor, unlockedCard } from '../../../test/cards';
import { csrfHeaders } from '../../../test/app';
import { createDbTestApp, createTestClock } from '../../../test/auth';
import { describeDb, useTestDatabase } from '../../../test/db';
import type { App } from '../../app';
import * as schema from '../../db/schema';
import { boards, cardActivities, cardAssignees, cards, users } from '../../db/schema';
import { getBoardPayload } from '../boards/service';
import { onAssigned } from '../notifications/hooks';

vi.mock('../notifications/hooks', () => ({
  onAssigned: vi.fn(() => Promise.resolve()),
  onCommented: vi.fn(() => Promise.resolve()),
}));

describeDb('responsáveis e prioridade do card (kanban_test)', () => {
  const { db, pool } = useTestDatabase();
  const clock = createTestClock();
  let app: App;
  let admin: Actor;
  let member: Actor;

  beforeEach(async () => {
    vi.mocked(onAssigned).mockClear();
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
    const [todo] = body.lists;
    if (!todo) throw new Error('listas padrão ausentes');
    return { board: body.board, todo };
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

  const assign = (
    cardId: string,
    userId: string,
    method: 'PUT' | 'DELETE' = 'PUT',
    headers = member.headers,
  ) => app.inject({ method, url: `/api/cards/${cardId}/assignees/${userId}`, headers });

  const assigneeIds = (res: Awaited<ReturnType<typeof assign>>) => {
    expect(res.statusCode).toBe(200);
    return cardAssigneesResponseSchema.strict().parse(res.json()).assigneeIds;
  };

  const activities = async (cardId: string) => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/cards/${cardId}/activity`,
      headers: { cookie: member.cookie },
    });
    return activitiesResponseSchema.parse(res.json()).activities.map((a) => [a.type, a.data]);
  };

  const archiveBoard = (boardId: string) =>
    db().update(boards).set({ archivedAt: clock.now() }).where(eq(boards.id, boardId));

  describe('PUT/DELETE /api/cards/:cardId/assignees/:userId', () => {
    it('atribui em ordem de atribuição, registra card_assignee_added, chama onAssigned e reflete no detalhe e no payload', async () => {
      const { board, todo } = await newBoard();
      const created = await card(todo);

      expect(assigneeIds(await assign(created.id, admin.user.id))).toEqual([admin.user.id]);
      clock.advance(1_000);
      expect(assigneeIds(await assign(created.id, member.user.id))).toEqual([
        admin.user.id,
        member.user.id,
      ]);

      expect(await activities(created.id)).toEqual([
        ['card_assignee_added', { userId: member.user.id }],
        ['card_assignee_added', { userId: admin.user.id }],
        ['card_created', { listId: todo.id, listName: 'A fazer' }],
      ]);
      expect(vi.mocked(onAssigned).mock.calls.map(([, event]) => event)).toEqual([
        {
          cardId: created.id,
          userId: admin.user.id,
          actorId: member.user.id,
          now: new Date('2026-09-16T12:00:00.000Z'),
        },
        {
          cardId: created.id,
          userId: member.user.id,
          actorId: member.user.id,
          now: new Date('2026-09-16T12:00:01.000Z'),
        },
      ]);

      const [row] = await db()
        .select()
        .from(cardAssignees)
        .where(eq(cardAssignees.userId, admin.user.id));
      expect(row).toMatchObject({ cardId: created.id, assignedBy: member.user.id });

      const detail = await app.inject({
        method: 'GET',
        url: `/api/cards/${created.id}`,
        headers: { cookie: member.cookie },
      });
      expect(cardDetailResponseSchema.parse(detail.json()).card.assigneeIds).toEqual([
        admin.user.id,
        member.user.id,
      ]);
      const payload = await app.inject({
        method: 'GET',
        url: `/api/boards/${board.id}`,
        headers: { cookie: member.cookie },
      });
      expect(unlockedCard(boardPayloadSchema.parse(payload.json()).cards[0]).assigneeIds).toEqual([
        admin.user.id,
        member.user.id,
      ]);
    });

    it('idempotente: repetir PUT/DELETE não duplica atividade nem chama o gancho de novo', async () => {
      const { todo } = await newBoard();
      const created = await card(todo);

      await assign(created.id, admin.user.id);
      expect(assigneeIds(await assign(created.id, admin.user.id))).toEqual([admin.user.id]);
      expect(vi.mocked(onAssigned)).toHaveBeenCalledTimes(1);

      expect(assigneeIds(await assign(created.id, admin.user.id, 'DELETE'))).toEqual([]);
      expect(assigneeIds(await assign(created.id, admin.user.id, 'DELETE'))).toEqual([]);
      expect(await activities(created.id)).toEqual([
        ['card_assignee_removed', { userId: admin.user.id }],
        ['card_assignee_added', { userId: admin.user.id }],
        ['card_created', { listId: todo.id, listName: 'A fazer' }],
      ]);
    });

    it('10 PUTs concorrentes do mesmo usuário geram uma atribuição e uma atividade', async () => {
      const { todo } = await newBoard();
      const created = await card(todo);
      const results = await Promise.all(
        Array.from({ length: 10 }, () => assign(created.id, admin.user.id)),
      );
      expect(results.map((r) => r.statusCode)).toEqual(Array(10).fill(200));
      expect(await db().$count(cardAssignees)).toBe(1);
      expect(
        await db().$count(cardActivities, eq(cardActivities.type, 'card_assignee_added')),
      ).toBe(1);
      expect(vi.mocked(onAssigned)).toHaveBeenCalledTimes(1);
    });

    it('409 USER_NOT_ACTIVE para desativado e anonimizado; já atribuído continua 200; DELETE remove desativado', async () => {
      const { todo } = await newBoard();
      const created = await card(todo);
      const later = await seedActor(db(), { role: 'member' }, clock.now());
      await assign(created.id, later.user.id);

      const inactive = await seedActor(db(), { status: 'deactivated' }, clock.now());
      const anonymized = await seedActor(db(), { status: 'deactivated' }, clock.now());
      await db()
        .update(users)
        .set({
          anonymizedAt: clock.now(),
          email: null,
          passwordHash: null,
          name: 'Usuário removido',
        })
        .where(eq(users.id, anonymized.user.id));
      expectError(await assign(created.id, inactive.user.id), 409, 'USER_NOT_ACTIVE');
      expectError(await assign(created.id, anonymized.user.id), 409, 'USER_NOT_ACTIVE');

      await db().update(users).set({ status: 'deactivated' }).where(eq(users.id, later.user.id));
      expect(assigneeIds(await assign(created.id, later.user.id))).toEqual([later.user.id]);
      expect(assigneeIds(await assign(created.id, later.user.id, 'DELETE'))).toEqual([]);
      expect((await activities(created.id)).map(([type]) => type)).toEqual([
        'card_assignee_removed',
        'card_assignee_added',
        'card_created',
      ]);
    });

    it('card arquivado aceita; quadro arquivado → 409 BOARD_ARCHIVED (PUT e DELETE)', async () => {
      const { board, todo } = await newBoard();
      const created = await card(todo);
      await db().update(cards).set({ archivedAt: clock.now() }).where(eq(cards.id, created.id));
      expect(assigneeIds(await assign(created.id, admin.user.id))).toEqual([admin.user.id]);

      await archiveBoard(board.id);
      expectError(await assign(created.id, member.user.id), 409, 'BOARD_ARCHIVED');
      expectError(await assign(created.id, admin.user.id, 'DELETE'), 409, 'BOARD_ARCHIVED');
      expect(await db().$count(cardAssignees)).toBe(1);
    });

    it('400 (ids inválidos), 404 (card, usuário), 403 CSRF, 401', async () => {
      const { todo } = await newBoard();
      const created = await card(todo);
      for (const method of ['PUT', 'DELETE'] as const) {
        expectError(await assign('x', admin.user.id, method), 400, 'VALIDATION_ERROR');
        expectError(await assign(created.id, 'y', method), 400, 'VALIDATION_ERROR');
        expectError(await assign(MISSING_ID, admin.user.id, method), 404, 'NOT_FOUND');
        expectError(await assign(created.id, MISSING_ID, method), 404, 'NOT_FOUND');
        expectError(
          await assign(created.id, admin.user.id, method, { cookie: member.cookie }),
          403,
          'CSRF_REJECTED',
        );
        expectError(
          await assign(created.id, admin.user.id, method, csrfHeaders()),
          401,
          'UNAUTHENTICATED',
        );
      }
      expect(await db().$count(cardAssignees)).toBe(0);
    });
  });

  describe('prioridade no PATCH /api/cards/:cardId', () => {
    it('mudar prioridade não altera position nem a ordem e gera card_priority_changed', async () => {
      const { board, todo } = await newBoard();
      const first = await card(todo, 'A');
      const second = await card(todo, 'B');

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/cards/${second.id}`,
        headers: member.headers,
        payload: { priority: 'urgent' },
      });
      expect(res.statusCode).toBe(200);
      const updated = cardDetailResponseSchema.parse(res.json()).card;
      expect(updated).toMatchObject({ priority: 'urgent', position: second.position });

      const payload = await getBoardPayload(db(), board.id, cardActor(member));
      expect(payload.cards.map((c) => c.id)).toEqual([first.id, second.id]);
      expect(await activities(second.id)).toEqual([
        ['card_priority_changed', { from: null, to: 'urgent' }],
        ['card_created', { listId: todo.id, listName: 'A fazer' }],
      ]);
    });
  });

  describe('payload do quadro', () => {
    it('número de consultas não cresce com cards, etiquetas e responsáveis (sem N+1)', async () => {
      const { board, todo } = await newBoard();

      const countQueries = async () => {
        const logged: string[] = [];
        const counting = drizzle({
          client: pool(),
          schema,
          logger: { logQuery: (query) => logged.push(query) },
        });
        await getBoardPayload(counting, board.id, cardActor(member));
        // Descarta o controle de transação (`begin ...`/`commit`).
        return logged.filter((query) => !/^(begin|commit|rollback)\b/i.test(query.trim()));
      };

      const created = await card(todo);
      const small = await countQueries();

      const label = await app.inject({
        method: 'POST',
        url: `/api/boards/${board.id}/labels`,
        headers: member.headers,
        payload: { name: 'Bug', color: 'red' },
      });
      const labelId = labelResponseSchema.parse(label.json()).label.id;
      for (let i = 0; i < 20; i++) {
        const extra = await card(todo, `Card ${i}`);
        await assign(extra.id, admin.user.id);
        await assign(extra.id, member.user.id);
        await app.inject({
          method: 'PUT',
          url: `/api/cards/${extra.id}/labels/${labelId}`,
          headers: member.headers,
        });
      }
      await assign(created.id, admin.user.id);
      const large = await countQueries();

      // quadro, listas, cards (com agregados), card_labels, card_assignees, labels.
      expect(large).toHaveLength(6);
      expect(small).toHaveLength(6);
    });
  });
});
