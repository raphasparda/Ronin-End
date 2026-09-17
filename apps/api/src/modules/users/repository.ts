import { eq, sql } from 'drizzle-orm';

import type { DbExecutor } from '../../db/client';
import { users, type NewUserRow, type UserRow } from '../../db/schema';

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
