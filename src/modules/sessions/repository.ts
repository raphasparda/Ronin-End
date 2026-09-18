import { and, eq, ne } from 'drizzle-orm';

import type { DbExecutor } from '../../db/client';
import { sessions, users, type SessionRow, type UserRow } from '../../db/schema';

export interface SessionWithUser {
  session: SessionRow;
  user: Pick<
    UserRow,
    'id' | 'name' | 'email' | 'role' | 'status' | 'anonymizedAt' | 'avatarUpdatedAt'
  >;
}

export async function insertSession(
  db: DbExecutor,
  values: typeof sessions.$inferInsert,
): Promise<void> {
  await db.insert(sessions).values(values);
}

/** Sessão pelo hash do token, com os dados do usuário recarregados do banco (overview.md §6.2). */
export async function findSessionWithUser(
  db: DbExecutor,
  sessionId: string,
): Promise<SessionWithUser | undefined> {
  const [row] = await db
    .select({
      session: sessions,
      user: {
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        status: users.status,
        anonymizedAt: users.anonymizedAt,
        avatarUpdatedAt: users.avatarUpdatedAt,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  return row;
}

export async function updateSessionActivity(
  db: DbExecutor,
  sessionId: string,
  values: { lastSeenAt: Date; idleExpiresAt: Date },
): Promise<void> {
  await db.update(sessions).set(values).where(eq(sessions.id, sessionId));
}

export async function deleteSessionById(db: DbExecutor, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Apaga as sessões do usuário, opcionalmente mantendo uma (troca de senha mantém a atual). */
export async function deleteSessionsOfUser(
  db: DbExecutor,
  userId: string,
  exceptSessionId: string | null = null,
): Promise<void> {
  await db
    .delete(sessions)
    .where(
      exceptSessionId === null
        ? eq(sessions.userId, userId)
        : and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId)),
    );
}
