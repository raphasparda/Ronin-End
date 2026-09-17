import { eq, sql } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { describeDb, pgError, useTestDatabase } from '../../../test/db';
import { insertBoard, insertCardGraph, insertUser } from '../test-fixtures';

import { boardCovers, boards, boardViewers, users } from './index';

/** Chave válida de capa: `covers/<boardId>/<32 caracteres base64url>` (ADR 0016). */
const coverKey = (boardId: string, suffix = 'abcdefghijklmnopqrstuvwxyz012345') =>
  `covers/${boardId}/${suffix}`;

describeDb('schema: visibilidade e capa do quadro (migration 0009)', () => {
  const { db, pool } = useTestDatabase();

  it('quadro existente (gravado sem a coluna) fica com visibility team', async () => {
    const { board, user } = await insertCardGraph(db());
    // `INSERT` sem `visibility`, como faria o código anterior à migration 0009.
    await pool().query(`INSERT INTO boards (name, created_by) VALUES ('Quadro antigo', $1)`, [
      user.id,
    ]);
    const rows = await db().select({ visibility: boards.visibility }).from(boards);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.visibility === 'team')).toBe(true);
    expect(board.visibility).toBe('team');
  });

  it('visibility só aceita os valores do enum', async () => {
    const { board } = await insertCardGraph(db());
    await db().update(boards).set({ visibility: 'restricted' }).where(eq(boards.id, board.id));
    const err = await pgError(
      db().execute(sql`UPDATE boards SET visibility = 'privado' WHERE id = ${board.id}`),
    );
    expect(err.code).toBe('22P02');
  });

  it('board_viewers: PK impede duplicata e o insert idempotente não duplica', async () => {
    const { user, board } = await insertCardGraph(db());
    const row = { boardId: board.id, userId: user.id, addedBy: user.id };
    await db().insert(boardViewers).values(row);
    expect(await pgError(db().insert(boardViewers).values(row))).toEqual({
      code: '23505',
      constraint: 'board_viewers_pkey',
    });
    const again = await db().insert(boardViewers).values(row).onConflictDoNothing().returning();
    expect(again).toHaveLength(0);
    expect(await db().$count(boardViewers)).toBe(1);
  });

  it('board_viewers: usuário não é excluído; excluir o quadro leva a lista junto', async () => {
    const { user, board } = await insertCardGraph(db());
    const member = await insertUser(db());
    await db()
      .insert(boardViewers)
      .values({ boardId: board.id, userId: member.id, addedBy: user.id });
    expect(await pgError(db().delete(users).where(eq(users.id, member.id)))).toEqual({
      code: '23001',
      constraint: 'board_viewers_user_id_users_id_fk',
    });

    const other = await insertBoard(db(), user.id, { name: 'Outro' });
    await db()
      .insert(boardViewers)
      .values({ boardId: other.id, userId: member.id, addedBy: user.id });
    await db().delete(boards).where(eq(boards.id, board.id));
    expect(await db().$count(boardViewers)).toBe(1);
  });

  it('board_covers: uma capa por quadro e a chave tem de ser do próprio quadro', async () => {
    const { user, board } = await insertCardGraph(db());
    const other = await insertBoard(db(), user.id, { name: 'Outro' });
    const cover = {
      boardId: board.id,
      objectKey: coverKey(board.id),
      contentType: 'image/png',
      sizeBytes: 1024,
      uploadedBy: user.id,
    };
    await db().insert(boardCovers).values(cover);

    // Segunda capa no mesmo quadro: PK (board_id).
    expect(
      await pgError(
        db()
          .insert(boardCovers)
          .values({ ...cover, objectKey: coverKey(board.id, 'ZYXWVUTSRQPONMLKJIHGFEDCBA098765') }),
      ),
    ).toMatchObject({ code: '23505' });

    // Chave de outro quadro (IDOR de objectKey) e chave fora do formato: o CHECK barra antes do
    // UNIQUE, então nem a chave já usada por outro quadro entra.
    expect(
      await pgError(
        db()
          .insert(boardCovers)
          .values({ ...cover, boardId: other.id, objectKey: coverKey(board.id) }),
      ),
    ).toEqual({ code: '23514', constraint: 'board_covers_object_key_check' });
    expect(
      await pgError(
        db()
          .insert(boardCovers)
          .values({
            ...cover,
            boardId: other.id,
            objectKey: `covers/${board.id}/outrachave1234567890123456789012`,
          }),
      ),
    ).toEqual({ code: '23514', constraint: 'board_covers_object_key_check' });
    expect(
      await pgError(
        db()
          .insert(boardCovers)
          .values({ ...cover, boardId: other.id, objectKey: `covers/${other.id}/curta` }),
      ),
    ).toEqual({ code: '23514', constraint: 'board_covers_object_key_check' });
  });

  it('board_covers: tipo, tamanho e dimensões fora da regra são recusados', async () => {
    const { user, board } = await insertCardGraph(db());
    const cover = {
      boardId: board.id,
      objectKey: coverKey(board.id),
      contentType: 'image/png',
      sizeBytes: 1024,
      uploadedBy: user.id,
    };
    expect(
      await pgError(
        db()
          .insert(boardCovers)
          .values({ ...cover, contentType: 'image/svg+xml' }),
      ),
    ).toEqual({ code: '23514', constraint: 'board_covers_content_type_check' });
    expect(
      await pgError(
        db()
          .insert(boardCovers)
          .values({ ...cover, sizeBytes: 0 }),
      ),
    ).toEqual({
      code: '23514',
      constraint: 'board_covers_size_check',
    });
    expect(
      await pgError(
        db()
          .insert(boardCovers)
          .values({ ...cover, sizeBytes: 5 * 1024 * 1024 + 1 }),
      ),
    ).toEqual({ code: '23514', constraint: 'board_covers_size_check' });
    expect(
      await pgError(
        db()
          .insert(boardCovers)
          .values({ ...cover, width: 20_001 }),
      ),
    ).toEqual({
      code: '23514',
      constraint: 'board_covers_dimensions_check',
    });

    // Limites aceitos: 5 MiB exatos e dimensões nulas.
    await db()
      .insert(boardCovers)
      .values({ ...cover, sizeBytes: 5 * 1024 * 1024 });
    expect(await db().$count(boardCovers)).toBe(1);
  });

  it('board_covers: excluir o quadro apaga a linha da capa (cascata)', async () => {
    const { user, board } = await insertCardGraph(db());
    await db()
      .insert(boardCovers)
      .values({
        boardId: board.id,
        objectKey: coverKey(board.id),
        contentType: 'image/webp',
        sizeBytes: 2048,
        uploadedBy: user.id,
      });
    await db().delete(boards).where(eq(boards.id, board.id));
    expect(await db().$count(boardCovers)).toBe(0);
  });
});
