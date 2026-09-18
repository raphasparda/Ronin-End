import { and, count, desc, eq, isNull, lt, sql } from 'drizzle-orm';

import type { DbExecutor } from '../../../db/client';
import {
  boards,
  cardAssignees,
  cards,
  notifications,
  users,
  type NotificationTypeValue,
} from '../../../db/schema';
import { boardAccessCondition, type BoardActor } from '../../tools/kanban/boards/access';

export interface NotificationListRow {
  id: string;
  type: NotificationTypeValue;
  actorId: string;
  cardId: string;
  cardTitle: string;
  boardId: string;
  boardName: string;
  commentId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

const listColumns = {
  id: notifications.id,
  type: notifications.type,
  actorId: notifications.actorId,
  cardId: cards.id,
  cardTitle: cards.title,
  boardId: boards.id,
  boardName: boards.name,
  commentId: notifications.commentId,
  readAt: notifications.readAt,
  createdAt: notifications.createdAt,
};

/**
 * Notificações do destinatário, mais recentes primeiro (`created_at DESC, id DESC`), com o card e o
 * quadro atuais. `before` exclusivo. Usa `notifications_user_id_created_at_idx`.
 * Notificação de card em quadro restrito sem acesso é **omitida** (RN40): a linha não é
 * apagada e volta a aparecer se o acesso voltar.
 */
export async function findNotificationsPage(
  db: DbExecutor,
  actor: BoardActor,
  options: { limit: number; before: Date | null },
): Promise<NotificationListRow[]> {
  return db
    .select(listColumns)
    .from(notifications)
    .innerJoin(cards, eq(cards.id, notifications.cardId))
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .where(
      and(
        eq(notifications.userId, actor.id),
        boardAccessCondition(db, actor),
        options.before === null ? undefined : lt(notifications.createdAt, options.before),
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(options.limit);
}

/** Notificações do destinatário criadas exatamente em `createdAt` (empate na borda da página). */
export async function findNotificationsAt(
  db: DbExecutor,
  actor: BoardActor,
  createdAt: Date,
): Promise<NotificationListRow[]> {
  return db
    .select(listColumns)
    .from(notifications)
    .innerJoin(cards, eq(cards.id, notifications.cardId))
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .where(
      and(
        eq(notifications.userId, actor.id),
        boardAccessCondition(db, actor),
        eq(notifications.createdAt, createdAt),
      ),
    )
    .orderBy(desc(notifications.id));
}

/**
 * Contador de não lidas (`notifications_user_id_unread_idx`), sem as de card em quadro que o
 * usuário não pode abrir (RN40): a página e o contador saem do mesmo critério.
 */
export async function countUnreadNotifications(db: DbExecutor, actor: BoardActor): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .innerJoin(cards, eq(cards.id, notifications.cardId))
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .where(
      and(
        eq(notifications.userId, actor.id),
        isNull(notifications.readAt),
        boardAccessCondition(db, actor),
      ),
    );
  return row?.value ?? 0;
}

/**
 * Marca como lida se pertence ao usuário. Já lida mantém o `read_at` original.
 * @returns `true` se a notificação existe e é do usuário.
 */
export async function markNotificationRead(
  db: DbExecutor,
  userId: string,
  notificationId: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, ${now}::timestamptz)` })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
    .returning({ id: notifications.id });
  return rows.length > 0;
}

export async function markAllNotificationsRead(
  db: DbExecutor,
  userId: string,
  now: Date,
): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

/**
 * `card_assigned` para `userId`, se ativo, não anonimizado e diferente do ator (RN18).
 * `FOR SHARE` no destinatário: desativar/anonimizar em paralelo espera ou é visto (não sobra
 * notificação para conta anonimizada).
 */
export async function insertAssignedNotification(
  db: DbExecutor,
  input: { cardId: string; userId: string; actorId: string; now: Date },
): Promise<number> {
  const result = await db.execute(sql`
    INSERT INTO ${notifications} (user_id, type, card_id, actor_id, comment_id, created_at)
    SELECT u.id, 'card_assigned', ${input.cardId}, ${input.actorId}, NULL, ${input.now}::timestamptz
      FROM ${users} u
     WHERE u.id = ${input.userId}
       AND u.id <> ${input.actorId}
       AND u.status = 'active'
       AND u.anonymized_at IS NULL
       FOR SHARE OF u`);
  return result.rowCount ?? 0;
}

/**
 * `card_commented` para cada responsável ativo e não anonimizado do card, exceto o autor (RN18).
 * Mesmo lock `FOR SHARE` dos destinatários de `insertAssignedNotification`.
 */
export async function insertCommentedNotifications(
  db: DbExecutor,
  input: { cardId: string; commentId: string; actorId: string; now: Date },
): Promise<number> {
  const result = await db.execute(sql`
    INSERT INTO ${notifications} (user_id, type, card_id, actor_id, comment_id, created_at)
    SELECT u.id, 'card_commented', ${input.cardId}, ${input.actorId}, ${input.commentId}, ${input.now}::timestamptz
      FROM ${cardAssignees} ca
      JOIN ${users} u ON u.id = ca.user_id
     WHERE ca.card_id = ${input.cardId}
       AND u.id <> ${input.actorId}
       AND u.status = 'active'
       AND u.anonymized_at IS NULL
     ORDER BY u.id
       FOR SHARE OF u`);
  return result.rowCount ?? 0;
}

/** Anonimização: apaga as notificações recebidas pelo usuário. */
export async function deleteNotificationsOfUser(db: DbExecutor, userId: string): Promise<void> {
  await db.delete(notifications).where(eq(notifications.userId, userId));
}

/** Manutenção (RN19): apaga notificações lidas antes de `cutoff`. */
export async function deleteReadNotificationsBefore(db: DbExecutor, cutoff: Date): Promise<number> {
  const rows = await db
    .delete(notifications)
    .where(lt(notifications.readAt, cutoff))
    .returning({ id: notifications.id });
  return rows.length;
}
