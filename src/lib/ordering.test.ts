import { eq } from 'drizzle-orm';
import { beforeEach, expect, it } from 'vitest';

import { describeDb, useTestDatabase } from '../../test/db';
import type { Database } from '../db/client';
import { lists } from '../db/schema';
import { insertBoard, insertList, insertUser } from '../db/test-fixtures';

import { AppError } from './app-error';
import { computePosition, LIST_SIBLINGS, MAX_POSITION_LENGTH } from './ordering';

describeDb('computePosition (ronin_test)', () => {
  const { db } = useTestDatabase();
  let boardId: string;

  beforeEach(async () => {
    const user = await insertUser(db());
    boardId = (await insertBoard(db(), user.id)).id;
  });

  const place = (
    database: Database,
    ...args: Parameters<typeof computePosition> extends [unknown, unknown, unknown, ...infer R]
      ? R
      : never
  ) => database.transaction((tx) => computePosition(tx, LIST_SIBLINGS, boardId, ...args));

  const orderedIds = async () =>
    (
      await db()
        .select({ id: lists.id, position: lists.position })
        .from(lists)
        .where(eq(lists.boardId, boardId))
    )
      .sort((a, b) => (a.position < b.position ? -1 : 1))
      .map((r) => r.id);

  it('pai vazio: start e end geram a chave inicial', async () => {
    expect(await place(db(), { type: 'start' }, null)).toBe('a0');
    expect(await place(db(), { type: 'end' }, null)).toBe('a0');
  });

  it('start, end e after entre irmãos ativos, ignorando arquivados e o próprio item', async () => {
    const a = await insertList(db(), boardId, { position: 'a0' });
    const b = await insertList(db(), boardId, { position: 'a1' });
    await insertList(db(), boardId, { position: 'a5', archivedAt: new Date() });

    const start = await place(db(), { type: 'start' }, null);
    expect(start < 'a0').toBe(true);
    const end = await place(db(), { type: 'end' }, null);
    expect(end > 'a1').toBe(true);
    expect(end).toBe('a2');
    const after = await place(db(), { type: 'after', id: a.id }, null);
    expect(after > 'a0' && after < 'a1').toBe(true);
    // Movendo `b` para o fim: ele mesmo não conta.
    expect(await place(db(), { type: 'end' }, b.id)).toBe('a1');
  });

  it('after inválido → INVALID_PLACEMENT', async () => {
    const a = await insertList(db(), boardId, { position: 'a0' });
    const archived = await insertList(db(), boardId, { position: 'a1', archivedAt: new Date() });
    const otherBoard = await insertBoard(db(), (await insertUser(db())).id);
    const foreign = await insertList(db(), otherBoard.id, { position: 'a0' });

    for (const [id, exclude] of [
      [a.id, a.id],
      [archived.id, null],
      [foreign.id, null],
      ['00000000-0000-4000-8000-000000000000', null],
    ] as const) {
      const err = await place(db(), { type: 'after', id }, exclude).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('INVALID_PLACEMENT');
    }
  });

  it('ordenação binária no banco: "Zz" vem antes de "a0"', async () => {
    const lower = await insertList(db(), boardId, { position: 'a0' });
    const upper = await insertList(db(), boardId, { position: 'Zz' });
    expect(await orderedIds()).toEqual([upper.id, lower.id]);
    const start = await place(db(), { type: 'start' }, null);
    expect(start < 'Zz').toBe(true);
  });

  it('chave acima de 64 caracteres rebalanceia os irmãos preservando a ordem', async () => {
    const base = `a0${'V'.repeat(MAX_POSITION_LENGTH - 2)}`;
    const first = await insertList(db(), boardId, { name: 'Primeira', position: 'Zz' });
    const anchor = await insertList(db(), boardId, { name: 'Âncora', position: base });
    const next = await insertList(db(), boardId, { name: 'Próxima', position: `${base}W` });
    const last = await insertList(db(), boardId, { name: 'Última', position: 'b00' });
    const archived = await insertList(db(), boardId, { position: 'a1', archivedAt: new Date() });

    const moving = await insertList(db(), boardId, { name: 'Movida', position: 'Zy' });

    const key = await db().transaction(async (tx) => {
      const k = await computePosition(
        tx,
        LIST_SIBLINGS,
        boardId,
        { type: 'after', id: anchor.id },
        moving.id,
      );
      await tx.update(lists).set({ position: k }).where(eq(lists.id, moving.id));
      return k;
    });

    expect(key.length).toBeLessThanOrEqual(MAX_POSITION_LENGTH);

    const active = (await db().select().from(lists).where(eq(lists.boardId, boardId)))
      .filter((r) => r.archivedAt === null)
      .sort((a, b) => (a.position < b.position ? -1 : 1));
    expect(active.map((r) => r.id)).toEqual([first.id, anchor.id, moving.id, next.id, last.id]);
    expect(active.every((r) => r.position.length <= 3)).toBe(true);
    const [archivedRow] = await db().select().from(lists).where(eq(lists.id, archived.id));
    expect(archivedRow?.position).toBe('a1');
  });
});
