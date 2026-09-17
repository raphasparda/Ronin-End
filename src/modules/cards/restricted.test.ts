import {
  boardArchivedResponseSchema,
  boardPayloadSchema,
  cardSummaryResponseSchema,
  createBoardResponseSchema,
  labelResponseSchema,
  myCardsResponseSchema,
  notificationsResponseSchema,
  unreadCountResponseSchema,
  updateListResponseSchema,
  type List,
} from '@raphasparda/ronin-shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { expectError, seedActor, seedTeam, type Actor } from '../../../test/actors';
import { cardActor, noCovers, unlockedCard } from '../../../test/cards';
import { createDbTestApp, createTestClock } from '../../../test/auth';
import { describeDb, useTestDatabase } from '../../../test/db';
import type { App } from '../../app';
import * as schema from '../../db/schema';
import { cardAssignees, cards, cardViewers, notifications } from '../../db/schema';
import { getBoardPayload } from '../boards/service';

/**
 * Tarefa 11.3: matriz de acesso (ator × visibilidade × viewer × rota) e testes de vazamento do
 * payload bloqueado (ADR 0015). As rotas que **mudam** a restrição entram na tarefa 11.4: aqui o
 * card é restringido direto no banco.
 */
describeDb('cards restritos: acesso e payload bloqueado (kanban_test)', () => {
  const { db, pool } = useTestDatabase();
  const clock = createTestClock();
  let app: App;
  let admin: Actor;
  /** Membro com acesso ao card restrito (está na lista). */
  let insider: Actor;
  /** Membro sem acesso: é para ele que o card aparece bloqueado. */
  let outsider: Actor;

  beforeEach(async () => {
    clock.set(new Date('2026-09-16T12:00:00.000Z'));
    app = await createDbTestApp({ clock: clock.now });
    ({ admin, member: insider } = await seedTeam(db(), clock.now()));
    outsider = await seedActor(db(), { role: 'member', name: 'Caio Membro' }, clock.now());
  });

  afterEach(async () => {
    await app.close();
  });

  async function newBoard(name = 'Quadro') {
    const res = await app.inject({
      method: 'POST',
      url: '/api/boards',
      headers: insider.headers,
      payload: { name },
    });
    const body = createBoardResponseSchema.parse(res.json());
    const [todo, doing, done] = body.lists;
    if (!todo || !doing || !done) throw new Error('listas padrão ausentes');
    return { board: body.board, todo, doing, done };
  }

  async function newCard(list: Pick<List, 'id'>, title = 'Assunto sensível') {
    const res = await app.inject({
      method: 'POST',
      url: `/api/lists/${list.id}/cards`,
      headers: insider.headers,
      payload: { title },
    });
    expect(res.statusCode).toBe(201);
    return cardSummaryResponseSchema.parse(res.json()).card;
  }

  /** Restringe o card e põe `insider` na lista de acesso (o que a rota de 11.4 fará). */
  async function restrict(cardId: string, viewers: Actor[] = [insider]) {
    await db().update(cards).set({ visibility: 'restricted' }).where(eq(cards.id, cardId));
    for (const viewer of viewers) {
      await db()
        .insert(cardViewers)
        .values({
          cardId,
          userId: viewer.user.id,
          addedBy: insider.user.id,
          createdAt: clock.now(),
        })
        .onConflictDoNothing();
    }
  }

  async function restrictedBoard() {
    const { board, todo, doing } = await newBoard();
    const open = await newCard(todo, 'Card da equipe');
    const secret = await newCard(todo, 'Proposta comercial');
    await restrict(secret.id);
    return { board, todo, doing, open, secret };
  }

  const payloadFor = async (boardId: string, actor: Actor) => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/boards/${boardId}`,
      headers: { cookie: actor.cookie },
    });
    expect(res.statusCode).toBe(200);
    return boardPayloadSchema.strict().parse(res.json());
  };

  describe('matriz ator × visibilidade × viewer × rota', () => {
    it('card team: todo usuário ativo continua lendo e editando (RN05)', async () => {
      const { board, todo } = await newBoard();
      const card = await newCard(todo, 'Card da equipe');
      for (const actor of [insider, outsider, admin]) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/cards/${card.id}`,
          headers: { cookie: actor.cookie },
        });
        expect(res.statusCode).toBe(200);
      }
      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/cards/${card.id}`,
        headers: outsider.headers,
        payload: { title: 'Editado por quem não é viewer' },
      });
      expect(patched.statusCode).toBe(200);
      expect((await payloadFor(board.id, outsider)).cards).toHaveLength(1);
    });

    it('card restrito: sem acesso → 403 CARD_RESTRICTED em toda rota do card', async () => {
      const { doing, secret } = await restrictedBoard();
      const label = labelResponseSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: `/api/boards/${secret.boardId}/labels`,
            headers: insider.headers,
            payload: { name: 'Bug', color: 'red' },
          })
        ).json(),
      ).label;

      const requests: {
        name: string;
        method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
        url: string;
        payload?: object;
      }[] = [
        { name: 'ler', method: 'GET', url: `/api/cards/${secret.id}` },
        { name: 'histórico', method: 'GET', url: `/api/cards/${secret.id}/activity` },
        {
          name: 'editar',
          method: 'PATCH',
          url: `/api/cards/${secret.id}`,
          payload: { title: 'Bisbilhotando' },
        },
        {
          name: 'mover',
          method: 'POST',
          url: `/api/cards/${secret.id}/move`,
          payload: { toListId: doing.id, placement: { type: 'end' } },
        },
        { name: 'concluir', method: 'POST', url: `/api/cards/${secret.id}/complete` },
        { name: 'reabrir', method: 'POST', url: `/api/cards/${secret.id}/reopen` },
        { name: 'arquivar', method: 'POST', url: `/api/cards/${secret.id}/archive` },
        { name: 'restaurar', method: 'POST', url: `/api/cards/${secret.id}/restore` },
        {
          name: 'comentar',
          method: 'POST',
          url: `/api/cards/${secret.id}/comments`,
          payload: { body: 'oi' },
        },
        {
          name: 'checklist',
          method: 'POST',
          url: `/api/cards/${secret.id}/checklists`,
          payload: { title: 'Checklist' },
        },
        { name: 'etiqueta', method: 'PUT', url: `/api/cards/${secret.id}/labels/${label.id}` },
        {
          name: 'tirar etiqueta',
          method: 'DELETE',
          url: `/api/cards/${secret.id}/labels/${label.id}`,
        },
        {
          name: 'responsável',
          method: 'PUT',
          url: `/api/cards/${secret.id}/assignees/${outsider.user.id}`,
        },
        {
          name: 'tirar responsável',
          method: 'DELETE',
          url: `/api/cards/${secret.id}/assignees/${outsider.user.id}`,
        },
        { name: 'excluir (Admin)', method: 'DELETE', url: `/api/cards/${secret.id}` },
      ];

      for (const request of requests) {
        const res = await app.inject({
          method: request.method,
          url: request.url,
          headers: outsider.headers,
          ...(request.payload ? { payload: request.payload } : {}),
        });
        expectError(res, 403, 'CARD_RESTRICTED');
        expect({ rota: request.name, body: res.body }).toMatchObject({ rota: request.name });
        expect(res.body).not.toContain('Proposta comercial');
      }
    });

    it('card restrito: viewer e Admin seguem fazendo tudo', async () => {
      const { doing, secret } = await restrictedBoard();
      for (const actor of [insider, admin]) {
        const read = await app.inject({
          method: 'GET',
          url: `/api/cards/${secret.id}`,
          headers: { cookie: actor.cookie },
        });
        expect(read.statusCode).toBe(200);
        const patched = await app.inject({
          method: 'PATCH',
          url: `/api/cards/${secret.id}`,
          headers: actor.headers,
          payload: { description: `visto por ${actor.user.name}` },
        });
        expect(patched.statusCode).toBe(200);
      }
      const moved = await app.inject({
        method: 'POST',
        url: `/api/cards/${secret.id}/move`,
        headers: admin.headers,
        payload: { toListId: doing.id, placement: { type: 'end' } },
      });
      expect(moved.statusCode).toBe(200);
    });

    it('403 CARD_RESTRICTED vem antes do 403 FORBIDDEN de papel e de 409 de estado', async () => {
      const { board, secret } = await restrictedBoard();
      // Membro sem acesso tentando excluir (rota de Admin): o acesso ao card decide primeiro.
      expectError(
        await app.inject({
          method: 'DELETE',
          url: `/api/cards/${secret.id}`,
          headers: outsider.headers,
        }),
        403,
        'CARD_RESTRICTED',
      );
      // Quadro arquivado (409 BOARD_ARCHIVED) não muda a ordem.
      await app.inject({
        method: 'POST',
        url: `/api/boards/${board.id}/archive`,
        headers: admin.headers,
      });
      expectError(
        await app.inject({
          method: 'PATCH',
          url: `/api/cards/${secret.id}`,
          headers: outsider.headers,
          payload: { title: 'x' },
        }),
        403,
        'CARD_RESTRICTED',
      );
    });

    it('card inexistente continua 404 (o 404 vem antes do acesso)', async () => {
      expectError(
        await app.inject({
          method: 'GET',
          url: '/api/cards/00000000-0000-4000-8000-000000000000',
          headers: { cookie: outsider.cookie },
        }),
        404,
        'NOT_FOUND',
      );
    });
  });

  describe('payload bloqueado (vazamento)', () => {
    it('quadro: card bloqueado tem exatamente id, listId, position, title e locked', async () => {
      const { board, todo, open, secret } = await restrictedBoard();
      // Enche o card restrito de conteúdo para provar que nada disso sai.
      await app.inject({
        method: 'PATCH',
        url: `/api/cards/${secret.id}`,
        headers: insider.headers,
        payload: {
          description: 'segredo',
          due: { date: '2026-09-30', time: '10:00' },
          priority: 'urgent',
        },
      });
      await app.inject({
        method: 'POST',
        url: `/api/cards/${secret.id}/comments`,
        headers: insider.headers,
        payload: { body: 'combinado' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/cards/${secret.id}/checklists`,
        headers: insider.headers,
        payload: { title: 'Checklist' },
      });
      await app.inject({
        method: 'PUT',
        url: `/api/cards/${secret.id}/assignees/${insider.user.id}`,
        headers: insider.headers,
      });

      const seen = await payloadFor(board.id, outsider);
      const locked = seen.cards.find((card) => card.id === secret.id);
      expect(locked).toEqual({
        id: secret.id,
        listId: todo.id,
        position: secret.position,
        title: 'Proposta comercial',
        locked: true,
      });
      expect(Object.keys(locked ?? {}).sort()).toEqual([
        'id',
        'listId',
        'locked',
        'position',
        'title',
      ]);
      expect(JSON.stringify(seen)).not.toContain('segredo');
      expect(JSON.stringify(seen)).not.toContain('urgent');

      // O card da equipe continua inteiro, e quem tem acesso vê o restrito inteiro.
      expect(unlockedCard(seen.cards.find((card) => card.id === open.id)).locked).toBe(false);
      const full = await payloadFor(board.id, insider);
      const visible = unlockedCard(full.cards.find((card) => card.id === secret.id));
      expect(visible).toMatchObject({
        visibility: 'restricted',
        priority: 'urgent',
        commentCount: 1,
        hasDescription: true,
        assigneeIds: [insider.user.id],
      });
      const asAdmin = await payloadFor(board.id, admin);
      expect(unlockedCard(asAdmin.cards.find((card) => card.id === secret.id)).locked).toBe(false);
    });

    it('arquivados: card bloqueado vai sem a lista de origem', async () => {
      const { board, secret } = await restrictedBoard();
      await app.inject({
        method: 'POST',
        url: `/api/cards/${secret.id}/archive`,
        headers: insider.headers,
      });
      const res = await app.inject({
        method: 'GET',
        url: `/api/boards/${board.id}/archived`,
        headers: { cookie: outsider.cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = boardArchivedResponseSchema.strict().parse(res.json());
      expect(body.cards).toEqual([
        {
          id: secret.id,
          listId: secret.listId,
          position: secret.position,
          title: 'Proposta comercial',
          locked: true,
        },
      ]);

      const asViewer = boardArchivedResponseSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/api/boards/${board.id}/archived`,
            headers: { cookie: insider.cookie },
          })
        ).json(),
      );
      expect(unlockedCard(asViewer.cards[0])).toMatchObject({ listName: 'A fazer' });
    });

    it('payload do quadro continua em 6 consultas com card restrito', async () => {
      const { board, todo } = await newBoard();
      const countQueries = async (actor: Actor) => {
        const logged: string[] = [];
        const counting = drizzle({
          client: pool(),
          schema,
          logger: { logQuery: (query) => logged.push(query) },
        });
        await getBoardPayload(counting, board.id, cardActor(actor), noCovers());
        return logged.filter((query) => !/^(begin|commit|rollback)\b/i.test(query.trim()));
      };

      for (let i = 0; i < 10; i++) {
        const card = await newCard(todo, `Card ${i}`);
        if (i % 2 === 0) await restrict(card.id);
      }
      expect(await countQueries(outsider)).toHaveLength(6);
      expect(await countQueries(insider)).toHaveLength(6);
      expect(await countQueries(admin)).toHaveLength(6);
    });
  });

  describe('meus cards e notificações filtram (não bloqueiam)', () => {
    it('Meus cards não traz card restrito sem acesso', async () => {
      const { todo } = await newBoard();
      const card = await newCard(todo, 'Trabalho sensível');
      // Responsável sem acesso só existe por caminho de banco (a API garante RN32).
      await db().insert(cardAssignees).values({
        cardId: card.id,
        userId: outsider.user.id,
        assignedBy: insider.user.id,
        createdAt: clock.now(),
      });
      const mine = async (actor: Actor) =>
        myCardsResponseSchema.parse(
          (
            await app.inject({
              method: 'GET',
              url: '/api/me/cards',
              headers: { cookie: actor.cookie },
            })
          ).json(),
        ).cards;
      expect((await mine(outsider)).map((c) => c.id)).toEqual([card.id]);

      await restrict(card.id);
      expect(await mine(outsider)).toEqual([]);
    });

    it('notificação de card sem acesso some da lista e do contador; volta com o acesso', async () => {
      const { todo } = await newBoard();
      const card = await newCard(todo, 'Aviso sensível');
      await db().insert(notifications).values({
        userId: outsider.user.id,
        type: 'card_assigned',
        cardId: card.id,
        actorId: insider.user.id,
        createdAt: clock.now(),
      });

      const list = async () =>
        notificationsResponseSchema.parse(
          (
            await app.inject({
              method: 'GET',
              url: '/api/notifications',
              headers: { cookie: outsider.cookie },
            })
          ).json(),
        );
      const counter = async () =>
        unreadCountResponseSchema.parse(
          (
            await app.inject({
              method: 'GET',
              url: '/api/notifications/unread-count',
              headers: { cookie: outsider.cookie },
            })
          ).json(),
        ).unreadCount;

      expect((await list()).notifications).toHaveLength(1);
      expect(await counter()).toBe(1);

      await restrict(card.id);
      expect((await list()).notifications).toEqual([]);
      expect((await list()).unreadCount).toBe(0);
      expect(await counter()).toBe(0);
      // A linha continua no banco (RN40: filtro na leitura, não exclusão).
      expect(await db().$count(notifications)).toBe(1);

      await db().insert(cardViewers).values({
        cardId: card.id,
        userId: outsider.user.id,
        addedBy: insider.user.id,
        createdAt: clock.now(),
      });
      expect((await list()).notifications).toHaveLength(1);
      expect(await counter()).toBe(1);
    });
  });

  describe('ações de contêiner (RN36)', () => {
    it('marcar lista de conclusão conclui também o card restrito invisível ao ator', async () => {
      const { doing, secret } = await restrictedBoard();
      await app.inject({
        method: 'POST',
        url: `/api/cards/${secret.id}/move`,
        headers: insider.headers,
        payload: { toListId: doing.id, placement: { type: 'end' } },
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/lists/${doing.id}`,
        headers: outsider.headers,
        payload: { isDoneList: true },
      });
      expect(res.statusCode).toBe(200);
      expect(updateListResponseSchema.parse(res.json()).completedCardIds).toContain(secret.id);
      const [row] = await db().select().from(cards).where(eq(cards.id, secret.id));
      expect(row?.status).toBe('completed');
    });
  });
});
