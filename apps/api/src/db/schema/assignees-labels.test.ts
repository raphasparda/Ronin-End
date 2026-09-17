import { eq, sql } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { describeDb, pgError, useTestDatabase } from '../../../test/db';
import { insertCard, insertCardGraph, insertLabel, insertUser } from '../test-fixtures';

import { boards, cardAssignees, cardLabels, cards, labels, users } from './index';

describeDb('schema: card_assignees, labels, card_labels (tarefa 5.2)', () => {
  const { db } = useTestDatabase();

  it('responsáveis: PK (card, usuário) impede duplicata; insert idempotente não duplica', async () => {
    const { user, card } = await insertCardGraph(db());
    const member = await insertUser(db());
    const row = { cardId: card.id, userId: member.id, assignedBy: user.id };
    await db().insert(cardAssignees).values(row);
    expect(await pgError(db().insert(cardAssignees).values(row))).toEqual({
      code: '23505',
      constraint: 'card_assignees_pkey',
    });
    const again = await db().insert(cardAssignees).values(row).onConflictDoNothing().returning();
    expect(again).toHaveLength(0);
    expect(await db().$count(cardAssignees)).toBe(1);
  });

  it('responsáveis: FK de usuário restrita e cascata ao excluir card', async () => {
    const { user, list, card } = await insertCardGraph(db());
    const member = await insertUser(db());
    expect(
      await pgError(
        db().insert(cardAssignees).values({
          cardId: card.id,
          userId: '00000000-0000-4000-8000-000000000000',
          assignedBy: user.id,
        }),
      ),
    ).toEqual({ code: '23503', constraint: 'card_assignees_user_id_users_id_fk' });

    await db()
      .insert(cardAssignees)
      .values({ cardId: card.id, userId: member.id, assignedBy: user.id });
    expect(await pgError(db().delete(users).where(eq(users.id, member.id)))).toEqual({
      code: '23001',
      constraint: 'card_assignees_user_id_users_id_fk',
    });

    const card2 = await insertCard(db(), list, user.id, { position: 'b0' });
    await db()
      .insert(cardAssignees)
      .values({ cardId: card2.id, userId: member.id, assignedBy: user.id });
    await db().delete(cards).where(eq(cards.id, card.id));
    expect(await db().$count(cardAssignees)).toBe(1);
  });

  it('etiqueta: nome 1–50 e cor só da paleta', async () => {
    const { board } = await insertCardGraph(db());
    const label = await insertLabel(db(), board.id);
    expect(label).toMatchObject({ color: 'red', name: 'Bug' });
    expect(
      await pgError(db().insert(labels).values({ boardId: board.id, name: '', color: 'green' })),
    ).toEqual({ code: '23514', constraint: 'labels_name_length_check' });
    expect(
      await pgError(
        db()
          .insert(labels)
          .values({ boardId: board.id, name: 'x'.repeat(51), color: 'green' }),
      ),
    ).toMatchObject({ constraint: 'labels_name_length_check' });
    const err = await pgError(
      db().execute(
        sql`INSERT INTO labels (board_id, name, color) VALUES (${board.id}, 'Rosa', 'pink')`,
      ),
    );
    expect(err.code).toBe('22P02');
  });

  it('card_labels: PK impede duplicata; excluir etiqueta remove de todos os cards', async () => {
    const { user, board, list, card } = await insertCardGraph(db());
    const card2 = await insertCard(db(), list, user.id, { position: 'b0' });
    const label = await insertLabel(db(), board.id);
    await db()
      .insert(cardLabels)
      .values([
        { cardId: card.id, labelId: label.id },
        { cardId: card2.id, labelId: label.id },
      ]);
    expect(
      await pgError(db().insert(cardLabels).values({ cardId: card.id, labelId: label.id })),
    ).toEqual({ code: '23505', constraint: 'card_labels_pkey' });

    await db().delete(labels).where(eq(labels.id, label.id));
    expect(await db().$count(cardLabels)).toBe(0);
  });

  it('excluir quadro remove etiquetas, aplicações e responsáveis em cascata', async () => {
    const { user, board, card } = await insertCardGraph(db());
    const label = await insertLabel(db(), board.id);
    await db().insert(cardLabels).values({ cardId: card.id, labelId: label.id });
    await db()
      .insert(cardAssignees)
      .values({ cardId: card.id, userId: user.id, assignedBy: user.id });
    await db().delete(boards).where(eq(boards.id, board.id));
    expect(await db().$count(labels)).toBe(0);
    expect(await db().$count(cardLabels)).toBe(0);
    expect(await db().$count(cardAssignees)).toBe(0);
  });
});
