import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { describeDb, pgErrorOf, useTestDatabase } from '../../../test/db';

import { authThrottle, sessions, users, workspace, type NewUserRow } from './index';

async function pgError(promise: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await promise;
  } catch (err) {
    return pgErrorOf(err);
  }
  throw new Error('era esperado erro do PostgreSQL');
}

const SHA256_HEX = 'a'.repeat(64);

function userInput(overrides: Partial<NewUserRow> = {}): NewUserRow {
  return {
    email: 'ana@exemplo.com',
    name: 'Ana',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fake$fake',
    role: 'admin',
    ...overrides,
  };
}

describeDb('schema: workspace, users, sessions, auth_throttle (kanban_test)', () => {
  const { db, pool } = useTestDatabase();

  it('roda no banco de testes com as migrations aplicadas', async () => {
    const { rows } = await pool().query<{ db: string; tables: string[] }>(
      `SELECT current_database() AS db,
              array_agg(tablename::text ORDER BY tablename) AS tables
         FROM pg_tables WHERE schemaname = 'public'`,
    );
    expect(rows[0]?.db).toBe(new URL(process.env.TEST_DATABASE_URL ?? '').pathname.slice(1));
    expect(rows[0]?.tables).toEqual(
      expect.arrayContaining(['auth_throttle', 'sessions', 'users', 'workspace']),
    );
  });

  it('truncateAll entre testes, parte 1: grava dados', async () => {
    await db().insert(workspace).values({ name: 'Ronin' });
    await db().insert(users).values(userInput());
    expect(await db().$count(users)).toBe(1);
  });

  it('truncateAll entre testes, parte 2: começa vazio', async () => {
    expect(await db().$count(workspace)).toBe(0);
    expect(await db().$count(users)).toBe(0);
  });

  describe('workspace', () => {
    it('aplica defaults (id 1, fuso, timestamps)', async () => {
      const [row] = await db().insert(workspace).values({ name: 'Ronin' }).returning();
      expect(row).toMatchObject({ id: 1, name: 'Ronin', timezone: 'America/Sao_Paulo' });
      expect(row?.createdAt).toBeInstanceOf(Date);
    });

    it('CHECK (id = 1): rejeita qualquer outro id', async () => {
      expect(await pgError(db().insert(workspace).values({ id: 2, name: 'Outro' }))).toEqual({
        code: '23514',
        constraint: 'workspace_singleton_check',
      });
    });

    it('só existe uma linha (segunda inserção viola a PK)', async () => {
      await db().insert(workspace).values({ name: 'Ronin' });
      expect(await pgError(db().insert(workspace).values({ name: 'Outro' }))).toEqual({
        code: '23505',
        constraint: 'workspace_pkey',
      });
    });

    it('nome entre 1 e 100 caracteres', async () => {
      expect(await pgError(db().insert(workspace).values({ name: '' }))).toMatchObject({
        constraint: 'workspace_name_length_check',
      });
      expect(
        await pgError(
          db()
            .insert(workspace)
            .values({ name: 'x'.repeat(101) }),
        ),
      ).toMatchObject({ constraint: 'workspace_name_length_check' });
    });
  });

  describe('users', () => {
    it('aplica defaults (uuid, status active)', async () => {
      const [row] = await db().insert(users).values(userInput()).returning();
      expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row?.status).toBe('active');
      expect(row?.anonymizedAt).toBeNull();
    });

    it('UNIQUE(email): rejeita e-mail repetido', async () => {
      await db().insert(users).values(userInput());
      expect(
        await pgError(
          db()
            .insert(users)
            .values(userInput({ name: 'Outra', role: 'member' })),
        ),
      ).toEqual({ code: '23505', constraint: 'users_email_unique' });
    });

    it('e-mail precisa estar normalizado (evita duplicata por maiúsculas)', async () => {
      expect(
        await pgError(
          db()
            .insert(users)
            .values(userInput({ email: 'Ana@Exemplo.com' })),
        ),
      ).toEqual({ code: '23514', constraint: 'users_email_normalized_check' });
      expect(
        await pgError(
          db()
            .insert(users)
            .values(userInput({ email: ' ana@exemplo.com' })),
        ),
      ).toMatchObject({ constraint: 'users_email_normalized_check' });
    });

    it('enum de papel rejeita valor desconhecido', async () => {
      const err = await pgError(
        db().execute(
          sql`INSERT INTO users (email, name, password_hash, role) VALUES ('b@x.com', 'B', 'h', 'owner')`,
        ),
      );
      expect(err.code).toBe('22P02');
    });

    it('usuário não anonimizado exige e-mail e senha', async () => {
      expect(
        await pgError(
          db()
            .insert(users)
            .values(userInput({ email: null })),
        ),
      ).toEqual({
        code: '23514',
        constraint: 'users_credentials_present_check',
      });
      expect(
        await pgError(
          db()
            .insert(users)
            .values(userInput({ passwordHash: null })),
        ),
      ).toEqual({
        code: '23514',
        constraint: 'users_credentials_present_check',
      });
    });

    it('anonimização: permite vários anonimizados e exige desativado sem e-mail/senha', async () => {
      const [a] = await db().insert(users).values(userInput()).returning();
      await db()
        .insert(users)
        .values(userInput({ email: 'bia@exemplo.com', name: 'Bia', role: 'member' }));

      const anonymize = { name: 'Usuário removido', email: null, passwordHash: null };
      const now = new Date();

      // Ainda ativo: não pode anonimizar.
      expect(
        await pgError(
          db()
            .update(users)
            .set({ ...anonymize, anonymizedAt: now })
            .where(eq(users.id, a?.id ?? '')),
        ),
      ).toMatchObject({ constraint: 'users_anonymized_check' });

      await db()
        .update(users)
        .set({ ...anonymize, anonymizedAt: now, status: 'deactivated' });
      const rows = await db().select().from(users);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.email === null && r.anonymizedAt !== null)).toBe(true);

      // Reativar um anonimizado é proibido.
      expect(await pgError(db().update(users).set({ status: 'active' }))).toMatchObject({
        constraint: 'users_anonymized_check',
      });
    });

    it('nome entre 1 e 80 caracteres', async () => {
      expect(
        await pgError(
          db()
            .insert(users)
            .values(userInput({ name: '' })),
        ),
      ).toMatchObject({
        constraint: 'users_name_length_check',
      });
      expect(
        await pgError(
          db()
            .insert(users)
            .values(userInput({ name: 'x'.repeat(81) })),
        ),
      ).toMatchObject({ constraint: 'users_name_length_check' });
    });
  });

  describe('sessions', () => {
    async function createSession(userId: string, id = SHA256_HEX) {
      const now = new Date();
      return db()
        .insert(sessions)
        .values({
          id,
          userId,
          idleExpiresAt: new Date(now.getTime() + 14 * 86_400_000),
          absoluteExpiresAt: new Date(now.getTime() + 30 * 86_400_000),
        });
    }

    it('id aceita só SHA-256 hex (nunca o token cru)', async () => {
      const [user] = await db().insert(users).values(userInput()).returning();
      const rawToken = 'Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXU';
      expect(await pgError(createSession(user?.id ?? '', rawToken))).toEqual({
        code: '23514',
        constraint: 'sessions_id_sha256_check',
      });
      await createSession(user?.id ?? '');
      expect(await db().$count(sessions)).toBe(1);
    });

    it('FK para users: usuário inexistente rejeitado; exclusão em cascata', async () => {
      expect(await pgError(createSession('00000000-0000-4000-8000-000000000000'))).toEqual({
        code: '23503',
        constraint: 'sessions_user_id_users_id_fk',
      });
      const [user] = await db().insert(users).values(userInput()).returning();
      await createSession(user?.id ?? '');
      await db()
        .delete(users)
        .where(eq(users.id, user?.id ?? ''));
      expect(await db().$count(sessions)).toBe(0);
    });
  });

  describe('auth_throttle', () => {
    it('chave no formato email:/ip: e falhas não negativas', async () => {
      await db().insert(authThrottle).values({ key: 'email:ana@exemplo.com', failures: 1 });
      await db().insert(authThrottle).values({ key: 'ip:203.0.113.7' });
      expect(await db().$count(authThrottle)).toBe(2);

      expect(await pgError(db().insert(authThrottle).values({ key: 'ana@exemplo.com' }))).toEqual({
        code: '23514',
        constraint: 'auth_throttle_key_format_check',
      });
      expect(
        await pgError(db().insert(authThrottle).values({ key: 'ip:198.51.100.1', failures: -1 })),
      ).toEqual({ code: '23514', constraint: 'auth_throttle_failures_check' });
    });
  });
});
