import { eq, sql } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { describeDb, pgError, useTestDatabase } from '../../../test/db';
import { insertCardGraph, insertComment, insertUser } from '../test-fixtures';

import { boards, cards, comments, notifications, type NewNotificationRow } from './index';

describeDb('schema: notifications (tarefa 7.2)', () => {
  const { db } = useTestDatabase();

  async function setup() {
    const graph = await insertCardGraph(db());
    const recipient = await insertUser(db());
    const base: NewNotificationRow = {
      userId: recipient.id,
      actorId: graph.user.id,
      cardId: graph.card.id,
      type: 'card_assigned',
    };
    return { ...graph, recipient, base };
  }

  it('grava atribuição e comentário; read_at nulo por padrão', async () => {
    const { user, card, base } = await setup();
    const comment = await insertComment(db(), card.id, user.id);
    const rows = await db()
      .insert(notifications)
      .values([base, { ...base, type: 'card_commented', commentId: comment.id }])
      .returning();
    expect(rows.every((r) => r.readAt === null)).toBe(true);
  });

  it('RN18: ninguém é notificado da própria ação', async () => {
    const { user, base } = await setup();
    expect(
      await pgError(
        db()
          .insert(notifications)
          .values({ ...base, userId: user.id }),
      ),
    ).toEqual({
      code: '23514',
      constraint: 'notifications_not_self_check',
    });
  });

  it('atribuição não referencia comentário; tipo fora do enum rejeitado', async () => {
    const { user, card, base, recipient } = await setup();
    const comment = await insertComment(db(), card.id, user.id);
    expect(
      await pgError(
        db()
          .insert(notifications)
          .values({ ...base, commentId: comment.id }),
      ),
    ).toEqual({ code: '23514', constraint: 'notifications_comment_type_check' });
    const err = await pgError(
      db().execute(
        sql`INSERT INTO notifications (user_id, actor_id, card_id, type)
            VALUES (${recipient.id}, ${user.id}, ${card.id}, 'xp_level_up')`,
      ),
    );
    expect(err.code).toBe('22P02');
  });

  it('excluir comentário mantém a notificação com comment_id nulo', async () => {
    const { user, card, base } = await setup();
    const comment = await insertComment(db(), card.id, user.id);
    await db()
      .insert(notifications)
      .values({ ...base, type: 'card_commented', commentId: comment.id });
    await db().delete(comments).where(eq(comments.id, comment.id));
    const [row] = await db().select().from(notifications);
    expect(row).toMatchObject({ type: 'card_commented', commentId: null });
  });

  it('cascata ao excluir card e quadro', async () => {
    const { board, card, base } = await setup();
    await db().insert(notifications).values(base);
    await db().delete(cards).where(eq(cards.id, card.id));
    expect(await db().$count(notifications)).toBe(0);

    const again = await setup();
    await db().insert(notifications).values(again.base);
    await db().delete(boards).where(eq(boards.id, again.board.id));
    expect(await db().$count(notifications)).toBe(0);
    expect(board.id).not.toBe(again.board.id);
  });
});
