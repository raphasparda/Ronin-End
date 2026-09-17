import {
  boardPayloadSchema,
  cardDetailResponseSchema,
  cardSummaryResponseSchema,
  commentResponseSchema,
  createBoardResponseSchema,
  type List,
} from '@kanban/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectError, MISSING_ID, seedActor, seedTeam, type Actor } from '../../../test/actors';
import { csrfHeaders } from '../../../test/app';
import { createDbTestApp, createTestClock } from '../../../test/auth';
import { describeDb, useTestDatabase } from '../../../test/db';
import type { App } from '../../app';
import { boards, cardActivities, cards, comments } from '../../db/schema';
import { onCommented } from '../notifications/hooks';

vi.mock('../notifications/hooks', () => ({
  onAssigned: vi.fn(() => Promise.resolve()),
  onCommented: vi.fn(() => Promise.resolve()),
}));

describeDb('rotas de comentários (kanban_test)', () => {
  const { db } = useTestDatabase();
  const clock = createTestClock();
  let app: App;
  let admin: Actor;
  let member: Actor;

  beforeEach(async () => {
    vi.mocked(onCommented).mockClear();
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
    return { board, card: cardSummaryResponseSchema.parse(res.json()).card };
  }

  const postComment = (cardId: string, body: unknown, headers = member.headers) =>
    app.inject({
      method: 'POST',
      url: `/api/cards/${cardId}/comments`,
      headers,
      payload: body as object,
    });

  async function comment(cardId: string, text: string, actor = member) {
    const res = await postComment(cardId, { body: text }, actor.headers);
    expect(res.statusCode).toBe(201);
    return commentResponseSchema.strict().parse(res.json()).comment;
  }

  const patchComment = (commentId: string, body: unknown, headers = member.headers) =>
    app.inject({
      method: 'PATCH',
      url: `/api/comments/${commentId}`,
      headers,
      payload: body as object,
    });

  const deleteComment = (commentId: string, headers = member.headers) =>
    app.inject({ method: 'DELETE', url: `/api/comments/${commentId}`, headers });

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

  const archiveBoard = (boardId: string) =>
    db().update(boards).set({ archivedAt: clock.now() }).where(eq(boards.id, boardId));

  describe('POST /api/cards/:cardId/comments', () => {
    it('cria com Markdown cru (sem sanitizar nem gerar HTML), chama onCommented, detalhe crescente e commentCount', async () => {
      const { board, card } = await newCard();
      const markdown = '  **Oi** <script>alert(1)</script> [x](javascript:alert(1))\n\n- item  ';
      const res = await postComment(card.id, { body: markdown });
      expect(res.statusCode).toBe(201);
      const first = commentResponseSchema.strict().parse(res.json()).comment;
      expect(first).toEqual({
        id: first.id,
        cardId: card.id,
        authorId: member.user.id,
        body: markdown.trim(),
        editedAt: null,
        createdAt: '2026-09-16T12:00:00.000Z',
      });
      expect(vi.mocked(onCommented).mock.calls.map(([, event]) => event)).toEqual([
        {
          cardId: card.id,
          commentId: first.id,
          actorId: member.user.id,
          now: new Date('2026-09-16T12:00:00.000Z'),
        },
      ]);

      clock.advance(1_000);
      const second = await comment(card.id, 'Segundo', admin);
      expect((await detail(card.id)).comments.map((c) => c.id)).toEqual([first.id, second.id]);
      const payload = boardPayloadSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/api/boards/${board.id}`,
            headers: { cookie: member.cookie },
          })
        ).json(),
      );
      expect(payload.cards[0]?.commentCount).toBe(2);
      expect(await db().$count(cardActivities)).toBe(1); // só card_created
    });

    it('400 (vazio, só espaços, > 10.000, id inválido), 404, 409 BOARD_ARCHIVED, CSRF, 401; card arquivado aceita', async () => {
      const { board, card } = await newCard();
      for (const body of [{}, { body: '' }, { body: '  \n ' }, { body: 'x'.repeat(10_001) }]) {
        expectError(await postComment(card.id, body), 400, 'VALIDATION_ERROR');
      }
      expect((await postComment(card.id, { body: 'x'.repeat(10_000) })).statusCode).toBe(201);
      expectError(await postComment('x', { body: 'a' }), 400, 'VALIDATION_ERROR');
      expectError(await postComment(MISSING_ID, { body: 'a' }), 404, 'NOT_FOUND');
      expectError(
        await postComment(card.id, { body: 'a' }, { cookie: member.cookie }),
        403,
        'CSRF_REJECTED',
      );
      expectError(await postComment(card.id, { body: 'a' }, csrfHeaders()), 401, 'UNAUTHENTICATED');

      await db().update(cards).set({ archivedAt: clock.now() }).where(eq(cards.id, card.id));
      expect((await postComment(card.id, { body: 'arquivado' })).statusCode).toBe(201);

      await archiveBoard(board.id);
      expectError(await postComment(card.id, { body: 'a' }), 409, 'BOARD_ARCHIVED');
      expect(await db().$count(comments)).toBe(2);
      expect(vi.mocked(onCommented)).toHaveBeenCalledTimes(2);
    });
  });

  describe('PATCH /api/comments/:commentId', () => {
    it('autor edita e grava editedAt; mesmo corpo não altera; Admin e outro Member → 403', async () => {
      const { card } = await newCard();
      const own = await comment(card.id, 'Original');

      clock.advance(5 * 60_000);
      const res = await patchComment(own.id, { body: ' Corrigido ' });
      expect(res.statusCode).toBe(200);
      expect(commentResponseSchema.strict().parse(res.json()).comment).toEqual({
        ...own,
        body: 'Corrigido',
        editedAt: '2026-09-16T12:05:00.000Z',
      });

      clock.advance(60_000);
      const same = await patchComment(own.id, { body: 'Corrigido' });
      expect(commentResponseSchema.parse(same.json()).comment.editedAt).toBe(
        '2026-09-16T12:05:00.000Z',
      );

      const other = await seedActor(db(), { role: 'member' }, clock.now());
      expectError(await patchComment(own.id, { body: 'Admin' }, admin.headers), 403, 'FORBIDDEN');
      expectError(await patchComment(own.id, { body: 'Outro' }, other.headers), 403, 'FORBIDDEN');
      expect((await detail(card.id)).comments[0]?.body).toBe('Corrigido');
    });

    it('400, 404, 403 antes de 409, 409 BOARD_ARCHIVED para o autor, CSRF, 401', async () => {
      const { board, card } = await newCard();
      const own = await comment(card.id, 'Original');
      for (const body of [{}, { body: '' }, { body: 'x'.repeat(10_001) }]) {
        expectError(await patchComment(own.id, body), 400, 'VALIDATION_ERROR');
      }
      expectError(await patchComment('x', { body: 'a' }), 400, 'VALIDATION_ERROR');
      expectError(await patchComment(MISSING_ID, { body: 'a' }), 404, 'NOT_FOUND');
      expectError(
        await patchComment(own.id, { body: 'a' }, { cookie: member.cookie }),
        403,
        'CSRF_REJECTED',
      );
      expectError(await patchComment(own.id, { body: 'a' }, csrfHeaders()), 401, 'UNAUTHENTICATED');

      await archiveBoard(board.id);
      expectError(await patchComment(own.id, { body: 'a' }, admin.headers), 403, 'FORBIDDEN');
      expectError(await patchComment(own.id, { body: 'a' }), 409, 'BOARD_ARCHIVED');
    });
  });

  describe('DELETE /api/comments/:commentId', () => {
    it('autor exclui; Admin exclui de outro; Member exclui de outro → 403', async () => {
      const { card } = await newCard();
      const byMember = await comment(card.id, 'do membro');
      const byAdmin = await comment(card.id, 'do admin', admin);
      const byMember2 = await comment(card.id, 'outro do membro');

      expectError(await deleteComment(byAdmin.id), 403, 'FORBIDDEN');

      const own = await deleteComment(byMember.id);
      expect(own.statusCode).toBe(204);
      expect(own.body).toBe('');
      const asAdmin = await deleteComment(byMember2.id, admin.headers);
      expect(asAdmin.statusCode).toBe(204);

      expect((await detail(card.id)).comments.map((c) => c.id)).toEqual([byAdmin.id]);
      expectError(await deleteComment(byMember.id), 404, 'NOT_FOUND');
    });

    it('400, 404, CSRF, 401, 403 antes de 409, 409 BOARD_ARCHIVED', async () => {
      const { board, card } = await newCard();
      const byAdmin = await comment(card.id, 'do admin', admin);
      expectError(await deleteComment('x'), 400, 'VALIDATION_ERROR');
      expectError(await deleteComment(MISSING_ID), 404, 'NOT_FOUND');
      expectError(await deleteComment(byAdmin.id, { cookie: admin.cookie }), 403, 'CSRF_REJECTED');
      expectError(await deleteComment(byAdmin.id, csrfHeaders()), 401, 'UNAUTHENTICATED');
      await archiveBoard(board.id);
      expectError(await deleteComment(byAdmin.id), 403, 'FORBIDDEN');
      expectError(await deleteComment(byAdmin.id, admin.headers), 409, 'BOARD_ARCHIVED');
      expect(await db().$count(comments)).toBe(1);
    });
  });
});
