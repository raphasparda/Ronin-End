import { ANONYMIZED_USER_NAME } from '@raphasparda/ronin-shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type { DbExecutor } from '../../db/client';
import { authThrottle, users, type NewUserRow, type UserRow } from '../../db/schema';

/** `true` se existe ao menos um usuário (qualquer status). Define se a instância precisa de setup. */
export async function hasAnyUser(db: DbExecutor): Promise<boolean> {
  const result = await db.execute<{ exists: boolean }>(
    sql`SELECT EXISTS (SELECT 1 FROM ${users}) AS "exists"`,
  );
  return result.rows[0]?.exists === true;
}

/** Busca por e-mail já normalizado (`trim` + minúsculas, garantido pelo schema de entrada). */
export async function findUserByEmail(db: DbExecutor, email: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return row;
}

export async function insertUser(db: DbExecutor, values: NewUserRow): Promise<UserRow> {
  const [row] = await db.insert(users).values(values).returning();
  if (!row) throw new Error('insert em users não retornou linha');
  return row;
}

/** Todos os usuários (qualquer status), por nome. */
export async function listUsersByName(db: DbExecutor): Promise<UserRow[]> {
  return db.select().from(users).orderBy(asc(users.name), asc(users.id));
}

export async function findUserById(db: DbExecutor, id: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

/** Usuário com lock de linha (`FOR UPDATE`) para a transação corrente. */
export async function lockUserById(db: DbExecutor, id: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1).for('update');
  return row;
}

/**
 * Bloqueia os Admins ativos (em ordem de id, evitando deadlock) e retorna seus ids. Com todos os
 * ramos de "rebaixar/desativar Admin" passando por aqui, a regra do último Admin (I3) é serializada:
 * a transação que espera reavalia o `WHERE` e não vê quem acabou de deixar de ser Admin ativo.
 */
export async function lockActiveAdminIds(db: DbExecutor): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.status, 'active')))
    .orderBy(asc(users.id))
    .for('update');
  return rows.map((row) => row.id);
}

export async function updateUserById(
  db: DbExecutor,
  id: string,
  values: Partial<
    Pick<
      NewUserRow,
      'name' | 'role' | 'status' | 'passwordHash' | 'passwordChangedAt' | 'updatedAt'
    >
  >,
): Promise<UserRow | undefined> {
  const [row] = await db.update(users).set(values).where(eq(users.id, id)).returning();
  return row;
}

/** Grava a nova senha se o usuário ainda está ativo e não anonimizado. `false` se não gravou. */
export async function updateActiveUserPassword(
  db: DbExecutor,
  id: string,
  passwordHash: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ passwordHash, passwordChangedAt: now, updatedAt: now })
    .where(and(eq(users.id, id), eq(users.status, 'active'), isNull(users.anonymizedAt)))
    .returning({ id: users.id });
  return rows.length > 0;
}

/**
 * Usuário com lock compartilhado (`FOR SHARE`): impede que desativar/anonimizar (`UPDATE`) termine
 * no meio de uma ação que depende do status (ex.: atribuir responsável).
 */
export async function lockUserShared(db: DbExecutor, id: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1).for('share');
  return row;
}

/**
 * Anonimiza a linha (overview.md §5.2): nome "Usuário removido", e-mail e hash nulos,
 * `anonymized_at`. Só usuário desativado (o CHECK `users_anonymized_check` também exige).
 */
export async function anonymizeUserRow(
  db: DbExecutor,
  id: string,
  now: Date,
): Promise<UserRow | undefined> {
  const [row] = await db
    .update(users)
    .set({
      name: ANONYMIZED_USER_NAME,
      email: null,
      passwordHash: null,
      anonymizedAt: now,
      updatedAt: now,
    })
    .where(and(eq(users.id, id), eq(users.status, 'deactivated'), isNull(users.anonymizedAt)))
    .returning();
  return row;
}

/** Apaga o contador de tentativas de login do e-mail (dado pessoal na chave). */
export async function deleteEmailThrottle(db: DbExecutor, key: string): Promise<void> {
  await db.delete(authThrottle).where(eq(authThrottle.key, key));
}
