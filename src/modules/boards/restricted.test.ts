import {
  boardArchivedResponseSchema,
  boardPayloadSchema,
  boardsResponseSchema,
  cardSummaryResponseSchema,
  checklistItemResponseSchema,
  checklistResponseSchema,
  commentResponseSchema,
  createBoardResponseSchema,
  labelResponseSchema,
  myCardsResponseSchema,
  notificationsResponseSchema,
  unreadCountResponseSchema,
  updateListResponseSchema,
  type List,
} from '@raphasparda/ronin-shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { boardActor, noCovers } from '../../../test/actor-context';
import { expectError, seedActor, seedTeam, type Actor } from '../../../test/actors';
import { createDbTestApp, createTestClock } from '../../../test/auth';
import { describeDb, useTestDatabase } from '../../../test/db';
import type { App } from '../../app';
import * as schema from '../../db/schema';
import { boardViewers, cardAssignees, notifications } from '../../db/schema';

import { getBoardPayload } from './service';

/**
 * Fatia 11 (refeita no nível do quadro): matriz de acesso (ator × visibilidade × viewer × rota) e
 * testes de vazamento da listagem bloqueada (ADR 0015). As rotas que **mudam** a restrição estão em
 * `visibility.test.ts`: aqui o quadro é restringido pela própria rota, e o acesso, direto no banco.
 */
