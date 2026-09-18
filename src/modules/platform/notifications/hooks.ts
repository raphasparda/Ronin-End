import type { DbExecutor } from '../../../db/client';

import { insertAssignedNotification, insertCommentedNotifications } from './repository';

/**
 * Ganchos de notificação (api.md §11 e §14, D2). Os serviços de responsáveis e comentários chamam
 * estes ganchos na transação da ação, então a notificação é atômica com a mudança.
 *
 * Regras aplicadas aqui (e não pelos chamadores): sem autonotificação (`userId === actorId`, RN18,
 * também garantida pelo CHECK `notifications_not_self_check`) e só destinatários ativos e não
 * anonimizados.
 */

export interface AssignedEvent {
  cardId: string;
  /** Novo responsável (a atribuição é nova: repetir o `PUT` não chama o gancho). */
  userId: string;
  actorId: string;
  now: Date;
}

export interface CommentedEvent {
  cardId: string;
  commentId: string;
  /** Autor do comentário. */
  actorId: string;
  now: Date;
}

/** Chamado depois de gravar uma atribuição nova (`card_assignee_added`): notifica o atribuído. */
export async function onAssigned(tx: DbExecutor, event: AssignedEvent): Promise<void> {
  await insertAssignedNotification(tx, event);
}

/**
 * Chamado depois de gravar um comentário novo: notifica os responsáveis do card, menos o autor
 * (D2: "comentaram em um card em que sou responsável"; o criador do card não entra).
 */
export async function onCommented(tx: DbExecutor, event: CommentedEvent): Promise<void> {
  await insertCommentedNotifications(tx, event);
}
