import { describe, expect, it } from 'vitest';

import {
  CARD_PRIORITIES,
  PRIORITY_LABELS,
  PRIORITY_RANK,
  comparePriority,
  priorityLabel,
  priorityRank,
} from './priority';
import type { CardPriority } from './priority';

describe('prioridade', () => {
  it('níveis fixos low, medium, high, urgent', () => {
    expect(CARD_PRIORITIES).toEqual(['low', 'medium', 'high', 'urgent']);
  });

  it('ranking Urgente > Alta > Média > Baixa > sem prioridade', () => {
    expect(PRIORITY_RANK.urgent).toBeGreaterThan(PRIORITY_RANK.high);
    expect(PRIORITY_RANK.high).toBeGreaterThan(PRIORITY_RANK.medium);
    expect(PRIORITY_RANK.medium).toBeGreaterThan(PRIORITY_RANK.low);
    expect(PRIORITY_RANK.low).toBeGreaterThan(priorityRank(null));
    expect(priorityRank(null)).toBe(0);
  });

  it('comparePriority ordena do mais para o menos prioritário, null por último', () => {
    const input: (CardPriority | null)[] = [null, 'low', 'urgent', 'medium', null, 'high'];
    expect([...input].sort(comparePriority)).toEqual([
      'urgent',
      'high',
      'medium',
      'low',
      null,
      null,
    ]);
  });

  it('comparePriority: sinal e empate', () => {
    expect(comparePriority('urgent', 'low')).toBeLessThan(0);
    expect(comparePriority(null, 'low')).toBeGreaterThan(0);
    expect(comparePriority('high', 'high')).toBe(0);
    expect(comparePriority(null, null)).toBe(0);
  });

  it('rótulos em pt-BR', () => {
    expect(PRIORITY_LABELS).toEqual({
      urgent: 'Urgente',
      high: 'Alta',
      medium: 'Média',
      low: 'Baixa',
    });
    expect(priorityLabel('medium')).toBe('Média');
    expect(priorityLabel(null)).toBe('Sem prioridade');
  });
});
