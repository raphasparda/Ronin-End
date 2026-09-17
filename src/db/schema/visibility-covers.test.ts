import { eq, sql } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { describeDb, pgError, useTestDatabase } from '../../../test/db';
import { insertCard, insertCardGraph, insertUser } from '../test-fixtures';

import { cardCovers, cards, cardViewers, users } from './index';

/** Chave válida de capa: `covers/<cardId>/<32 caracteres base64url>` (ADR 0016). */
const coverKey = (cardId: string, suffix = 'abcdefghijklmnopqrstuvwxyz012345') =>
  `covers/${cardId}/${suffix}`;

describeDb('schema: visibilidade do card e capas (tarefa 11.2)', () => {
  const { db, pool } = useTestDatabase();

  it('card existente (gravado sem a coluna) fica com visibility team', async () => {
    const { user, list } = await insertCardGraph(db());
    // `INSERT` sem `visibility`, como faria o código anterior à migration 0008.
    await pool().query(
      `INSERT INTO cards (board_id, list_id, title, position, created_by)
       VALUES ($1, $2, 'Card antigo', 'z9', $3)`,
      [list.boardId, list.id, user.id],
    );
    const rows = await db().select({ visibility: cards.visibility }).from(cards);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.visibility === 'team')).toBe(true);
  });

  it('visibility só aceita os valores do enum', async () => {
    const { card } = await insertCardGraph(db());
    await db().update(cards).set({ visibility: 'restricted' }).where(eq(cards.id, card.id));
    const err = await pgError(
      db().execute(sql`UPDATE cards SET visibility = 'privado' WHERE id = ${card.id}`),
    );
    expect(err.code).toBe('22P02');
  });

  it('card_viewers: PK impede duplicata e o insert idempotente não duplica', async () => {
    const { user, card } = await insertCardGraph(db());
    const row = { cardId: card.id, userId: user.id, addedBy: user.id };
    await db().insert(cardViewers).values(row);
    expect(await pgError(db().insert(cardViewers).values(row))).toEqual({
      code: '23505',
      constraint: 'card_viewers_pkey',
    });
    const again = await db().insert(cardViewers).values(row).onConflictDoNothing().returning();
    expect(again).toHaveLength(0);
    expect(await db().$count(cardViewers)).toBe(1);
  });

  it('card_viewers: usuário não é excluído; excluir o card leva a lista junto', async () => {
    const { user, list, card } = await insertCardGraph(db());
    const member = await insertUser(db());
    await db().insert(cardViewers).values({ cardId: card.id, userId: member.id, addedBy: user.id });
    expect(await pgError(db().delete(users).where(eq(users.id, member.id)))).toEqual({
      code: '23001',
      constraint: 'card_viewers_user_id_users_id_fk',
    });

    const other = await insertCard(db(), list, user.id, { position: 'b0' });
    await db()
      .insert(cardViewers)
      .values({ cardId: other.id, userId: member.id, addedBy: user.id });
    await db().delete(cards).where(eq(cards.id, card.id));
    expect(await db().$count(cardViewers)).toBe(1);
  });

  it('card_covers: uma capa por card e a chave tem de ser do próprio card', async () => {
    const { user, list, card } = await insertCardGraph(db());
    const other = await insertCard(db(), list, user.id, { position: 'b0' });
    const cover = {
      cardId: card.id,
      objectKey: coverKey(card.id),
      contentType: 'image/png',
      sizeBytes: 1024,
      uploadedBy: user.id,
    };
    await db().insert(cardCovers).values(cover);

    // Segunda capa no mesmo card: PK (card_id).
    expect(
      await pgError(
        db()
          .insert(cardCovers)
          .values({ ...cover, objectKey: coverKey(card.id, 'ZYXWVUTSRQPONMLKJIHGFEDCBA098765') }),
      ),
    ).toMatchObject({ code: '23505' });

    // Chave de outro card (IDOR de objectKey) e chave fora do formato: o CHECK barra antes do
    // UNIQUE, então nem a chave já usada por outro card entra.
    expect(
      await pgError(
        db()
          .insert(cardCovers)
          .values({ ...cover, cardId: other.id, objectKey: coverKey(card.id) }),
      ),
    ).toEqual({ code: '23514', constraint: 'card_covers_object_key_check' });
    expect(
      await pgError(
        db()
          .insert(cardCovers)
          .values({
            ...cover,
            cardId: other.id,
            objectKey: `covers/${card.id}/outrachave1234567890123456789012`,
          }),
      ),
    ).toEqual({ code: '23514', constraint: 'card_covers_object_key_check' });
    expect(
      await pgError(
        db()
          .insert(cardCovers)
          .values({ ...cover, cardId: other.id, objectKey: `covers/${other.id}/curta` }),
      ),
    ).toEqual({ code: '23514', constraint: 'card_covers_object_key_check' });
  });

  it('card_covers: tipo, tamanho e dimensões fora da regra são recusados', async () => {
    const { user, card } = await insertCardGraph(db());
    const cover = {
      cardId: card.id,
      objectKey: coverKey(card.id),
      contentType: 'image/png',
      sizeBytes: 1024,
      uploadedBy: user.id,
    };
    expect(
      await pgError(
        db()
          .insert(cardCovers)
          .values({ ...cover, contentType: 'image/svg+xml' }),
      ),
    ).toEqual({ code: '23514', constraint: 'card_covers_content_type_check' });
    expect(
      await pgError(
        db()
          .insert(cardCovers)
          .values({ ...cover, sizeBytes: 0 }),
      ),
    ).toEqual({
      code: '23514',
      constraint: 'card_covers_size_check',
    });
    expect(
      await pgError(
        db()
          .insert(cardCovers)
          .values({ ...cover, sizeBytes: 5 * 1024 * 1024 + 1 }),
      ),
    ).toEqual({ code: '23514', constraint: 'card_covers_size_check' });
    expect(
      await pgError(
        db()
          .insert(cardCovers)
          .values({ ...cover, width: 20_001 }),
      ),
    ).toEqual({
      code: '23514',
      constraint: 'card_covers_dimensions_check',
    });

    // Limites aceitos: 5 MiB exatos e dimensões nulas.
    await db()
      .insert(cardCovers)
      .values({ ...cover, sizeBytes: 5 * 1024 * 1024 });
    expect(await db().$count(cardCovers)).toBe(1);
  });

  it('card_covers: excluir o card apaga a linha da capa (cascata)', async () => {
    const { user, card } = await insertCardGraph(db());
    await db()
      .insert(cardCovers)
      .values({
        cardId: card.id,
        objectKey: coverKey(card.id),
        contentType: 'image/webp',
        sizeBytes: 2048,
        uploadedBy: user.id,
      });
    await db().delete(cards).where(eq(cards.id, card.id));
    expect(await db().$count(cardCovers)).toBe(0);
  });
});
