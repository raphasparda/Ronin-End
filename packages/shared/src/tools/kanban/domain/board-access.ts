import type { Role } from '../../../platform/schemas/common';

/**
 * Visibilidade do quadro (Fatia 11, ADR 0015): `team` = todo usuário ativo vê (padrão, RN05);
 * `restricted` = só Admins e as pessoas da lista de acesso (`viewerIds`).
 */
export const BOARD_VISIBILITIES = ['team', 'restricted'] as const;
export type BoardVisibility = (typeof BOARD_VISIBILITIES)[number];

/** Quadro do ponto de vista do acesso: visibilidade e lista de acesso (vazia em quadro `team`). */
export interface BoardAccessInput {
  visibility: BoardVisibility;
  /** Ids das pessoas com acesso (`board_viewers`). Ignorado quando `visibility` é `team`. */
  viewerIds: readonly string[];
}

/** Quem está agindo: id e papel do usuário da sessão. */
export interface BoardAccessActor {
  id: string;
  role: Role;
}

/**
 * Regra única de acesso ao quadro (overview.md §4.4, §6.6, ADR 0015):
 *
 * ```
 * acesso = visibility = 'team'  OU  ator.role = 'admin'  OU  ator ∈ viewerIds
 * ```
 *
 * Admin ativo tem acesso implícito e não ocupa vaga na lista (RN28). O servidor decide com esta
 * mesma regra (`modules/boards/access.ts`); o front a usa só para esconder botões. O acesso vale
 * para o quadro **inteiro**: listas, cards, comentários, checklists, etiquetas e capa.
 */
export function canAccessBoard(board: BoardAccessInput, actor: BoardAccessActor): boolean {
  if (board.visibility === 'team') return true;
  if (actor.role === 'admin') return true;
  return board.viewerIds.includes(actor.id);
}
