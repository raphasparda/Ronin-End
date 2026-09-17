import type { DbExecutor } from '../../db/client';

/**
 * Ganchos de notificação (api.md §11 e §14). A Fatia 7 (tarefa 7.3) liga `notify(tx, ...)` aqui:
 * os serviços de responsáveis e comentários já chamam estes ganchos na transação da ação, então
 * notificar passa a ser atômico com a mudança. Hoje não fazem nada.
 *
 * Regras que a implementação da 7.3 deve aplicar (e não os chamadores): sem autonotificação
 * (`userId === actorId`, RN18) e só destinatários ativos.
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

/** Chamado depois de gravar uma atribuição nova (`card_assignee_added`). */
export function onAssigned(_tx: DbExecutor, _event: AssignedEvent): Promise<void> {
  return Promise.resolve();
}

/** Chamado depois de gravar um comentário novo. */
export function onCommented(_tx: DbExecutor, _event: CommentedEvent): Promise<void> {
  return Promise.resolve();
}
