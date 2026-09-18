import { describe, expect, it } from 'vitest';

import { DUE_SOON_WINDOW_MS, getDueState } from './due-state';

const NOW = new Date('2026-09-16T12:00:00.000Z');
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

describe('getDueState', () => {
  it('retorna completed para card concluído, mesmo atrasado ou sem prazo', () => {
    expect(getDueState({ status: 'completed', dueAt: at(-DUE_SOON_WINDOW_MS) }, NOW)).toBe(
      'completed',
    );
    expect(getDueState({ status: 'completed', dueAt: null }, NOW)).toBe('completed');
    expect(getDueState({ status: 'completed', dueAt: at(DUE_SOON_WINDOW_MS * 10) }, NOW)).toBe(
      'completed',
    );
  });

  it('retorna none para card aberto sem prazo', () => {
    expect(getDueState({ status: 'open', dueAt: null }, NOW)).toBe('none');
  });

  describe('limites', () => {
    it('overdue 1 ms depois do prazo', () => {
      expect(getDueState({ status: 'open', dueAt: at(-1) }, NOW)).toBe('overdue');
    });

    it('due_soon exatamente no instante do prazo (now == dueAt não é atrasado)', () => {
      expect(getDueState({ status: 'open', dueAt: at(0) }, NOW)).toBe('due_soon');
    });

    it('due_soon com exatamente 24h restantes', () => {
      expect(getDueState({ status: 'open', dueAt: at(DUE_SOON_WINDOW_MS) }, NOW)).toBe('due_soon');
    });

    it('scheduled com 24h + 1 ms restantes', () => {
      expect(getDueState({ status: 'open', dueAt: at(DUE_SOON_WINDOW_MS + 1) }, NOW)).toBe(
        'scheduled',
      );
    });
  });

  describe('prazo sem hora (23:59:59.999 no fuso do workspace)', () => {
    // 2026-09-20 sem hora em America/Sao_Paulo (UTC-3) = 2026-09-21T02:59:59.999Z
    const dueAt = '2026-09-21T02:59:59.999Z';

    it('scheduled dias antes', () => {
      expect(getDueState({ status: 'open', dueAt }, new Date('2026-09-18T12:00:00.000Z'))).toBe(
        'scheduled',
      );
    });

    it('due_soon no próprio dia, até o último milissegundo', () => {
      expect(
        getDueState({ status: 'open', dueAt }, new Date('2026-09-20T09:00:00.000-03:00')),
      ).toBe('due_soon');
      expect(getDueState({ status: 'open', dueAt }, new Date(dueAt))).toBe('due_soon');
    });

    it('overdue a partir da meia-noite do dia seguinte', () => {
      expect(
        getDueState({ status: 'open', dueAt }, new Date('2026-09-21T00:00:00.000-03:00')),
      ).toBe('overdue');
    });
  });

  it('aceita Date como dueAt', () => {
    expect(getDueState({ status: 'open', dueAt: new Date(NOW.getTime() + 1000) }, NOW)).toBe(
      'due_soon',
    );
  });

  it('lança RangeError para datas inválidas', () => {
    expect(() => getDueState({ status: 'open', dueAt: 'não é data' }, NOW)).toThrow(RangeError);
    expect(() => getDueState({ status: 'open', dueAt: at(0) }, new Date(Number.NaN))).toThrow(
      RangeError,
    );
  });
});
