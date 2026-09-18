import {
  boardPayloadSchema,
  cardLabelsResponseSchema,
  cardMutationResultSchema,
  cardSummaryResponseSchema,
  createBoardResponseSchema,
  labelResponseSchema,
  type List,
} from '@raphasparda/ronin-shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { expectError, MISSING_ID, seedTeam, type Actor } from '../../../../../test/actors';
import { csrfHeaders } from '../../../../../test/app';
import { createDbTestApp, createTestClock } from '../../../../../test/auth';
import { describeDb, useTestDatabase } from '../../../../../test/db';
import type { App } from '../../../../app';
import { boards, cardActivities, cardLabels, labels } from '../../../../db/schema';

describeDb('rotas de etiquetas (ronin_test)', () => {
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

  const postLabel = (boardId: string, body: unknown, headers = member.headers) =>
    app.inject({
      method: 'POST',
      url: `/api/boards/${boardId}/labels`,
      headers,
      payload: body as object,
    });

  async function label(boardId: string, name: string, color = 'red') {
    const res = await postLabel(boardId, { name, color });
    expect(res.statusCode).toBe(201);
    return labelResponseSchema.strict().parse(res.json()).label;
  }

  const patchLabel = (labelId: string, body: unknown, headers = member.headers) =>
    app.inject({
      method: 'PATCH',
      url: `/api/labels/${labelId}`,
      headers,
      payload: body as object,
    });

  const deleteLabel = (labelId: string, headers = member.headers) =>
    app.inject({ method: 'DELETE', url: `/api/labels/${labelId}`, headers });

  const cardLabel = (
    cardId: string,
    labelId: string,
    method: 'PUT' | 'DELETE' = 'PUT',
    headers = member.headers,
  ) => app.inject({ method, url: `/api/cards/${cardId}/labels/${labelId}`, headers });

  const labelIds = (res: Awaited<ReturnType<typeof cardLabel>>) => {
    expect({ status: res.statusCode, body: res.body }).toMatchObject({ status: 200 });
    return cardLabelsResponseSchema.strict().parse(res.json()).labelIds;
  };

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

  const archiveBoard = (boardId: string) =>
    db().update(boards).set({ archivedAt: clock.now() }).where(eq(boards.id, boardId));

  describe('POST /api/boards/:boardId/labels', () => {
    it('cria com nome aparado e cor da paleta; nomes repetidos permitidos; payload por nome', async () => {
      const { board } = await newBoard();
      const res = await postLabel(board.id, { name: '  Urgente ', color: 'magenta' });
      expect(res.statusCode).toBe(201);
      const created = labelResponseSchema.strict().parse(res.json()).label;
      expect(created).toEqual({
        id: created.id,
        boardId: board.id,
        name: 'Urgente',
        color: 'magenta',
      });
      const bug = await label(board.id, 'Bug');
      const bug2 = await label(board.id, 'Bug', 'blue');
      expect((await payload(board.id)).labels.map((l) => l.name)).toEqual([
        'Bug',
        'Bug',
        'Urgente',
      ]);
      expect(new Set([bug.id, bug2.id]).size).toBe(2);
    });

    it('400 (nome vazio, > 50, cor fora da paleta ou ausente, id inválido), 404, 409 BOARD_ARCHIVED, CSRF, 401', async () => {
      const { board } = await newBoard();
      for (const body of [
        {},
        { name: '', color: 'red' },
        { name: '   ', color: 'red' },
        { name: 'x'.repeat(51), color: 'red' },
        { name: 'Bug' },
        { name: 'Bug', color: '#ff0000' },
        { name: 'Bug', color: 'pink' },
      ]) {
        expectError(await postLabel(board.id, body), 400, 'VALIDATION_ERROR');
      }
      expect((await postLabel(board.id, { name: 'x'.repeat(50), color: 'gray' })).statusCode).toBe(
        201,
      );
      expectError(await postLabel('x', { name: 'Bug', color: 'red' }), 400, 'VALIDATION_ERROR');
      expectError(await postLabel(MISSING_ID, { name: 'Bug', color: 'red' }), 404, 'NOT_FOUND');
      expectError(
        await postLabel(board.id, { name: 'Bug', color: 'red' }, { cookie: member.cookie }),
        403,
        'CSRF_REJECTED',
      );
      expectError(
        await postLabel(board.id, { name: 'Bug', color: 'red' }, csrfHeaders()),
        401,
        'UNAUTHENTICATED',
      );
      await archiveBoard(board.id);
      expectError(await postLabel(board.id, { name: 'Bug', color: 'red' }), 409, 'BOARD_ARCHIVED');
      expect(await db().$count(labels)).toBe(1);
    });
  });

  describe('PATCH /api/labels/:labelId', () => {
    it('renomeia e troca cor (juntos ou separados); aparece no payload', async () => {
      const { board } = await newBoard();
      const created = await label(board.id, 'Bug');

      const renamed = await patchLabel(created.id, { name: 'Defeito' });
      expect(renamed.statusCode).toBe(200);
      expect(labelResponseSchema.strict().parse(renamed.json()).label).toEqual({
        ...created,
        name: 'Defeito',
      });
      const both = await patchLabel(created.id, { name: 'Erro', color: 'yellow' });
      expect(labelResponseSchema.parse(both.json()).label).toMatchObject({
        name: 'Erro',
        color: 'yellow',
      });
      // Mesmos valores: 200 sem mudança.
      const same = await patchLabel(created.id, { color: 'yellow' });
      expect(labelResponseSchema.parse(same.json()).label).toMatchObject({ color: 'yellow' });
      expect((await payload(board.id)).labels).toEqual([
        { id: created.id, boardId: board.id, name: 'Erro', color: 'yellow' },
      ]);
    });

    it('400 (vazio, campos desconhecidos, nome inválido, cor inválida), 404, 409 BOARD_ARCHIVED, CSRF, 401', async () => {
      const { board } = await newBoard();
      const created = await label(board.id, 'Bug');
      for (const body of [{}, { foo: 1 }, { name: '' }, { name: 'x'.repeat(51) }, { color: 'x' }]) {
        expectError(await patchLabel(created.id, body), 400, 'VALIDATION_ERROR');
      }
      expectError(await patchLabel('x', { name: 'A' }), 400, 'VALIDATION_ERROR');
      expectError(await patchLabel(MISSING_ID, { name: 'A' }), 404, 'NOT_FOUND');
      expectError(
        await patchLabel(created.id, { name: 'A' }, { cookie: member.cookie }),
        403,
        'CSRF_REJECTED',
      );
      expectError(
        await patchLabel(created.id, { name: 'A' }, csrfHeaders()),
        401,
        'UNAUTHENTICATED',
      );
      await archiveBoard(board.id);
      expectError(await patchLabel(created.id, { name: 'A' }), 409, 'BOARD_ARCHIVED');
      const [row] = await db().select().from(labels).where(eq(labels.id, created.id));
      expect(row?.name).toBe('Bug');
    });
  });

  describe('DELETE /api/labels/:labelId', () => {
    it('remove de todos os cards (cascata) e do payload; Member pode; 404 depois', async () => {
      const { board, todo } = await newBoard();
      const bug = await label(board.id, 'Bug');
      const kept = await label(board.id, 'Ideia');
      const a = await card(todo, 'A');
      const b = await card(todo, 'B');
      await cardLabel(a.id, bug.id);
      await cardLabel(a.id, kept.id);
      await cardLabel(b.id, bug.id);

      const res = await deleteLabel(bug.id);
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
      const after = await payload(board.id);
      expect(after.labels.map((l) => l.id)).toEqual([kept.id]);
      expect(after.cards.map((card) => [card.id, card.labelIds])).toEqual([
        [a.id, [kept.id]],
        [b.id, []],
      ]);
      expect(await db().$count(cardLabels)).toBe(1);
      expectError(await deleteLabel(bug.id), 404, 'NOT_FOUND');
    });

    it('400, 404, 409 BOARD_ARCHIVED, CSRF, 401', async () => {
      const { board } = await newBoard();
      const created = await label(board.id, 'Bug');
      expectError(await deleteLabel('x'), 400, 'VALIDATION_ERROR');
      expectError(await deleteLabel(MISSING_ID), 404, 'NOT_FOUND');
      expectError(await deleteLabel(created.id, { cookie: admin.cookie }), 403, 'CSRF_REJECTED');
      expectError(await deleteLabel(created.id, csrfHeaders()), 401, 'UNAUTHENTICATED');
      await archiveBoard(board.id);
      expectError(await deleteLabel(created.id, admin.headers), 409, 'BOARD_ARCHIVED');
      expect(await db().$count(labels)).toBe(1);
    });
  });

  describe('PUT/DELETE /api/cards/:cardId/labels/:labelId', () => {
    it('aplica em ordem de nome, idempotente, sem atividade; remove idempotente; detalhe e payload refletem', async () => {
      const { board, todo } = await newBoard();
      const zeta = await label(board.id, 'Zeta');
      const alfa = await label(board.id, 'Alfa');
      const created = await card(todo);

      expect(labelIds(await cardLabel(created.id, zeta.id))).toEqual([zeta.id]);
      expect(labelIds(await cardLabel(created.id, alfa.id))).toEqual([alfa.id, zeta.id]);
      expect(labelIds(await cardLabel(created.id, alfa.id))).toEqual([alfa.id, zeta.id]);
      expect(await db().$count(cardLabels)).toBe(2);
      expect(await db().$count(cardActivities)).toBe(1); // só card_created

      expect((await payload(board.id)).cards[0]?.labelIds).toEqual([alfa.id, zeta.id]);
      expect(labelIds(await cardLabel(created.id, zeta.id, 'DELETE'))).toEqual([alfa.id]);
      expect(labelIds(await cardLabel(created.id, zeta.id, 'DELETE'))).toEqual([alfa.id]);
    });

    it('409 LABEL_BOARD_MISMATCH para etiqueta de outro quadro; DELETE dela é no-op 200', async () => {
      const { todo } = await newBoard('Um');
      const other = await newBoard('Dois');
      const foreign = await label(other.board.id, 'Estranha');
      const created = await card(todo);

      expectError(await cardLabel(created.id, foreign.id), 409, 'LABEL_BOARD_MISMATCH');
      expect(labelIds(await cardLabel(created.id, foreign.id, 'DELETE'))).toEqual([]);
      expect(await db().$count(cardLabels)).toBe(0);
    });

    it('mover para outro quadro remove as etiquetas do quadro de origem (removedLabelIds) e depois aceita as do destino', async () => {
      const { board, todo } = await newBoard('Origem');
      const target = await newBoard('Destino');
      const bug = await label(board.id, 'Bug');
      const targetLabel = await label(target.board.id, 'Alvo');
      const created = await card(todo);
      await cardLabel(created.id, bug.id);

      const moved = await app.inject({
        method: 'POST',
        url: `/api/cards/${created.id}/move`,
        headers: member.headers,
        payload: { toListId: target.todo.id, placement: { type: 'end' } },
      });
      expect(cardMutationResultSchema.parse(moved.json())).toMatchObject({
        card: { boardId: target.board.id, labelIds: [] },
        removedLabelIds: [bug.id],
      });
      expectError(await cardLabel(created.id, bug.id), 409, 'LABEL_BOARD_MISMATCH');
      expect(labelIds(await cardLabel(created.id, targetLabel.id))).toEqual([targetLabel.id]);
    });

    it('card arquivado aceita; 409 BOARD_ARCHIVED; 400; 404 (card, etiqueta); CSRF; 401', async () => {
      const { board, todo } = await newBoard();
      const bug = await label(board.id, 'Bug');
      const created = await card(todo);
      await app.inject({
        method: 'POST',
        url: `/api/cards/${created.id}/archive`,
        headers: member.headers,
      });
      expect(labelIds(await cardLabel(created.id, bug.id))).toEqual([bug.id]);

      for (const method of ['PUT', 'DELETE'] as const) {
        expectError(await cardLabel('x', bug.id, method), 400, 'VALIDATION_ERROR');
        expectError(await cardLabel(created.id, 'y', method), 400, 'VALIDATION_ERROR');
        expectError(await cardLabel(MISSING_ID, bug.id, method), 404, 'NOT_FOUND');
        expectError(await cardLabel(created.id, MISSING_ID, method), 404, 'NOT_FOUND');
        expectError(
          await cardLabel(created.id, bug.id, method, { cookie: member.cookie }),
          403,
          'CSRF_REJECTED',
        );
        expectError(
          await cardLabel(created.id, bug.id, method, csrfHeaders()),
          401,
          'UNAUTHENTICATED',
        );
      }
      await archiveBoard(board.id);
      expectError(await cardLabel(created.id, bug.id, 'DELETE'), 409, 'BOARD_ARCHIVED');
      expectError(await cardLabel(created.id, bug.id), 409, 'BOARD_ARCHIVED');
      expect(await db().$count(cardLabels)).toBe(1);
    });

    it('excluir a etiqueta em paralelo com aplicações não deixa card_labels órfão', async () => {
      const { board, todo } = await newBoard();
      const bug = await label(board.id, 'Bug');
      const cardsCreated = await Promise.all(
        Array.from({ length: 5 }, async (_, i) => card(todo, `C${i}`)),
      );
      const results = await Promise.all([
        ...cardsCreated.map((c) => cardLabel(c.id, bug.id)),
        deleteLabel(bug.id),
      ]);
      for (const res of results) expect([200, 204, 404]).toContain(res.statusCode);
      expect(await db().$count(cardLabels)).toBe(0);
      expect(await db().$count(labels)).toBe(0);
    });
  });
});
