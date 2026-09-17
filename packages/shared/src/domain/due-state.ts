/** Estado do card (api.md §2). */
export const CARD_STATUSES = ['open', 'completed'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const DUE_STATES = ['completed', 'none', 'overdue', 'due_soon', 'scheduled'] as const;
export type DueState = (typeof DUE_STATES)[number];

/** Janela de "vencendo": prazo a até 24h de agora (inclusive). */
export const DUE_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface DueStateInput {
  status: CardStatus;
  /** ISO UTC vindo da API (ou `Date`); `null` = sem prazo. */
  dueAt: string | Date | null;
}

/**
 * Estado do prazo (overview.md §4.3, ADR 0011), igual no front e no back:
 * `completed` se concluído; `none` se sem prazo; `overdue` se `now > dueAt`;
 * `due_soon` se `dueAt - now <= 24h`; senão `scheduled`.
 *
 * Prazo sem hora já chega como `23:59:59.999` do dia no fuso do workspace,
 * então não precisa de tratamento especial aqui.
 */
export function getDueState(card: DueStateInput, now: Date): DueState {
  if (card.status === 'completed') return 'completed';
  if (card.dueAt === null) return 'none';

  const dueMs = card.dueAt instanceof Date ? card.dueAt.getTime() : Date.parse(card.dueAt);
  const nowMs = now.getTime();
  if (Number.isNaN(dueMs)) throw new RangeError('dueAt inválido');
  if (Number.isNaN(nowMs)) throw new RangeError('now inválido');

  const remaining = dueMs - nowMs;
  if (remaining < 0) return 'overdue';
  if (remaining <= DUE_SOON_WINDOW_MS) return 'due_soon';
  return 'scheduled';
}
