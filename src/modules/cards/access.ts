import { canAccessCard, type CardVisibility, type Role } from '@raphasparda/ronin-shared';
import { and, eq, exists, or, sql, type SQL } from 'drizzle-orm';

import type { DbExecutor } from '../../db/client';
import { cards, cardViewers } from '../../db/schema';
import { AppError } from '../../lib/app-error';

export const CARD_RESTRICTED_MESSAGE = 'Você não tem acesso a este card.';

/** Quem está agindo: id e papel do usuário da sessão (`requireUser`). */
export interface CardActor {
  id: string;
  role: Role;
}

/** Card já lido, do ponto de vista do acesso. */
export interface CardAccessRow {
  id: string;
  visibility: CardVisibility;
}

/** `403 CARD_RESTRICTED` (api.md §3). */
export function cardRestricted(): AppError {
  return new AppError('CARD_RESTRICTED', CARD_RESTRICTED_MESSAGE);
}

/** `true` se o ator está na lista de acesso do card. */
export async function isCardViewer(
  db: DbExecutor,
  cardId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ one: sql`1` })
    .from(cardViewers)
    .where(and(eq(cardViewers.cardId, cardId), eq(cardViewers.userId, userId)))
    .limit(1);
  return row !== undefined;
}

/**
 * Regra de acesso (ADR 0015), forma imperativa: `visibility = 'team'` **ou** Admin **ou** linha em
 * `card_viewers`. Sem acesso → `403 CARD_RESTRICTED`.
 *
 * Roda sobre a linha já lida (nas mutações, bloqueada com `FOR UPDATE` dentro de `lockCard`), então
 * restringir o card em paralelo não deixa passar mutação. A regra pura, espelhada no front, é
 * `canAccessCard` do `@raphasparda/ronin-shared`.
 */
export async function assertCardAccess(
  db: DbExecutor,
  card: CardAccessRow,
  actor: CardActor,
): Promise<void> {
  if (canAccessCard({ visibility: card.visibility, viewerIds: [] }, actor)) return;
  if (!(await isCardViewer(db, card.id, actor.id))) throw cardRestricted();
}

/**
 * Mesma regra em SQL, para as listagens (payload do quadro, arquivados, "Meus cards",
 * notificações): predicado correlacionado com a tabela `cards` da consulta corrente, servido pela
 * PK de `card_viewers` (sem N+1, sem consulta a mais).
 */
export function cardAccessCondition(db: DbExecutor, actor: CardActor): SQL {
  if (actor.role === 'admin') return sql`true`;
  return or(
    eq(cards.visibility, 'team'),
    exists(
      db
        .select({ one: sql`1` })
        .from(cardViewers)
        .where(and(eq(cardViewers.cardId, cards.id), eq(cardViewers.userId, actor.id))),
    ),
  ) as SQL;
}

export { canAccessCard };
