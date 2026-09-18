import { and, desc, eq, gt, gte, isNull, or, sql } from 'drizzle-orm';

import type { DbExecutor } from '../../../db/client';
import { authTokens, type AuthTokenRow, type NewAuthTokenRow } from '../../../db/schema';

export type AuthTokenKind = AuthTokenRow['kind'];

/** Pendente em `now`: não usado, não revogado e não expirado (ADR 0008). */
function pendingCondition(now: Date) {
  return and(
    isNull(authTokens.usedAt),
    isNull(authTokens.revokedAt),
    gt(authTokens.expiresAt, now),
  );
}

export async function insertAuthToken(
  db: DbExecutor,
  values: NewAuthTokenRow,
): Promise<AuthTokenRow> {
  const [row] = await db.insert(authTokens).values(values).returning();
  if (!row) throw new Error('insert em auth_tokens não retornou linha');
  return row;
}

/** Token pendente pelo hash (sem consumir). */
export async function findPendingToken(
  db: DbExecutor,
  kind: AuthTokenKind,
  tokenHash: string,
  now: Date,
): Promise<AuthTokenRow | undefined> {
  const [row] = await db
    .select()
    .from(authTokens)
    .where(
      and(eq(authTokens.tokenHash, tokenHash), eq(authTokens.kind, kind), pendingCondition(now)),
    )
    .limit(1);
  return row;
}

/**
 * Consumo atômico (overview.md §6.5): só um `UPDATE` concorrente encontra a linha pendente; os
 * outros esperam o lock da linha, reavaliam o `WHERE` e não retornam nada.
 */
export async function consumeToken(
  db: DbExecutor,
  kind: AuthTokenKind,
  tokenHash: string,
  now: Date,
  usedByUserId: string | null,
): Promise<AuthTokenRow | undefined> {
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: now, ...(usedByUserId ? { usedByUserId } : {}) })
    .where(
      and(eq(authTokens.tokenHash, tokenHash), eq(authTokens.kind, kind), pendingCondition(now)),
    )
    .returning();
  return row;
}

export async function setTokenUsedBy(db: DbExecutor, id: string, userId: string): Promise<void> {
  await db.update(authTokens).set({ usedByUserId: userId }).where(eq(authTokens.id, id));
}

export async function findInviteById(
  db: DbExecutor,
  id: string,
): Promise<AuthTokenRow | undefined> {
  const [row] = await db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.id, id), eq(authTokens.kind, 'invite')))
    .limit(1);
  return row;
}

/** Convites criados desde `since` ou ainda pendentes, mais recentes primeiro. */
export async function listInvites(db: DbExecutor, since: Date, now: Date): Promise<AuthTokenRow[]> {
  return db
    .select()
    .from(authTokens)
    .where(
      and(
        eq(authTokens.kind, 'invite'),
        or(gte(authTokens.createdAt, since), pendingCondition(now)),
      ),
    )
    .orderBy(desc(authTokens.createdAt), desc(authTokens.id));
}

/** Revoga o convite se ainda estiver pendente. Retorna a linha atualizada (ou nada). */
export async function revokePendingInvite(
  db: DbExecutor,
  id: string,
  now: Date,
): Promise<AuthTokenRow | undefined> {
  const [row] = await db
    .update(authTokens)
    .set({ revokedAt: now })
    .where(and(eq(authTokens.id, id), eq(authTokens.kind, 'invite'), pendingCondition(now)))
    .returning();
  return row;
}

/** Revoga todos os links de redefinição não usados e não revogados do usuário. */
export async function revokeUnusedPasswordResets(
  db: DbExecutor,
  targetUserId: string,
  now: Date,
): Promise<void> {
  await db
    .update(authTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(authTokens.kind, 'password_reset'),
        eq(authTokens.targetUserId, targetUserId),
        isNull(authTokens.usedAt),
        isNull(authTokens.revokedAt),
      ),
    );
}

/**
 * Revoga os convites e links de redefinição ainda pendentes (não usados, não revogados, não
 * expirados) criados por `createdBy` (api.md §18.5). Usado quando o criador perde o poder de
 * emiti-los: desativação, rebaixamento de Admin e anonimização. Retorna quantos revogou.
 */
export async function revokePendingTokensCreatedBy(
  db: DbExecutor,
  createdBy: string,
  now: Date,
): Promise<number> {
  const rows = await db
    .update(authTokens)
    .set({ revokedAt: now })
    .where(and(eq(authTokens.createdBy, createdBy), pendingCondition(now)))
    .returning({ id: authTokens.id });
  return rows.length;
}

/**
 * Anonimização (LGPD, overview.md §5.2): apaga os links de redefinição cujo alvo é o usuário e tira
 * o e-mail dos convites ligados a ele (o que ele aceitou, ou algum com o e-mail dele). Convite ainda
 * pendente com esse e-mail é revogado junto (sem e-mail ele viraria um convite aberto).
 */
export async function scrubAuthTokensOfUser(
  db: DbExecutor,
  user: { id: string; email: string | null },
  now: Date,
): Promise<void> {
  await db
    .delete(authTokens)
    .where(and(eq(authTokens.kind, 'password_reset'), eq(authTokens.targetUserId, user.id)));
  await db
    .update(authTokens)
    .set({
      email: null,
      revokedAt: sql`CASE WHEN ${authTokens.usedAt} IS NULL THEN coalesce(${authTokens.revokedAt}, ${now}::timestamptz) ELSE ${authTokens.revokedAt} END`,
    })
    .where(
      and(
        eq(authTokens.kind, 'invite'),
        user.email === null
          ? eq(authTokens.usedByUserId, user.id)
          : or(eq(authTokens.usedByUserId, user.id), eq(authTokens.email, user.email)),
      ),
    );
}
