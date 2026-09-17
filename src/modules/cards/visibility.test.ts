import {
  cardAssigneesResponseSchema,
  cardDetailResponseSchema,
  cardSummaryResponseSchema,
  cardViewersResponseSchema,
  createBoardResponseSchema,
  type ActivityType,
  type List,
} from '@raphasparda/ronin-shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectError, MISSING_ID, seedActor, seedTeam, type Actor } from '../../../test/actors';
import { createDbTestApp, createTestClock } from '../../../test/auth';
import { describeDb, useTestDatabase } from '../../../test/db';
import type { App } from '../../app';
import { cardActivities, cards, cardViewers, users } from '../../db/schema';
import { onAssigned } from '../notifications/hooks';

vi.mock('../notifications/hooks', () => ({
  onAssigned: vi.fn(() => Promise.resolve()),
  onCommented: vi.fn(() => Promise.resolve()),
}));

/** Tarefa 11.4: rotas de visibilidade e de lista de acesso (api.md §11, ADR 0015). */
describeDb('visibilidade e lista de acesso do card (kanban_test)', () => {
  const { db } = useTestDatabase();
  const clock = createTestClock();
  let app: App;
  let admin: Actor;
  let owner: Actor;
  let other: Actor;

  beforeEach(async () => {
    clock.set(new Date('2026-09-16T12:00:00.000Z'));
    app = await createDbTestApp({ clock: clock.now });
    ({ admin, member: owner } = await seedTeam(db(), clock.now()));
    other = await seedActor(db(), { role: 'member', name: 'Caio Membro' }, clock.now());
  });

  afterEach(async () => {
    await app.close();
  });

  async function newBoard() {
    const res = await app.inject({
      method: 'POST',
      url: '/api/boards',
      headers: owner.headers,
      payload: { name: 'Quadro' },
    });
    const body = createBoardResponseSchema.parse(res.json());
    const [todo] = body.lists;
    if (!todo) throw new Error('listas padrão ausentes');
    return { board: body.board, todo };
  }

  async function newCard(list: Pick<List, 'id'>, title = 'Card') {
    const res = await app.inject({
      method: 'POST',
      url: `/api/lists/${list.id}/cards`,
      headers: owner.headers,
      payload: { title },
    });
    return cardSummaryResponseSchema.parse(res.json()).card;
  }

  const setVisibility = (cardId: string, visibility: string, actor = owner) =>
    app.inject({
      method: 'PUT',
      url: `/api/cards/${cardId}/visibility`,
      headers: actor.headers,
      payload: { visibility },
    });

  const putViewer = (cardId: string, userId: string, actor = owner) =>
    app.inject({
      method: 'PUT',
      url: `/api/cards/${cardId}/viewers/${userId}`,
      headers: actor.headers,
    });

  const deleteViewer = (cardId: string, userId: string, actor = owner) =>
    app.inject({
      method: 'DELETE',
      url: `/api/cards/${cardId}/viewers/${userId}`,
      headers: actor.headers,
    });

  const assign = (cardId: string, userId: string, actor = owner) =>
    app.inject({
      method: 'PUT',
      url: `/api/cards/${cardId}/assignees/${userId}`,
      headers: actor.headers,
    });

  /**
   * `viewerIds` sai na ordem de inclusão (`created_at`, depois `user_id`). Como o relógio dos
   * testes é fixo, as inclusões empatam no instante: as asserções comparam conjuntos ordenados.
   */
  const viewerIds = (res: Awaited<ReturnType<typeof putViewer>>) =>
    [...cardViewersResponseSchema.parse(res.json()).viewerIds].sort();

  const sorted = (ids: string[]) => [...ids].sort();

  const detail = async (cardId: string, actor = owner) => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/cards/${cardId}`,
      headers: { cookie: actor.cookie },
    });
    expect(res.statusCode).toBe(200);
    return cardDetailResponseSchema.parse(res.json()).card;
  };

  async function activityTypes(cardId: string): Promise<ActivityType[]> {
    const rows = await db()
      .select({ type: cardActivities.type })
      .from(cardActivities)
      .where(eq(cardActivities.cardId, cardId));
    return rows.map((row) => row.type);
  }

  describe('PUT /api/cards/:cardId/visibility', () => {
    it('restringir inclui o ator (que aqui também é o criador) e os responsáveis, com atividade', async () => {
      const { todo } = await newBoard();
      const card = await newCard(todo, 'Proposta');
      expect(
        cardAssigneesResponseSchema.parse((await assign(card.id, other.user.id)).json())
          .assigneeIds,
      ).toEqual([other.user.id]);

      const res = await setVisibility(card.id, 'restricted');
      expect(res.statusCode).toBe(200);
      const body = cardDetailResponseSchema.parse(res.json()).card;
      expect(body.visibility).toBe('restricted');
      expect([...body.viewerIds].sort()).toEqual([owner.user.id, other.user.id].sort());
      expect(await activityTypes(card.id)).toEqual([
        'card_created',
        'card_assignee_added',
        'card_visibility_changed',
        'card_viewer_added',
        'card_viewer_added',
      ]);

      // Idempotente: mesmo valor não gera atividade nova.
      expect((await setVisibility(card.id, 'restricted')).statusCode).toBe(200);
      expect(await activityTypes(card.id)).toHaveLength(5);
    });

    it('criador entra na lista mesmo sem ser o ator nem responsável (RN30)', async () => {
      const { todo } = await newBoard(); // card criado por `owner`
      const card = await newCard(todo, 'Proposta');
      await assign(card.id, other.user.id);

      // Quem restringe é o Admin: nem criador, nem responsável.
      const res = await setVisibility(card.id, 'restricted', admin);
      expect(res.statusCode).toBe(200);
      const body = cardDetailResponseSchema.parse(res.json()).card;
      expect(sorted(body.viewerIds)).toEqual(sorted([admin.user.id, owner.user.id, other.user.id]));
      expect(await activityTypes(card.id)).toEqual([
        'card_created',
        'card_assignee_added',
        'card_visibility_changed',
        'card_viewer_added',
        'card_viewer_added',
        'card_viewer_added',
      ]);
      // O criador continua abrindo o card que ele mesmo criou.
      expect((await detail(card.id, owner)).id).toBe(card.id);
    });

    it('criador anonimizado não entra na lista (RN38)', async () => {
      const { todo } = await newBoard(); // criado por `owner`
      const card = await newCard(todo, 'Proposta');
      await db()
        .update(users)
        .set({
          status: 'deactivated',
          anonymizedAt: clock.now(),
          email: null,
          passwordHash: null,
          name: 'Usuário removido',
        })
        .where(eq(users.id, owner.user.id));

      const body = cardDetailResponseSchema.parse(
        (await setVisibility(card.id, 'restricted', admin)).json(),
      ).card;
      expect(body.viewerIds).toEqual([admin.user.id]);
    });

    it('voltar para team esvazia a lista de acesso e todos abrem de novo', async () => {
      const { todo } = await newBoard();
      const card = await newCard(todo);
      await setVisibility(card.id, 'restricted');
      expectError(
        await app.inject({
          method: 'GET',
          url: `/api/cards/${card.id}`,
          headers: { cookie: other.cookie },
        }),
        403,
        'CARD_RESTRICTED',
      );

      const res = await setVisibility(card.id, 'team');
      expect(res.statusCode).toBe(200);
      expect(cardDetailResponseSchema.parse(res.json()).card.viewerIds).toEqual([]);
      expect(await db().$count(cardViewers)).toBe(0);
      expect((await detail(card.id, other)).visibility).toBe('team');
      expect(await activityTypes(card.id)).toEqual([
        'card_created',
        'card_visibility_changed',
        'card_viewer_added',
        'card_visibility_changed',
      ]);
    });

    it('quem não tem acesso não muda a visibilidade; Admin muda', async () => {
      const { todo } = await newBoard();
      const card = await newCard(todo);
      await setVisibility(card.id, 'restricted');
      expectError(await setVisibility(card.id, 'team', other), 403, 'CARD_RESTRICTED');
      expect((await setVisibility(card.id, 'team', admin)).statusCode).toBe(200);
    });

    it('400 em valor inválido; 404 em card inexistente; 409 em quadro arquivado', async () => {
      const { board, todo } = await newBoard();
      const card = await newCard(todo);
      expectError(await setVisibility(card.id, 'privado'), 400, 'VALIDATION_ERROR');
      expectError(await setVisibility(MISSING_ID, 'restricted'), 404, 'NOT_FOUND');
      await app.inject({
        method: 'POST',
        url: `/api/boards/${board.id}/archive`,
        headers: admin.headers,
      });
      expectError(await setVisibility(card.id, 'restricted'), 409, 'BOARD_ARCHIVED');
    });
  });

  describe('PUT|DELETE /api/cards/:cardId/viewers/:userId', () => {
    async function restricted() {
      const { board, todo } = await newBoard();
      const card = await newCard(todo, 'Assunto sensível');
      await setVisibility(card.id, 'restricted');
      return { board, todo, card };
    }

    it('adicionar e remover: idempotentes, com atividade só na mudança', async () => {
      const { card } = await restricted();
      expect(viewerIds(await putViewer(card.id, other.user.id))).toEqual(
        sorted([owner.user.id, other.user.id]),
      );
      expect(viewerIds(await putViewer(card.id, other.user.id))).toEqual(
        sorted([owner.user.id, other.user.id]),
      );
      expect((await detail(card.id, other)).id).toBe(card.id);

      expect(viewerIds(await deleteViewer(card.id, other.user.id))).toEqual([owner.user.id]);
      expect(viewerIds(await deleteViewer(card.id, other.user.id))).toEqual([owner.user.id]);
      expectError(
        await app.inject({
          method: 'GET',
          url: `/api/cards/${card.id}`,
          headers: { cookie: other.cookie },
        }),
        403,
        'CARD_RESTRICTED',
      );
      expect(await activityTypes(card.id)).toEqual([
        'card_created',
        'card_visibility_changed',
        'card_viewer_added',
        'card_viewer_added',
        'card_viewer_removed',
      ]);
    });

    it('card da equipe → 409 CARD_NOT_RESTRICTED nas duas rotas', async () => {
      const { todo } = await newBoard();
      const card = await newCard(todo);
      expectError(await putViewer(card.id, other.user.id), 409, 'CARD_NOT_RESTRICTED');
      expectError(await deleteViewer(card.id, other.user.id), 409, 'CARD_NOT_RESTRICTED');
    });

    it('usuário inexistente → 404; desativado → 409 USER_NOT_ACTIVE (RN37)', async () => {
      const { card } = await restricted();
      expectError(await putViewer(card.id, MISSING_ID), 404, 'NOT_FOUND');
      await db().update(users).set({ status: 'deactivated' }).where(eq(users.id, other.user.id));
      expectError(await putViewer(card.id, other.user.id), 409, 'USER_NOT_ACTIVE');
      // Remover continua valendo para qualquer status.
      await db().insert(cardViewers).values({
        cardId: card.id,
        userId: other.user.id,
        addedBy: owner.user.id,
        createdAt: clock.now(),
      });
      expect(viewerIds(await deleteViewer(card.id, other.user.id))).toEqual([owner.user.id]);
    });

    it('responsável do card não perde o acesso (RN32): 409 até sair dos responsáveis', async () => {
      const { card } = await restricted();
      await assign(card.id, other.user.id);
      expect((await detail(card.id)).viewerIds).toContain(other.user.id);
      const refused = expectError(await deleteViewer(card.id, other.user.id), 409, 'CONFLICT');
      expect(refused.message).toContain('Caio Membro');
      expect(refused.message).toContain('responsável');

      await app.inject({
        method: 'DELETE',
        url: `/api/cards/${card.id}/assignees/${other.user.id}`,
        headers: owner.headers,
      });
      // Tirar da lista de responsáveis não tira o acesso (RN33); a remoção explícita, sim.
      expect((await detail(card.id)).viewerIds).toContain(other.user.id);
      expect(viewerIds(await deleteViewer(card.id, other.user.id))).toEqual([owner.user.id]);
    });

    it('sair do card: quem se remove perde o acesso na chamada seguinte', async () => {
      const { card } = await restricted();
      await putViewer(card.id, other.user.id);
      expect(viewerIds(await deleteViewer(card.id, owner.user.id, owner))).toEqual([other.user.id]);
      expectError(
        await app.inject({
          method: 'GET',
          url: `/api/cards/${card.id}`,
          headers: { cookie: owner.cookie },
        }),
        403,
        'CARD_RESTRICTED',
      );
      // Admin sempre alcança o card e devolve o acesso.
      expect(viewerIds(await putViewer(card.id, owner.user.id, admin))).toContain(owner.user.id);
    });

    it('lista vazia é permitida (sem regra de último viewer): só Admin abre', async () => {
      const { card } = await restricted();
      expect(viewerIds(await deleteViewer(card.id, owner.user.id))).toEqual([]);
      expectError(
        await app.inject({
          method: 'GET',
          url: `/api/cards/${card.id}`,
          headers: { cookie: owner.cookie },
        }),
        403,
        'CARD_RESTRICTED',
      );
      expect((await detail(card.id, admin)).viewerIds).toEqual([]);
    });

    it('atribuir em card restrito dá acesso na mesma transação (RN31)', async () => {
      const { card } = await restricted();
      expect(
        cardAssigneesResponseSchema.parse((await assign(card.id, other.user.id)).json())
          .assigneeIds,
      ).toEqual([other.user.id]);
      expect(sorted((await detail(card.id, other)).viewerIds)).toEqual(
        sorted([owner.user.id, other.user.id]),
      );
      expect(await activityTypes(card.id)).toEqual([
        'card_created',
        'card_visibility_changed',
        'card_viewer_added',
        'card_assignee_added',
        'card_viewer_added',
      ]);
      expect(vi.mocked(onAssigned)).toHaveBeenCalledTimes(1);
    });
  });

  describe('ciclo de vida da conta (RN38)', () => {
    it('anonimizar tira a pessoa de todas as listas; o card continua restrito', async () => {
      const { todo } = await newBoard();
      const card = await newCard(todo);
      await setVisibility(card.id, 'restricted');
      await putViewer(card.id, other.user.id);

      await app.inject({
        method: 'POST',
        url: `/api/admin/users/${other.user.id}/deactivate`,
        headers: admin.headers,
      });
      // Desativado continua na lista (RN38).
      expect((await detail(card.id)).viewerIds).toContain(other.user.id);

      const anonymized = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${other.user.id}/anonymize`,
        headers: admin.headers,
        payload: { confirm: true },
      });
      expect(anonymized.statusCode).toBe(200);
      expect((await detail(card.id)).viewerIds).toEqual([owner.user.id]);
      const [row] = await db().select().from(cards).where(eq(cards.id, card.id));
      expect(row?.visibility).toBe('restricted');
    });
  });
});
