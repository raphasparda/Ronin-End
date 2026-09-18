import {
  commentResponseSchema,
  createBoardResponseSchema,
  cardSummaryResponseSchema,
  notificationsResponseSchema,
  unreadCountResponseSchema,
  type List,
} from '@raphasparda/ronin-shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { expectError, MISSING_ID, seedActor, seedTeam, type Actor } from '../../../../test/actors';
import { csrfHeaders } from '../../../../test/app';
import { createDbTestApp, createTestClock } from '../../../../test/auth';
import { describeDb, pgError, useTestDatabase } from '../../../../test/db';
import type { App } from '../../../app';
import { notifications, users } from '../../../db/schema';

describeDb('notificações (ronin_test)', () => {
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

  async function newCard(title = 'Card', actor = member) {
    const boardRes = await app.inject({
      method: 'POST',
      url: '/api/boards',
      headers: actor.headers,
      payload: { name: 'Quadro' },
    });
    const { board, lists } = createBoardResponseSchema.parse(boardRes.json());
    const [todo] = lists as [List];
    const res = await app.inject({
      method: 'POST',
      url: `/api/lists/${todo.id}/cards`,
      headers: actor.headers,
      payload: { title },
    });
    return { board, card: cardSummaryResponseSchema.parse(res.json()).card };
  }

  const assign = async (cardId: string, userId: string, actor: Actor) => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/cards/${cardId}/assignees/${userId}`,
      headers: actor.headers,
    });
    expect(res.statusCode).toBe(200);
  };

  const comment = async (cardId: string, body: string, actor: Actor) => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/cards/${cardId}/comments`,
      headers: actor.headers,
      payload: { body },
    });
    expect(res.statusCode).toBe(201);
    return commentResponseSchema.parse(res.json()).comment;
  };

  const listRes = (actor: Actor, query = '') =>
    app.inject({
      method: 'GET',
      url: `/api/notifications${query}`,
      headers: { cookie: actor.cookie },
    });

  const list = async (actor: Actor, query = '') => {
    const res = await listRes(actor, query);
    expect(res.statusCode).toBe(200);
    return notificationsResponseSchema.strict().parse(res.json());
  };

  const unread = async (actor: Actor) => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/notifications/unread-count',
      headers: { cookie: actor.cookie },
    });
    expect(res.statusCode).toBe(200);
    return unreadCountResponseSchema.strict().parse(res.json()).unreadCount;
  };

  const readOne = (id: string, actor: Actor, headers: Record<string, string> = actor.headers) =>
    app.inject({ method: 'POST', url: `/api/notifications/${id}/read`, headers });

  const readAll = (actor: Actor, headers: Record<string, string> = actor.headers) =>
    app.inject({ method: 'POST', url: '/api/notifications/read-all', headers });

  describe('ganchos', () => {
    it('atribuir outra pessoa notifica (card e quadro atuais); atribuir a si mesmo não; repetir não duplica', async () => {
      const { board, card } = await newCard('Relatório');
      await assign(card.id, member.user.id, member); // a si mesmo (RN18)
      await assign(card.id, admin.user.id, member);
      await assign(card.id, admin.user.id, member); // idempotente

      expect((await list(member)).notifications).toEqual([]);
      const body = await list(admin);
      expect(body).toEqual({
        notifications: [
          {
            id: body.notifications[0]?.id,
            type: 'card_assigned',
            actorId: member.user.id,
            card: { id: card.id, title: 'Relatório', boardId: board.id, boardName: 'Quadro' },
            commentId: null,
            readAt: null,
            createdAt: '2026-09-16T12:00:00.000Z',
          },
        ],
        unreadCount: 1,
        nextBefore: null,
      });
      expect(await db().$count(notifications)).toBe(1);
    });

    it('comentar notifica os responsáveis ativos menos o autor; criador não responsável não recebe; desativado e anonimizado não recebem', async () => {
      const carla = await seedActor(db(), { role: 'member', name: 'Carla' }, clock.now());
      const davi = await seedActor(db(), { role: 'member', name: 'Davi' }, clock.now());
      const eva = await seedActor(db(), { role: 'member', name: 'Eva' }, clock.now());
      // Criador: admin (não responsável).
      const { card } = await newCard('Card', admin);
      for (const person of [member, carla, davi, eva]) {
        await assign(card.id, person.user.id, carla);
      }
      await db().delete(notifications);

      await db().update(users).set({ status: 'deactivated' }).where(eq(users.id, davi.user.id));
      await db()
        .update(users)
        .set({
          status: 'deactivated',
          anonymizedAt: clock.now(),
          email: null,
          passwordHash: null,
        })
        .where(eq(users.id, eva.user.id));

      clock.advance(1_000);
      const created = await comment(card.id, 'Olá', member);

      const rows = await db().select().from(notifications);
      expect(rows.map((r) => r.userId)).toEqual([carla.user.id]);
      expect(rows[0]).toMatchObject({
        type: 'card_commented',
        actorId: member.user.id,
        commentId: created.id,
        cardId: card.id,
      });
      expect((await list(admin)).notifications).toEqual([]);
      expect((await list(member)).notifications).toEqual([]);
      expect((await list(carla)).notifications[0]).toMatchObject({
        type: 'card_commented',
        commentId: created.id,
        createdAt: '2026-09-16T12:00:01.000Z',
      });

      // Excluir o comentário mantém a notificação com commentId nulo.
      const del = await app.inject({
        method: 'DELETE',
        url: `/api/comments/${created.id}`,
        headers: member.headers,
      });
      expect(del.statusCode).toBe(204);
      expect((await list(carla)).notifications[0]?.commentId).toBeNull();
    });

    it('o banco recusa autonotificação (CHECK RN18)', async () => {
      const { card } = await newCard();
      const err = await pgError(
        db().insert(notifications).values({
          userId: member.user.id,
          actorId: member.user.id,
          cardId: card.id,
          type: 'card_assigned',
        }),
      );
      expect(err).toMatchObject({ code: '23514', constraint: 'notifications_not_self_check' });
    });

    it('excluir o card apaga as notificações (cascata)', async () => {
      const { card } = await newCard();
      await assign(card.id, admin.user.id, member);
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/cards/${card.id}`,
        headers: admin.headers,
      });
      expect(res.statusCode).toBe(204);
      expect(await unread(admin)).toBe(0);
    });
  });

  describe('GET /api/notifications', () => {
    it('só as próprias, mais recentes primeiro, paginação por `before` sem pular empates na borda', async () => {
      const { card } = await newCard();
      await assign(card.id, admin.user.id, member);
      // 5 comentários: t+1s, t+2s, t+2s (empate), t+2s (empate), t+3s.
      const offsets = [1_000, 2_000, 2_000, 2_000, 3_000];
      for (const offset of offsets) {
        clock.set(new Date(Date.parse('2026-09-16T12:00:00.000Z') + offset));
        await comment(card.id, `c${offset}`, member);
      }
      // Notificação de outra pessoa não aparece.
      const other = await newCard('Outro', admin);
      await assign(other.card.id, member.user.id, admin);

      const all = await list(admin);
      expect(all.notifications).toHaveLength(6);
      expect(all.unreadCount).toBe(6);
      expect(all.nextBefore).toBeNull();
      expect(all.notifications.map((n) => n.createdAt)).toEqual([
        '2026-09-16T12:00:03.000Z',
        '2026-09-16T12:00:02.000Z',
        '2026-09-16T12:00:02.000Z',
        '2026-09-16T12:00:02.000Z',
        '2026-09-16T12:00:01.000Z',
        '2026-09-16T12:00:00.000Z',
      ]);

      // limit=2: a borda cai no meio do empate de t+2s → a página inclui os 3 do instante.
      const first = await list(admin, '?limit=2');
      expect(first.notifications.map((n) => n.createdAt)).toEqual([
        '2026-09-16T12:00:03.000Z',
        '2026-09-16T12:00:02.000Z',
        '2026-09-16T12:00:02.000Z',
        '2026-09-16T12:00:02.000Z',
      ]);
      expect(first.nextBefore).toBe('2026-09-16T12:00:02.000Z');
      const second = await list(admin, `?limit=2&before=${first.nextBefore}`);
      expect(second.notifications.map((n) => n.createdAt)).toEqual([
        '2026-09-16T12:00:01.000Z',
        '2026-09-16T12:00:00.000Z',
      ]);
      expect(second.nextBefore).toBeNull();
      expect(second.unreadCount).toBe(6);

      const ids = [...first.notifications, ...second.notifications].map((n) => n.id);
      expect(new Set(ids).size).toBe(6);
      expect(ids).toEqual(all.notifications.map((n) => n.id));

      // Página exata sem sobra: nextBefore nulo. Página com sobra: nextBefore do último item.
      const exact = await list(admin, `?limit=2&before=2026-09-16T12:00:02.000Z`);
      expect(exact.nextBefore).toBeNull();
      const one = await list(admin, `?limit=1&before=2026-09-16T12:00:02.000Z`);
      expect(one.notifications).toHaveLength(1);
      expect(one.nextBefore).toBe('2026-09-16T12:00:01.000Z');

      // limit=1 com empate logo na primeira linha: a página traz o instante inteiro.
      const tail = await list(admin, `?limit=1&before=2026-09-16T12:00:02.500Z`);
      expect(tail.notifications).toHaveLength(3);
      expect(tail.nextBefore).toBe('2026-09-16T12:00:02.000Z');

      expect((await list(member)).notifications).toHaveLength(1);
    });

    it('400 (limit 0, 101, não inteiro; before inválido), 401', async () => {
      for (const query of ['?limit=0', '?limit=101', '?limit=1.5', '?limit=abc', '?before=ontem']) {
        expectError(await listRes(member, query), 400, 'VALIDATION_ERROR');
      }
      expectError(
        await app.inject({ method: 'GET', url: '/api/notifications' }),
        401,
        'UNAUTHENTICATED',
      );
      expectError(
        await app.inject({ method: 'GET', url: '/api/notifications/unread-count' }),
        401,
        'UNAUTHENTICATED',
      );
    });
  });

  describe('marcar como lida', () => {
    it('ler uma (idempotente, mantém readAt), contador, ler todas; de outro usuário → 404', async () => {
      const { card } = await newCard();
      await assign(card.id, admin.user.id, member);
      clock.advance(1_000);
      await comment(card.id, 'um', member);
      clock.advance(1_000);
      await comment(card.id, 'dois', member);
      const other = await newCard('Outro', admin);
      await assign(other.card.id, member.user.id, admin);

      const mine = await list(admin);
      expect(await unread(admin)).toBe(3);
      const [newest] = mine.notifications;
      if (!newest) throw new Error('sem notificações');

      // De outro usuário: 404 e nada muda.
      expectError(await readOne(newest.id, member), 404, 'NOT_FOUND');
      expectError(await readOne(MISSING_ID, admin), 404, 'NOT_FOUND');
      expect(await unread(admin)).toBe(3);

      clock.advance(60_000);
      expect((await readOne(newest.id, admin)).statusCode).toBe(204);
      clock.advance(60_000);
      expect((await readOne(newest.id, admin)).statusCode).toBe(204);
      const after = await list(admin);
      expect(after.unreadCount).toBe(2);
      expect(after.notifications[0]?.readAt).toBe('2026-09-16T12:01:02.000Z');

      clock.advance(1_000);
      expect((await readAll(admin)).statusCode).toBe(204);
      expect(await unread(admin)).toBe(0);
      const final = await list(admin);
      expect(final.notifications.map((n) => n.readAt)).toEqual([
        '2026-09-16T12:01:02.000Z',
        '2026-09-16T12:02:03.000Z',
        '2026-09-16T12:02:03.000Z',
      ]);
      // Ler todas não toca nas de outra pessoa.
      expect(await unread(member)).toBe(1);
    });

    it('400 (id inválido), 403 CSRF, 401', async () => {
      expectError(await readOne('abc', member), 400, 'VALIDATION_ERROR');
      expectError(
        await readOne(MISSING_ID, member, { cookie: member.cookie }),
        403,
        'CSRF_REJECTED',
      );
      expectError(
        await readOne(MISSING_ID, member, {
          cookie: member.cookie,
          ...csrfHeaders(),
          origin: 'https://malicioso.example',
        }),
        403,
        'CSRF_REJECTED',
      );
      expectError(await readAll(member, { cookie: member.cookie }), 403, 'CSRF_REJECTED');
      expectError(await readOne(MISSING_ID, member, csrfHeaders()), 401, 'UNAUTHENTICATED');
      expectError(await readAll(member, csrfHeaders()), 401, 'UNAUTHENTICATED');
    });
  });
});
