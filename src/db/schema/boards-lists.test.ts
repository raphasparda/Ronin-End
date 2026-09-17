import { eq, sql } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { describeDb, pgError, useTestDatabase } from '../../../test/db';
import { insertBoard, insertList, insertUser } from '../test-fixtures';

import { boards, lists, users } from './index';

describeDb('schema: boards e lists (tarefa 3.2)', () => {
  const { db } = useTestDatabase();

  async function setup() {
    const user = await insertUser(db());
    const board = await insertBoard(db(), user.id);
    return { user, board };
  }

  it('quadro: nome 1–100 e criador obrigatório (FK restrita)', async () => {
    const user = await insertUser(db());
    expect(await pgError(insertBoard(db(), user.id, { name: '' }))).toEqual({
      code: '23514',
      constraint: 'boards_name_length_check',
    });
    expect(await pgError(insertBoard(db(), user.id, { name: 'x'.repeat(101) }))).toMatchObject({
      constraint: 'boards_name_length_check',
    });
    await insertBoard(db(), user.id);
    expect(await pgError(db().delete(users).where(eq(users.id, user.id)))).toEqual({
      code: '23001',
      constraint: 'boards_created_by_users_id_fk',
    });
  });

  it('lista: defaults e nome 1–100', async () => {
    const { board } = await setup();
    const list = await insertList(db(), board.id);
    expect(list).toMatchObject({ isDoneList: false, archivedAt: null, color: 'blue' });
    expect(await pgError(insertList(db(), board.id, { name: '', position: 'a1' }))).toEqual({
      code: '23514',
      constraint: 'lists_name_length_check',
    });
  });

  it('cor: obrigatória e só valores da paleta', async () => {
    const { board } = await setup();
    expect(
      await pgError(
        db().execute(
          sql`INSERT INTO lists (board_id, name, position) VALUES (${board.id}, 'Sem cor', 'a0')`,
        ),
      ),
    ).toMatchObject({ code: '23502' });
    expect(
      (
        await pgError(
          db().execute(
            sql`INSERT INTO lists (board_id, name, position, color)
                VALUES (${board.id}, 'Rosa', 'a0', 'pink')`,
          ),
        )
      ).code,
    ).toBe('22P02');
    expect(
      (
        await pgError(
          db().execute(
            sql`INSERT INTO lists (board_id, name, position, color)
                VALUES (${board.id}, 'Hex', 'a0', '#ff0000')`,
          ),
        )
      ).code,
    ).toBe('22P02');
  });

  it('no máximo uma lista de conclusão por quadro (índice único parcial)', async () => {
    const { user, board } = await setup();
    const done = await insertList(db(), board.id, { position: 'a0', isDoneList: true });
    const other = await insertList(db(), board.id, { position: 'a1' });
    expect(await pgError(insertList(db(), board.id, { position: 'a2', isDoneList: true }))).toEqual(
      { code: '23505', constraint: 'lists_board_done_list_unique' },
    );
    expect(
      await pgError(db().update(lists).set({ isDoneList: true }).where(eq(lists.id, other.id))),
    ).toEqual({ code: '23505', constraint: 'lists_board_done_list_unique' });

    // Troca atômica (desmarca a anterior e marca a nova na mesma transação).
    await db().transaction(async (tx) => {
      await tx.update(lists).set({ isDoneList: false }).where(eq(lists.id, done.id));
      await tx.update(lists).set({ isDoneList: true }).where(eq(lists.id, other.id));
    });

    // Outro quadro tem a sua própria lista de conclusão.
    const board2 = await insertBoard(db(), user.id);
    await insertList(db(), board2.id, { isDoneList: true });
    expect(await db().$count(lists, eq(lists.isDoneList, true))).toBe(2);
  });

  it('lista de conclusão não pode estar arquivada', async () => {
    const { board } = await setup();
    const done = await insertList(db(), board.id, { isDoneList: true });
    expect(
      await pgError(
        db().update(lists).set({ archivedAt: new Date() }).where(eq(lists.id, done.id)),
      ),
    ).toEqual({ code: '23514', constraint: 'lists_done_list_not_archived_check' });
    await db()
      .update(lists)
      .set({ archivedAt: new Date(), isDoneList: false })
      .where(eq(lists.id, done.id));
  });

  it('posição única entre listas ativas; arquivada libera a posição', async () => {
    const { user, board } = await setup();
    const first = await insertList(db(), board.id, { position: 'a0' });
    expect(await pgError(insertList(db(), board.id, { position: 'a0' }))).toEqual({
      code: '23505',
      constraint: 'lists_board_position_active_unique',
    });
    await db().update(lists).set({ archivedAt: new Date() }).where(eq(lists.id, first.id));
    await insertList(db(), board.id, { position: 'a0' });
    // Mesma posição em outro quadro é permitida.
    const board2 = await insertBoard(db(), user.id);
    await insertList(db(), board2.id, { position: 'a0' });
    expect(await pgError(insertList(db(), board.id, { position: '' }))).toMatchObject({
      constraint: 'lists_position_not_empty_check',
    });
  });

  it('ordena position byte a byte no banco ("Zz" < "a")', async () => {
    const { board } = await setup();
    for (const position of ['a', 'Zz', 'a0', 'B']) {
      await insertList(db(), board.id, { position, name: position });
    }
    const rows = await db()
      .select({ position: lists.position })
      .from(lists)
      .where(eq(lists.boardId, board.id))
      .orderBy(lists.position);
    expect(rows.map((r) => r.position)).toEqual(['B', 'Zz', 'a', 'a0']);
    const [cmp] = (
      await db().execute<{ lt: boolean }>(
        sql`SELECT (SELECT position FROM lists WHERE name = 'Zz') < (SELECT position FROM lists WHERE name = 'a') AS lt`,
      )
    ).rows;
    expect(cmp?.lt).toBe(true);
  });

  it('excluir quadro remove as listas em cascata; board inexistente rejeitado', async () => {
    const { board } = await setup();
    await insertList(db(), board.id, { position: 'a0' });
    await insertList(db(), board.id, { position: 'a1', archivedAt: new Date() });
    await db().delete(boards).where(eq(boards.id, board.id));
    expect(await db().$count(lists)).toBe(0);
    expect(await pgError(insertList(db(), '00000000-0000-4000-8000-000000000000'))).toEqual({
      code: '23503',
      constraint: 'lists_board_id_boards_id_fk',
    });
  });
});
