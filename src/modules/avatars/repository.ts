import { eq } from 'drizzle-orm';

import type { DbExecutor } from '../../db/client';
import { userAvatars, type UserAvatarRow } from '../../db/schema';

export interface AvatarValues {
  userId: string;
  contentType: string;
  bytes: Buffer;
  updatedAt: Date;
}

export async function findAvatarByUserId(
  db: DbExecutor,
  userId: string,
): Promise<UserAvatarRow | undefined> {
  const [row] = await db.select().from(userAvatars).where(eq(userAvatars.userId, userId)).limit(1);
  return row;
}

/** Grava a foto do usuário, substituindo a anterior (uma por usuário). */
export async function upsertAvatar(db: DbExecutor, values: AvatarValues): Promise<void> {
  const { contentType, bytes, updatedAt } = values;
  await db.insert(userAvatars).values(values).onConflictDoUpdate({
    target: userAvatars.userId,
    set: { contentType, bytes, updatedAt },
  });
}

/** `true` se havia foto para apagar. */
export async function deleteAvatar(db: DbExecutor, userId: string): Promise<boolean> {
  const rows = await db
    .delete(userAvatars)
    .where(eq(userAvatars.userId, userId))
    .returning({ userId: userAvatars.userId });
  return rows.length > 0;
}
