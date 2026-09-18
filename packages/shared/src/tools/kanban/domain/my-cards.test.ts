import { describe, expect, it } from 'vitest';

import { DUE_SOON_WINDOW_MS } from './due-state';
import { MY_CARD_GROUPS, groupMyCards } from './my-cards';

const NOW = new Date('2026-09-16T12:00:00.000Z');
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

describe('groupMyCards', () => {
  it('sempre devolve os 4 grupos na ordem, com rótulos pt-BR', () => {
    const groups = groupMyCards([], NOW);
    expect(groups.map((group) => group.group)).toEqual([...MY_CARD_GROUPS]);
    expect(groups.map((group) => group.label)).toEqual([
      'Atrasados',
      'Vencendo (24h)',
      'Com prazo',
      'Sem prazo',
    ]);
    expect(groups.every((group) => group.cards.length === 0)).toBe(true);
  });

  it('agrupa nos limites e preserva a ordem do servidor dentro do grupo', () => {
    const cards = [
      { id: 'a', status: 'open' as const, dueAt: iso(-1) },
      { id: 'b', status: 'open' as const, dueAt: iso(0) },
      { id: 'c', status: 'open' as const, dueAt: iso(DUE_SOON_WINDOW_MS) },
      { id: 'd', status: 'open' as const, dueAt: iso(DUE_SOON_WINDOW_MS + 1) },
      // "Sem prazo" já vem ordenado por prioridade pelo servidor: urgente, depois sem prioridade.
      { id: 'e-urgent', status: 'open' as const, dueAt: null },
      { id: 'f-none', status: 'open' as const, dueAt: null },
      { id: 'g', status: 'completed' as const, dueAt: iso(-1) },
    ];
    const byGroup = Object.fromEntries(
      groupMyCards(cards, NOW).map((group) => [group.group, group.cards.map((card) => card.id)]),
    );
    expect(byGroup).toEqual({
      overdue: ['a'],
      due_soon: ['b', 'c'],
      scheduled: ['d'],
      none: ['e-urgent', 'f-none'],
    });
  });
});
