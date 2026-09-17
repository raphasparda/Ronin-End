import type { Role } from '../schemas/common';

/**
 * Visibilidade do card (Fatia 11, ADR 0015): `team` = todo usuário ativo vê (padrão, RN05);
 * `restricted` = só Admins e as pessoas da lista de acesso (`viewerIds`).
 */
export const CARD_VISIBILITIES = ['team', 'restricted'] as const;
export type CardVisibility = (typeof CARD_VISIBILITIES)[number];

/** Card do ponto de vista do acesso: visibilidade e lista de acesso (vazia em card `team`). */
export interface CardAccessInput {
  visibility: CardVisibility;
  /** Ids das pessoas com acesso (`card_viewers`). Ignorado quando `visibility` é `team`. */
  viewerIds: readonly string[];
}

/** Quem está agindo: id e papel do usuário da sessão. */
export interface CardAccessActor {
  id: string;
  role: Role;
}

/**
 * Regra única de acesso ao card (overview.md §4.4, §6.6, ADR 0015):
 *
 * ```
 * acesso = visibility = 'team'  OU  ator.role = 'admin'  OU  ator ∈ viewerIds
 * ```
 *
 * Admin ativo tem acesso implícito e não ocupa vaga na lista (RN28). O servidor decide com esta
 * mesma regra (`modules/cards/access.ts`); o front a usa só para esconder botões.
 */
export function canAccessCard(card: CardAccessInput, actor: CardAccessActor): boolean {
  if (card.visibility === 'team') return true;
  if (actor.role === 'admin') return true;
  return card.viewerIds.includes(actor.id);
}