describeDb('quadros restritos: acesso e listagem bloqueada (kanban_test)', () => {
  const { db, pool } = useTestDatabase();
  const clock = createTestClock();
  let app: App;
  let admin: Actor;
  /** Membro com acesso ao quadro restrito (está na lista). */
  let insider: Actor;
  /** Membro sem acesso: é para ele que o quadro aparece bloqueado. */
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

  /** Restringe o quadro (a lista inicial fica com o ator, que também é o criador). */
  async function restrict(boardId: string) {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/boards/${boardId}/visibility`,
      headers: insider.headers,
      payload: { visibility: 'restricted' },
    });
    expect(res.statusCode).toBe(200);
  }

  async function restrictedBoard() {
    const { board, todo, doing, done } = await newBoard('Diretoria');
    const card = await newCard(todo, 'Proposta comercial');
    await restrict(board.id);
    return { board, todo, doing, done, card };
  }

  const boardsFor = async (actor: Actor) => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/boards',
      headers: { cookie: actor.cookie },
    });
    expect(res.statusCode).toBe(200);
    return { res, body: boardsResponseSchema.strict().parse(res.json()) };
  };

  describe('matriz ator × visibilidade × viewer × rota', () => {
    it('quadro team: todo usuário ativo continua lendo e editando (RN05)', async () => {
      const { board, todo } = await newBoard();
      const card = await newCard(todo, 'Card da equipe');
      for (const actor of [insider, outsider, admin]) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/boards/${board.id}`,
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
    });

    it('quadro restrito: sem acesso → 403 BOARD_RESTRICTED em toda rota do quadro, das listas e dos cards', async () => {
      const { board, todo, doing, card } = await restrictedBoard();
      const label = labelResponseSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: `/api/boards/${board.id}/labels`,
            headers: insider.headers,
            payload: { name: 'Bug', color: 'red' },
          })
        ).json(),
      ).label;
      const checklist = await app.inject({
        method: 'POST',
        url: `/api/cards/${card.id}/checklists`,
        headers: insider.headers,
        payload: { title: 'Checklist' },
      });
      const checklistId = checklistResponseSchema.parse(checklist.json()).checklist.id;
      const comment = await app.inject({
        method: 'POST',
        url: `/api/cards/${card.id}/comments`,
        headers: insider.headers,
        payload: { body: 'combinado' },
      });
      const commentId = commentResponseSchema.parse(comment.json()).comment.id;
      const item = await app.inject({
        method: 'POST',
        url: `/api/checklists/${checklistId}/items`,
        headers: insider.headers,
        payload: { text: 'Item' },
      });
      const itemId = checklistItemResponseSchema.parse(item.json()).item.id;

      const requests: {
        name: string;
        method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
        url: string;
        payload?: object;
      }[] = [
        { name: 'abrir o quadro', method: 'GET', url: `/api/boards/${board.id}` },
        { name: 'arquivados do quadro', method: 'GET', url: `/api/boards/${board.id}/archived` },
        {
          name: 'renomear o quadro',
          method: 'PATCH',
          url: `/api/boards/${board.id}`,
          payload: { name: 'x' },
        },
        { name: 'arquivar o quadro', method: 'POST', url: `/api/boards/${board.id}/archive` },
        { name: 'restaurar o quadro', method: 'POST', url: `/api/boards/${board.id}/restore` },
        {
          name: 'excluir o quadro (Admin)',
          method: 'DELETE',
          url: `/api/boards/${board.id}`,
          payload: { confirmName: 'Diretoria' },
        },
        {
          name: 'visibilidade',
          method: 'PUT',
          url: `/api/boards/${board.id}/visibility`,
          payload: { visibility: 'team' },
        },
        {
          name: 'dar acesso',
          method: 'PUT',
          url: `/api/boards/${board.id}/viewers/${outsider.user.id}`,
        },
        {
          name: 'tirar acesso',
          method: 'DELETE',
          url: `/api/boards/${board.id}/viewers/${insider.user.id}`,
        },
        {
          name: 'URL de capa',
          method: 'POST',
          url: `/api/boards/${board.id}/cover/upload-url`,
          payload: { contentType: 'image/png', sizeBytes: 10 },
        },
        {
          name: 'confirmar capa',
          method: 'PUT',
          url: `/api/boards/${board.id}/cover`,
          payload: { objectKey: `covers/${board.id}/abcdefghijklmnopqrstuvwxyz012345` },
        },
        { name: 'remover capa', method: 'DELETE', url: `/api/boards/${board.id}/cover` },
        {
          name: 'criar lista',
          method: 'POST',
          url: `/api/boards/${board.id}/lists`,
          payload: { name: 'Nova' },
        },
        {
          name: 'editar lista',
          method: 'PATCH',
          url: `/api/lists/${todo.id}`,
          payload: { name: 'Outra' },
        },
        {
          name: 'mover lista',
          method: 'POST',
          url: `/api/lists/${todo.id}/move`,
          payload: { placement: { type: 'end' } },
        },
        { name: 'arquivar lista', method: 'POST', url: `/api/lists/${todo.id}/archive` },
        { name: 'restaurar lista', method: 'POST', url: `/api/lists/${todo.id}/restore` },
        {
          name: 'criar card',
          method: 'POST',
          url: `/api/lists/${todo.id}/cards`,
          payload: { title: 'Bisbilhotando' },
        },
        { name: 'ler card', method: 'GET', url: `/api/cards/${card.id}` },
        { name: 'histórico do card', method: 'GET', url: `/api/cards/${card.id}/activity` },
        {
          name: 'editar card',
          method: 'PATCH',
          url: `/api/cards/${card.id}`,
          payload: { title: 'Bisbilhotando' },
        },
        {
          name: 'mover card',
          method: 'POST',
          url: `/api/cards/${card.id}/move`,
          payload: { toListId: doing.id, placement: { type: 'end' } },
        },
        { name: 'concluir card', method: 'POST', url: `/api/cards/${card.id}/complete` },
        { name: 'reabrir card', method: 'POST', url: `/api/cards/${card.id}/reopen` },
        { name: 'arquivar card', method: 'POST', url: `/api/cards/${card.id}/archive` },
        { name: 'restaurar card', method: 'POST', url: `/api/cards/${card.id}/restore` },
        { name: 'excluir card (Admin)', method: 'DELETE', url: `/api/cards/${card.id}` },
        {
          name: 'comentar',
          method: 'POST',
          url: `/api/cards/${card.id}/comments`,
          payload: { body: 'oi' },
        },
        {
          name: 'editar comentário',
          method: 'PATCH',
          url: `/api/comments/${commentId}`,
          payload: { body: 'oi' },
        },
        { name: 'excluir comentário', method: 'DELETE', url: `/api/comments/${commentId}` },
        {
          name: 'criar checklist',
          method: 'POST',
          url: `/api/cards/${card.id}/checklists`,
          payload: { title: 'Checklist' },
        },
        {
          name: 'renomear checklist',
          method: 'PATCH',
          url: `/api/checklists/${checklistId}`,
          payload: { title: 'Outro' },
        },
        { name: 'excluir checklist', method: 'DELETE', url: `/api/checklists/${checklistId}` },
        {
          name: 'criar item',
          method: 'POST',
          url: `/api/checklists/${checklistId}/items`,
          payload: { text: 'Item' },
        },
        {
          name: 'editar item do checklist',
          method: 'PATCH',
          url: `/api/checklist-items/${itemId}`,
          payload: { isChecked: true },
        },
        {
          name: 'mover item do checklist',
          method: 'POST',
          url: `/api/checklist-items/${itemId}/move`,
          payload: { placement: { type: 'start' } },
        },
        {
          name: 'excluir item do checklist',
          method: 'DELETE',
          url: `/api/checklist-items/${itemId}`,
        },
        {
          name: 'criar etiqueta',
          method: 'POST',
          url: `/api/boards/${board.id}/labels`,
          payload: { name: 'Nova', color: 'blue' },
        },
        {
          name: 'editar etiqueta',
          method: 'PATCH',
          url: `/api/labels/${label.id}`,
          payload: { name: 'Outra' },
        },
        { name: 'excluir etiqueta', method: 'DELETE', url: `/api/labels/${label.id}` },
        {
          name: 'aplicar etiqueta',
          method: 'PUT',
          url: `/api/cards/${card.id}/labels/${label.id}`,
        },
        {
          name: 'tirar etiqueta',
          method: 'DELETE',
          url: `/api/cards/${card.id}/labels/${label.id}`,
        },
        {
          name: 'responsável',
          method: 'PUT',
          url: `/api/cards/${card.id}/assignees/${outsider.user.id}`,
        },
        {
          name: 'tirar responsável',
          method: 'DELETE',
          url: `/api/cards/${card.id}/assignees/${outsider.user.id}`,
        },
      ];

      for (const request of requests) {
        const res = await app.inject({
          method: request.method,
          url: request.url,
          headers: outsider.headers,
          ...(request.payload ? { payload: request.payload } : {}),
        });
        expect({ rota: request.name, status: res.statusCode }).toEqual({
          rota: request.name,
          status: 403,
        });
        expectError(res, 403, 'BOARD_RESTRICTED');
        expect(res.body).not.toContain('Proposta comercial');
      }
    });

    it('quadro restrito: viewer e Admin seguem fazendo tudo', async () => {
      const { board, doing, card } = await restrictedBoard();
      for (const actor of [insider, admin]) {
        const read = await app.inject({
          method: 'GET',
          url: `/api/boards/${board.id}`,
          headers: { cookie: actor.cookie },
        });
        expect(read.statusCode).toBe(200);
        const patched = await app.inject({
          method: 'PATCH',
          url: `/api/cards/${card.id}`,
          headers: actor.headers,
          payload: { description: `visto por ${actor.user.name}` },
        });
        expect(patched.statusCode).toBe(200);
      }
      const moved = await app.inject({
        method: 'POST',
        url: `/api/cards/${card.id}/move`,
        headers: admin.headers,
        payload: { toListId: doing.id, placement: { type: 'end' } },
      });
      expect(moved.statusCode).toBe(200);
    });

    it('403 BOARD_RESTRICTED vem antes do 403 FORBIDDEN de papel e de 409 de estado', async () => {
      const { board, card } = await restrictedBoard();
      // Membro sem acesso tentando excluir (rota de Admin): o acesso ao quadro decide primeiro.
      expectError(
        await app.inject({
          method: 'DELETE',
          url: `/api/cards/${card.id}`,
          headers: outsider.headers,
        }),
        403,
        'BOARD_RESTRICTED',
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
          url: `/api/cards/${card.id}`,
          headers: outsider.headers,
          payload: { title: 'x' },
        }),
        403,
        'BOARD_RESTRICTED',
      );
    });

    it('quadro inexistente continua 404 (o 404 vem antes do acesso)', async () => {
      expectError(
        await app.inject({
          method: 'GET',
          url: '/api/boards/00000000-0000-4000-8000-000000000000',
          headers: { cookie: outsider.cookie },
        }),
        404,
        'NOT_FOUND',
      );
    });

    it('mover card para quadro restrito sem acesso → 403 BOARD_RESTRICTED', async () => {
      const { todo } = await newBoard('Aberto');
      const card = await newCard(todo, 'Card da equipe');
      const { doing } = await restrictedBoard();
      // `outsider` tem acesso ao quadro de origem, mas não ao destino.
      expectError(
        await app.inject({
          method: 'POST',
          url: `/api/cards/${card.id}/move`,
          headers: outsider.headers,
          payload: { toListId: doing.id, placement: { type: 'end' } },
        }),
        403,
        'BOARD_RESTRICTED',
      );
    });
  });

  describe('listagem bloqueada (vazamento)', () => {
    it('GET /api/boards: quadro bloqueado tem exatamente id, name e locked', async () => {
      const { board } = await restrictedBoard();
      const aberto = await newBoard('Aberto');

      const { res, body } = await boardsFor(outsider);
      // Ordem por nome: "Aberto" (inteiro) e "Diretoria" (bloqueado).
      expect(body.boards.map((item) => [item.name, item.locked])).toEqual([
        ['Aberto', false],
        ['Diretoria', true],
      ]);
      expect(body.boards[0]).toMatchObject({
        id: aberto.board.id,
        visibility: 'team',
        cover: null,
      });
      const locked = body.boards.find((item) => item.id === board.id);
      expect(locked).toEqual({ id: board.id, name: 'Diretoria', locked: true });
      expect(Object.keys(locked ?? {}).sort()).toEqual(['id', 'locked', 'name']);
      expect(res.body).not.toContain('restricted');

      // Quem tem acesso (e o Admin) vê o quadro inteiro.
      for (const actor of [insider, admin]) {
        const seen = (await boardsFor(actor)).body.boards.find((item) => item.id === board.id);
        expect(seen?.locked).toBe(false);
        expect(seen?.locked === false ? seen.visibility : null).toBe('restricted');
      }
    });

    it('arquivados: quadro restrito bloqueado some da listagem de arquivados de quem não tem acesso', async () => {
      const { board } = await restrictedBoard();
      await app.inject({
        method: 'POST',
        url: `/api/boards/${board.id}/archive`,
        headers: insider.headers,
      });
      const { body } = await boardsFor(outsider);
      expect(body.boards).toEqual([]);

      const arquivados = await app.inject({
        method: 'GET',
        url: '/api/boards?archived=true',
        headers: { cookie: outsider.cookie },
      });
      expect(boardsResponseSchema.strict().parse(arquivados.json()).boards).toEqual([
        { id: board.id, name: 'Diretoria', locked: true },
      ]);

      // E as rotas do quadro arquivado continuam 403 para quem não tem acesso.
      expectError(
        await app.inject({
          method: 'GET',
          url: `/api/boards/${board.id}/archived`,
          headers: { cookie: outsider.cookie },
        }),
        403,
        'BOARD_RESTRICTED',
      );
    });

    it('payload do quadro continua em 6 consultas (quadro team) e 8 no restrito', async () => {
      const { board, todo } = await newBoard();
      for (let i = 0; i < 10; i++) await newCard(todo, `Card ${i}`);
      const countQueries = async (actor: Actor) => {
        const logged: string[] = [];
        const counting = drizzle({
          client: pool(),
          schema,
          logger: { logQuery: (query) => logged.push(query) },
        });
        await getBoardPayload(counting, board.id, boardActor(actor), noCovers());
        return logged.filter((query) => !/^(begin|commit|rollback)\b/i.test(query.trim()));
      };

      expect(await countQueries(outsider)).toHaveLength(6);
      expect(await countQueries(admin)).toHaveLength(6);

      await restrict(board.id);
      // Restrito: + checagem de acesso do viewer + lista de acesso da resposta.
      expect(await countQueries(insider)).toHaveLength(8);
      // Admin não consulta a lista de acesso para decidir (acesso implícito).
      expect(await countQueries(admin)).toHaveLength(7);
    });

    it('payload e detalhe do card não saem para quem não tem acesso ao quadro', async () => {
      const { board, card } = await restrictedBoard();
      const payload = await app.inject({
        method: 'GET',
        url: `/api/boards/${board.id}`,
        headers: { cookie: outsider.cookie },
      });
      expectError(payload, 403, 'BOARD_RESTRICTED');
      expect(payload.body).not.toContain(card.id);

      const visible = await app.inject({
        method: 'GET',
        url: `/api/boards/${board.id}`,
        headers: { cookie: insider.cookie },
      });
      expect(boardPayloadSchema.strict().parse(visible.json()).cards).toHaveLength(1);

      const archived = await app.inject({
        method: 'GET',
        url: `/api/boards/${board.id}/archived`,
        headers: { cookie: insider.cookie },
      });
      expect(boardArchivedResponseSchema.strict().parse(archived.json()).cards).toEqual([]);
    });
  });

  describe('meus cards e notificações filtram (não bloqueiam)', () => {
    it('Meus cards não traz card de quadro sem acesso', async () => {
      const { board, todo } = await newBoard();
      const card = await newCard(todo, 'Trabalho sensível');
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

      await restrict(board.id);
      expect(await mine(outsider)).toEqual([]);
      // Admin continua vendo os cards dele (acesso implícito).
      expect(await mine(insider)).toEqual([]);
    });

    it('notificação de card em quadro sem acesso some da lista e do contador; volta com o acesso', async () => {
      const { board, todo } = await newBoard();
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

      await restrict(board.id);
      expect((await list()).notifications).toEqual([]);
      expect((await list()).unreadCount).toBe(0);
      expect(await counter()).toBe(0);
      // A linha continua no banco (RN40: filtro na leitura, não exclusão).
      expect(await db().$count(notifications)).toBe(1);

      await db().insert(boardViewers).values({
        boardId: board.id,
        userId: outsider.user.id,
        addedBy: insider.user.id,
        createdAt: clock.now(),
      });
      expect((await list()).notifications).toHaveLength(1);
      expect(await counter()).toBe(1);
    });
  });

  describe('ações de contêiner dentro do quadro restrito', () => {
    it('marcar lista de conclusão conclui os cards do quadro restrito para quem tem acesso', async () => {
      const { doing, card } = await restrictedBoard();
      await app.inject({
        method: 'POST',
        url: `/api/cards/${card.id}/move`,
        headers: insider.headers,
        payload: { toListId: doing.id, placement: { type: 'end' } },
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/lists/${doing.id}`,
        headers: insider.headers,
        payload: { isDoneList: true },
      });
      expect(res.statusCode).toBe(200);
      expect(updateListResponseSchema.parse(res.json()).completedCardIds).toContain(card.id);

      // E continua 403 para quem não tem acesso ao quadro.
      expectError(
        await app.inject({
          method: 'PATCH',
          url: `/api/lists/${doing.id}`,
          headers: outsider.headers,
          payload: { isDoneList: false },
        }),
        403,
        'BOARD_RESTRICTED',
      );
    });
  });
});
