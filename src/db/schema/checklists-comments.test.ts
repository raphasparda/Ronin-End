import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { describeDb, pgError, useTestDatabase } from '../../../test/db';
import { insertCardGraph, insertChecklist, insertComment, insertUser } from '../test-fixtures';

import {
  cards,
  checklistItems,
  checklists,
  comments,
  users,
  type NewChecklistItemRow,
} from './index';

describeDb('schema: checklists, checklist_items, comments (tarefa 6.2)', () => {
  const { db } = useTestDatabase();

  async function setup() {
    const graph = await insertCardGraph(db());
    const checklist = await insertChecklist(db(), graph.card.id);
    const item = (overrides: Partial<NewChecklistItemRow> = {}) =>
      db()
        .insert(checklistItems)
        .values({ checklistId: checklist.id, text: 'Item', position: 'a0', ...overrides })
        .returning();
    return { ...graph, checklist, item };
  }

  it('checklist: título 1–200', async () => {
    const { card } = await insertCardGraph(db());
    expect(await pgError(db().insert(checklists).values({ cardId: card.id, title: '' }))).toEqual({
      code: '23514',
      constraint: 'checklists_title_length_check',
    });
    expect(
      await pgError(
        db()
          .insert(checklists)
          .values({ cardId: card.id, title: 'x'.repeat(201) }),
      ),
    ).toMatchObject({ constraint: 'checklists_title_length_check' });
  });

  it('item: defaults, texto 1–500 e posição única no checklist', async () => {
    const { item } = await setup();
    const [row] = await item();
    expect(row).toMatchObject({ isChecked: false, checkedBy: null, checkedAt: null });
    expect(await pgError(item({ position: 'a1', text: '' }))).toEqual({
      code: '23514',
      constraint: 'checklist_items_text_length_check',
    });
    expect(await pgError(item({ position: 'a1', text: 'x'.repeat(501) }))).toMatchObject({
      constraint: 'checklist_items_text_length_check',
    });
    expect(await pgError(item())).toEqual({
      code: '23505',
      constraint: 'checklist_items_checklist_position_unique',
    });
  });

  it('item marcado ⇔ checked_by e checked_at', async () => {
    const { user, item } = await setup();
    expect(await pgError(item({ isChecked: true }))).toEqual({
      code: '23514',
      constraint: 'checklist_items_checked_check',
    });
    expect(await pgError(item({ checkedBy: user.id, checkedAt: new Date() }))).toMatchObject({
      constraint: 'checklist_items_checked_check',
    });
    const [row] = await item({ isChecked: true, checkedBy: user.id, checkedAt: new Date() });
    await db()
      .update(checklistItems)
      .set({ isChecked: false, checkedBy: null, checkedAt: null })
      .where(eq(checklistItems.id, row?.id ?? ''));
  });

  it('itens ordenam por position byte a byte ("Zz" < "a")', async () => {
    const { checklist, item } = await setup();
    for (const position of ['a', 'Zz', 'a0', 'B']) await item({ position });
    const rows = await db()
      .select({ position: checklistItems.position })
      .from(checklistItems)
      .where(eq(checklistItems.checklistId, checklist.id))
      .orderBy(checklistItems.position);
    expect(rows.map((r) => r.position)).toEqual(['B', 'Zz', 'a', 'a0']);
  });

  it('excluir card remove checklists e itens em cascata', async () => {
    const { card, item } = await setup();
    await item();
    await db().delete(cards).where(eq(cards.id, card.id));
    expect(await db().$count(checklists)).toBe(0);
    expect(await db().$count(checklistItems)).toBe(0);
  });

  it('comentário: corpo 1–10.000, autor com FK restrita, cascata do card', async () => {
    const { user, card } = await insertCardGraph(db());
    const author = await insertUser(db());
    const comment = await insertComment(db(), card.id, author.id);
    expect(comment).toMatchObject({ editedAt: null });
    expect(
      await pgError(db().insert(comments).values({ cardId: card.id, authorId: user.id, body: '' })),
    ).toEqual({ code: '23514', constraint: 'comments_body_length_check' });
    expect(
      await pgError(
        db()
          .insert(comments)
          .values({ cardId: card.id, authorId: user.id, body: 'x'.repeat(10_001) }),
      ),
    ).toMatchObject({ constraint: 'comments_body_length_check' });
    await db()
      .insert(comments)
      .values({ cardId: card.id, authorId: user.id, body: 'x'.repeat(10_000) });

    expect(await pgError(db().delete(users).where(eq(users.id, author.id)))).toEqual({
      code: '23001',
      constraint: 'comments_author_id_users_id_fk',
    });
    await db().delete(cards).where(eq(cards.id, card.id));
    expect(await db().$count(comments)).toBe(0);
  });
});
