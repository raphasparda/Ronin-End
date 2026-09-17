import { createBoardResponseSchema, myCardsResponseSchema } from '@kanban/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { expectError, seedTeam, type Actor } from '../../../test/actors';
import { createDbTestApp, createTestClock } from '../../../test/auth';
import { describeDb, useTestDatabase } from '../../../test/db';
import type { App } from '../../app';
import {
  cardAssignees,
  cardLabels,
  cards,
  lists,
  type CardRow,
  type ListRow,
} from '../../db/schema';
import {
  insertBoard,
  insertChecklist,
  insertComment,
  insertLabel,
  insertList,
} from '../../db/test-fixtures';

describeDb('GET /api/me/cards (kanban_test)', () => {
  const { db } = useTestDatabase();
  const clock = createTestClock();
  let app: App;
  let admin: Actor;
  let member: Actor;
  let positionCounter = 0;

  beforeEach(async () => {
    positionCounter = 0;
    clock.set(new Date('2026-09-16T12:00:00.000Z'));
    app = await createDbTestApp({ clock: clock.now });
    ({ admin, member } = await seedTeam(db(), clock.now()));
  });

  afterEach(async () => {
    await app.close();
  });

  const myCardsRes = (actor: Actor) =>
    app.inject({ method: 'GET', url: '/api/me/cards', headers: { cookie: actor.cookie } });

  const myCards = async (actor: Actor = member) => {
    const res = await myCardsRes(actor);
    expect(res.statusCode).toBe(200);
    return myCardsResponseSchema.strict().parse(res.json()).cards;
  };

  async function addCard(
    list: Pick<ListRow, 'id' | 'boardId'>,
    overrides: Partial<typeof cards.$inferInsert> = {},
    assignees: string[] = [member.user.id],
  ): Promise<CardRow> {
    positionCounter += 1;
    const [row] = await db()
      .insert(cards)
      .values({
        boardId: list.boardId,
        listId: list.id,
        title: `Card ${positionCounter}`,
        position: `a${String(positionCounter).padStart(4, '0')}`,
        createdBy: admin.user.id,
        createdAt: clock.now(),
        updatedAt: clock.now(),
        ...overrides,
      })
      .returning();
    if (!row) throw new Error('insert falhou');
    for (const userId of assignees) {
      await db()
        .insert(cardAssignees)
        .values({ cardId: row.id, userId, assignedBy: admin.user.id });
    }
    return row;
  }

  const at = (iso: string) => new Date(iso);

  it('exclui concluídos, arquivados, de lista/quadro arquivado e de outras pessoas; traz quadro e lista', async () => {
    const board = await insertBoard(db(), admin.user.id, { name: 'Marketing' });
    const list = await insertList(db(), board.id, { name: 'A fazer', color: 'magenta' });
    const archivedList = await insertList(db(), board.id, {
      name: 'Velha',
      position: 'b0',
      archivedAt: clock.now(),
    });
    const archivedBoard = await insertBoard(db(), admin.user.id, {
      name: 'Arquivado',
      archivedAt: clock.now(),
    });
    const listInArchivedBoard = await insertList(db(), archivedBoard.id);

    const mine = await addCard(
      list,
      {
        title: 'Meu',
        dueAt: at('2026-09-20T15:00:00.000Z'),
        dueHasTime: true,
        priority: 'high',
        description: 'algo',
      },
      [admin.user.id, member.user.id],
    );
    const label = await insertLabel(db(), board.id);
    await db().insert(cardLabels).values({ cardId: mine.id, labelId: label.id });
    await insertComment(db(), mine.id, admin.user.id);
    await insertChecklist(db(), mine.id);

    await addCard(list, {
      status: 'completed',
      completedAt: clock.now(),
      completedBy: admin.user.id,
    });
    await addCard(list, { archivedAt: clock.now() });
    await addCard(archivedList);
    await addCard(listInArchivedBoard);
    await addCard(list, {}, [admin.user.id]); // de outra pessoa
    await addCard(list, {}, []); // sem responsáveis

    expect(await myCards()).toEqual([
      {
        id: mine.id,
        boardId: board.id,
        listId: list.id,
        title: 'Meu',
        position: mine.position,
        status: 'open',
        completedAt: null,
        dueAt: '2026-09-20T15:00:00.000Z',
        dueHasTime: true,
        priority: 'high',
        labelIds: [label.id],
        assigneeIds: [admin.user.id, member.user.id],
        checklist: { done: 0, total: 0 },
        commentCount: 1,
        hasDescription: true,
        archivedAt: null,
        boardName: 'Marketing',
        listName: 'A fazer',
        listColor: 'magenta',
      },
    ]);
    expect((await myCards(admin)).map((c) => c.title)).toEqual(['Meu', 'Card 6']);
  });

  it('ordem: dueAt ASC NULLS LAST → prioridade (urgent → sem) → createdAt', async () => {
    const board = await insertBoard(db(), admin.user.id);
    const list = await insertList(db(), board.id);
    const due = at('2026-09-18T12:00:00.000Z');
    const t = (s: number) => new Date(Date.parse('2026-09-01T00:00:00.000Z') + s * 1000);

    // Inseridos fora de ordem de propósito.
    const noDueOld = await addCard(list, { title: 'sem prazo, sem prioridade', createdAt: t(1) });
    const noDueUrgent = await addCard(list, {
      title: 'sem prazo, urgente',
      priority: 'urgent',
      createdAt: t(9),
    });
    const tieLow = await addCard(list, {
      title: 'empate low',
      dueAt: due,
      priority: 'low',
      createdAt: t(2),
    });
    const tieNone = await addCard(list, { title: 'empate sem', dueAt: due, createdAt: t(3) });
    const tieHighNew = await addCard(list, {
      title: 'empate high novo',
      dueAt: due,
      priority: 'high',
      createdAt: t(8),
    });
    const tieHighOld = await addCard(list, {
      title: 'empate high velho',
      dueAt: due,
      priority: 'high',
      createdAt: t(4),
    });
    const tieUrgent = await addCard(list, {
      title: 'empate urgente',
      dueAt: due,
      priority: 'urgent',
      createdAt: t(5),
    });
    const tieMedium = await addCard(list, {
      title: 'empate medium',
      dueAt: due,
      priority: 'medium',
      createdAt: t(6),
    });
    const overdue = await addCard(list, {
      title: 'atrasado',
      dueAt: at('2026-09-10T00:00:00.000Z'),
      createdAt: t(7),
    });
    const later = await addCard(list, {
      title: 'depois',
      dueAt: at('2026-10-01T00:00:00.000Z'),
      priority: 'urgent',
      createdAt: t(0),
    });
    const noDueNew = await addCard(list, { title: 'sem prazo novo', createdAt: t(10) });

    expect((await myCards()).map((c) => c.id)).toEqual([
      overdue.id,
      tieUrgent.id,
      tieHighOld.id,
      tieHighNew.id,
      tieMedium.id,
      tieLow.id,
      tieNone.id,
      later.id,
      noDueUrgent.id,
      noDueOld.id,
      noDueNew.id,
    ]);
  });

  it('card sai ao concluir e volta ao reabrir; 401 sem sessão', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/boards',
      headers: member.headers,
      payload: { name: 'Quadro' },
    });
    const boardId = createBoardResponseSchema.parse(res.json()).board.id;
    const [todo] = await db()
      .select()
      .from(lists)
      .where(eq(lists.boardId, boardId))
      .orderBy(lists.position);
    if (!todo) throw new Error('lista ausente');
    const c = await addCard(todo);
    expect((await myCards()).map((x) => x.id)).toEqual([c.id]);

    const complete = await app.inject({
      method: 'POST',
      url: `/api/cards/${c.id}/complete`,
      headers: member.headers,
    });
    expect(complete.statusCode).toBe(200);
    expect(await myCards()).toEqual([]);

    const reopen = await app.inject({
      method: 'POST',
      url: `/api/cards/${c.id}/reopen`,
      headers: member.headers,
    });
    expect(reopen.statusCode).toBe(200);
    expect(await myCards()).toMatchObject([{ id: c.id, listId: todo.id, listName: 'A fazer' }]);

    expectError(await app.inject({ method: 'GET', url: '/api/me/cards' }), 401, 'UNAUTHENTICATED');
  });

  it('1.000 cards atribuídos em até 1 s', async () => {
    const boards = await Promise.all([
      insertBoard(db(), admin.user.id, { name: 'Um' }),
      insertBoard(db(), admin.user.id, { name: 'Dois' }),
    ]);
    const listsRows: ListRow[] = [];
    for (const board of boards) {
      for (let i = 0; i < 5; i++) {
        listsRows.push(await insertList(db(), board.id, { position: `a${i}` }));
      }
    }
    const values = Array.from({ length: 1_000 }, (_, i) => {
      const list = listsRows[i % listsRows.length] as ListRow;
      return {
        boardId: list.boardId,
        listId: list.id,
        title: `Card ${i}`,
        position: `a${String(i).padStart(5, '0')}`,
        createdBy: admin.user.id,
        dueAt: i % 3 === 0 ? null : new Date(Date.parse('2026-09-01T00:00:00.000Z') + i * 60_000),
        priority: (['low', 'medium', 'high', 'urgent', null] as const)[i % 5],
      };
    });
    const inserted = await db().insert(cards).values(values).returning({ id: cards.id });
    await db()
      .insert(cardAssignees)
      .values(
        inserted.map((row) => ({
          cardId: row.id,
          userId: member.user.id,
          assignedBy: admin.user.id,
        })),
      );
    // Ruído: os mesmos cards também atribuídos ao Admin.
    await db()
      .insert(cardAssignees)
      .values(
        inserted.map((row) => ({
          cardId: row.id,
          userId: admin.user.id,
          assignedBy: admin.user.id,
        })),
      );
    await myCards(); // aquece conexões e planos

    const started = performance.now();
    const result = await myCards();
    const elapsed = performance.now() - started;
    expect(result).toHaveLength(1_000);
    expect(elapsed).toBeLessThan(1_000);
  });
});
