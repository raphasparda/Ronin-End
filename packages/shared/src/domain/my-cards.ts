import { getDueState } from './due-state';
import type { DueStateInput } from './due-state';

/** Grupos de "Meus cards" (D1), nesta ordem. */
export const MY_CARD_GROUPS = ['overdue', 'due_soon', 'scheduled', 'none'] as const;
export type MyCardGroup = (typeof MY_CARD_GROUPS)[number];

export const MY_CARD_GROUP_LABELS = {
  overdue: 'Atrasados',
  due_soon: 'Vencendo (24h)',
  scheduled: 'Com prazo',
  none: 'Sem prazo',
} as const satisfies Record<MyCardGroup, string>;

export interface MyCardsGroup<T> {
  group: MyCardGroup;
  label: string;
  cards: T[];
}

/**
 * Agrupa "Meus cards" por estado do prazo (`getDueState`), preservando a ordem do servidor
 * dentro de cada grupo. Sempre retorna os 4 grupos na ordem de `MY_CARD_GROUPS` (vazios
 * inclusive). Cards concluídos não pertencem a nenhum grupo e são ignorados (RN14).
 */
export function groupMyCards<T extends DueStateInput>(
  cards: readonly T[],
  now: Date,
): MyCardsGroup<T>[] {
  const buckets: Record<MyCardGroup, T[]> = { overdue: [], due_soon: [], scheduled: [], none: [] };
  for (const card of cards) {
    const state = getDueState(card, now);
    if (state !== 'completed') buckets[state].push(card);
  }
  return MY_CARD_GROUPS.map((group) => ({
    group,
    label: MY_CARD_GROUP_LABELS[group],
    cards: buckets[group],
  }));
}
