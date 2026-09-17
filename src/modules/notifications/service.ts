import type {
  Notification,
  NotificationsQuery,
  NotificationsResponse,
} from '@raphasparda/ronin-shared';

import type { Database } from '../../db/client';
import { AppError } from '../../lib/app-error';
import { toIso, toIsoOrNull } from '../../lib/dates';
import type { CardActor } from '../cards/access';

import {
  countUnreadNotifications,
  findNotificationsAt,
  findNotificationsPage,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationListRow,
} from './repository';

export const NOTIFICATION_NOT_FOUND_MESSAGE = 'Notificação não encontrada.';

function toNotification(row: NotificationListRow): Notification {
  return {
    id: row.id,
    type: row.type,
    actorId: row.actorId,
    card: { id: row.cardId, title: row.cardTitle, boardId: row.boardId, boardName: row.boardName },
    commentId: row.commentId,
    readAt: toIsoOrNull(row.readAt),
    createdAt: toIso(row.createdAt),
  };
}

/**
 * `GET /api/notifications?limit&before` (api.md §15), num snapshot único.
 * Cursor = `createdAt` do último item. Para o cursor exclusivo não pular notificações com o mesmo
 * `createdAt` na borda da página, a página inclui **todas** as do instante do último item (pode
 * passar de `limit` só nesse empate). `nextBefore` é `null` quando não há itens mais antigos.
 */
export async function listNotifications(
  db: Database,
  actor: CardActor,
  query: NotificationsQuery,
): Promise<NotificationsResponse> {
  return db.transaction(
    async (tx) => {
      const before = query.before === undefined ? null : new Date(query.before);
      const rows = await findNotificationsPage(tx, actor, { limit: query.limit + 1, before });

      let page = rows.slice(0, query.limit);
      let nextBefore: Date | null = null;
      const last = page.at(-1);
      const overflow = rows[query.limit];
      if (last && overflow) {
        nextBefore = last.createdAt;
        if (overflow.createdAt.getTime() === last.createdAt.getTime()) {
          const tied = await findNotificationsAt(tx, actor, last.createdAt);
          page = [
            ...page.filter((row) => row.createdAt.getTime() !== last.createdAt.getTime()),
            ...tied,
          ];
          const older = await findNotificationsPage(tx, actor, {
            limit: 1,
            before: last.createdAt,
          });
          if (older.length === 0) nextBefore = null;
        }
      }

      return {
        notifications: page.map(toNotification),
        unreadCount: await countUnreadNotifications(tx, actor),
        nextBefore: toIsoOrNull(nextBefore),
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

/** `GET /api/notifications/unread-count`. */
export function getUnreadCount(db: Database, actor: CardActor): Promise<number> {
  return countUnreadNotifications(db, actor);
}

/** `POST /api/notifications/:notificationId/read`. De outro usuário ou inexistente → 404. */
export async function readNotification(
  db: Database,
  userId: string,
  notificationId: string,
  now: Date,
): Promise<void> {
  if (!(await markNotificationRead(db, userId, notificationId, now))) {
    throw new AppError('NOT_FOUND', NOTIFICATION_NOT_FOUND_MESSAGE);
  }
}

/** `POST /api/notifications/read-all`. */
export async function readAllNotifications(db: Database, userId: string, now: Date): Promise<void> {
  await markAllNotificationsRead(db, userId, now);
}
