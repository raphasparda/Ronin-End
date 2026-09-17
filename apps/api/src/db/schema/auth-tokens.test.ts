import { eq, sql } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { describeDb, pgError, useTestDatabase } from '../../../test/db';
import { insertUser } from '../test-fixtures';

import { authTokens, users, type NewAuthTokenRow } from './index';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const DAY = 86_400_000;

describeDb('schema: auth_tokens (tarefa 2.2)', () => {
  const { db } = useTestDatabase();

  async function base(overrides: Partial<NewAuthTokenRow>): Promise<NewAuthTokenRow> {
    const admin = await insertUser(db(), { role: 'admin' });
    return {
      kind: 'invite',
      tokenHash: HASH_A,
      role: 'member',
      createdBy: admin.id,
      expiresAt: new Date(Date.now() + 7 * DAY),
      ...overrides,
    };
  }

  it('convite válido com e sem e-mail; defaults nulos', async () => {
    await db()
      .insert(authTokens)
      .values(await base({}));
    const [row] = await db()
      .insert(authTokens)
      .values(await base({ tokenHash: HASH_B, email: 'novo@exemplo.com', role: 'admin' }))
      .returning();
    expect(row).toMatchObject({ usedAt: null, revokedAt: null, targetUserId: null });
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(await db().$count(authTokens)).toBe(2);
  });

  it('CHECK de convite: exige role e não aceita alvo', async () => {
    expect(
      await pgError(
        db()
          .insert(authTokens)
          .values(await base({ role: null })),
      ),
    ).toEqual({ code: '23514', constraint: 'auth_tokens_invite_check' });

    const target = await insertUser(db());
    expect(
      await pgError(
        db()
          .insert(authTokens)
          .values(await base({ targetUserId: target.id })),
      ),
    ).toEqual({ code: '23514', constraint: 'auth_tokens_invite_check' });
  });

  it('CHECK de redefinição: exige alvo, sem role e sem e-mail', async () => {
    const target = await insertUser(db());
    await db()
      .insert(authTokens)
      .values(await base({ kind: 'password_reset', role: null, targetUserId: target.id }));

    expect(
      await pgError(
        db()
          .insert(authTokens)
          .values(await base({ kind: 'password_reset', role: null, tokenHash: HASH_B })),
      ),
    ).toEqual({ code: '23514', constraint: 'auth_tokens_password_reset_check' });
    expect(
      await pgError(
        db()
          .insert(authTokens)
          .values(
            await base({
              kind: 'password_reset',
              tokenHash: HASH_B,
              targetUserId: target.id,
              role: 'member',
            }),
          ),
      ),
    ).toEqual({ code: '23514', constraint: 'auth_tokens_password_reset_check' });
    expect(
      await pgError(
        db()
          .insert(authTokens)
          .values(
            await base({
              kind: 'password_reset',
              tokenHash: HASH_B,
              targetUserId: target.id,
              role: null,
              email: target.email,
            }),
          ),
      ),
    ).toEqual({ code: '23514', constraint: 'auth_tokens_password_reset_check' });
  });

  it('UNIQUE(token_hash) e só hash SHA-256 hex (nunca o token cru)', async () => {
    await db()
      .insert(authTokens)
      .values(await base({}));
    expect(
      await pgError(
        db()
          .insert(authTokens)
          .values(await base({})),
      ),
    ).toEqual({ code: '23505', constraint: 'auth_tokens_token_hash_unique' });
    expect(
      await pgError(
        db()
          .insert(authTokens)
          .values(await base({ tokenHash: 'Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXU' })),
      ),
    ).toEqual({ code: '23514', constraint: 'auth_tokens_token_hash_sha256_check' });
  });

  it('e-mail do convite precisa estar normalizado', async () => {
    expect(
      await pgError(
        db()
          .insert(authTokens)
          .values(await base({ email: 'Novo@Exemplo.com' })),
      ),
    ).toEqual({ code: '23514', constraint: 'auth_tokens_email_normalized_check' });
  });

  it('used_by_user_id exige used_at; consumo atômico só funciona uma vez', async () => {
    const [token] = await db()
      .insert(authTokens)
      .values(await base({}))
      .returning();
    const member = await insertUser(db());
    expect(
      await pgError(
        db()
          .update(authTokens)
          .set({ usedByUserId: member.id })
          .where(eq(authTokens.id, token?.id ?? '')),
      ),
    ).toEqual({ code: '23514', constraint: 'auth_tokens_used_by_check' });

    const consume = () =>
      db().execute(
        sql`UPDATE auth_tokens SET used_at = now()
             WHERE token_hash = ${HASH_A} AND used_at IS NULL AND revoked_at IS NULL
               AND expires_at > now()
         RETURNING id`,
      );
    expect((await consume()).rows).toHaveLength(1);
    expect((await consume()).rows).toHaveLength(0);
    await db()
      .update(authTokens)
      .set({ usedByUserId: member.id })
      .where(eq(authTokens.id, token?.id ?? ''));
  });

  it('FKs para users: alvo inexistente rejeitado; usuário referenciado não pode ser excluído', async () => {
    expect(
      await pgError(
        db()
          .insert(authTokens)
          .values(
            await base({
              kind: 'password_reset',
              role: null,
              targetUserId: '00000000-0000-4000-8000-000000000000',
            }),
          ),
      ),
    ).toEqual({ code: '23503', constraint: 'auth_tokens_target_user_id_users_id_fk' });

    const values = await base({});
    await db().insert(authTokens).values(values);
    expect(await pgError(db().delete(users).where(eq(users.id, values.createdBy)))).toEqual({
      code: '23001',
      constraint: 'auth_tokens_created_by_users_id_fk',
    });
  });

  it('enum auth_token_kind rejeita valor desconhecido', async () => {
    const admin = await insertUser(db(), { role: 'admin' });
    const err = await pgError(
      db().execute(
        sql`INSERT INTO auth_tokens (kind, token_hash, role, created_by, expires_at)
            VALUES ('magic_link', ${HASH_A}, 'member', ${admin.id}, now())`,
      ),
    );
    expect(err.code).toBe('22P02');
  });
});
