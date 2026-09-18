/** Níveis fixos de prioridade do card, do menor para o maior (RN16, ADR 0012). */
export const CARD_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export type CardPriority = (typeof CARD_PRIORITIES)[number];

/** Peso de cada nível; `null` (sem prioridade) vale 0. Mesmo ranking do `CASE` em "Meus cards". */
export const PRIORITY_RANK = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
} as const satisfies Record<CardPriority, number>;

export const PRIORITY_LABELS = {
  urgent: 'Urgente',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
} as const satisfies Record<CardPriority, string>;

export const NO_PRIORITY_LABEL = 'Sem prioridade';

export function priorityRank(priority: CardPriority | null): number {
  return priority === null ? 0 : PRIORITY_RANK[priority];
}

/**
 * Comparador para `Array.prototype.sort`: mais prioritário primeiro
 * (Urgente > Alta > Média > Baixa > sem prioridade).
 */
export function comparePriority(a: CardPriority | null, b: CardPriority | null): number {
  return priorityRank(b) - priorityRank(a);
}

export function priorityLabel(priority: CardPriority | null): string {
  return priority === null ? NO_PRIORITY_LABEL : PRIORITY_LABELS[priority];
}
