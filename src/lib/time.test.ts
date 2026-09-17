import { describe, expect, it } from 'vitest';

import { dueInputToUtc, zonedWallTimeToUtc } from './time';

describe('dueInputToUtc (ADR 0011)', () => {
  it('só data: 23:59:59.999 do dia no fuso do workspace', () => {
    expect(dueInputToUtc({ date: '2026-09-20', time: null }, 'America/Sao_Paulo')).toEqual({
      dueAt: new Date('2026-09-21T02:59:59.999Z'),
      dueHasTime: false,
    });
    expect(dueInputToUtc({ date: '2026-12-31', time: null }, 'UTC').dueAt.toISOString()).toBe(
      '2026-12-31T23:59:59.999Z',
    );
  });

  it('com hora: converte do fuso para UTC (inclusive fusos com meia hora e horário de verão)', () => {
    expect(dueInputToUtc({ date: '2026-09-20', time: '14:30' }, 'America/Sao_Paulo')).toEqual({
      dueAt: new Date('2026-09-20T17:30:00.000Z'),
      dueHasTime: true,
    });
    expect(
      dueInputToUtc({ date: '2026-01-10', time: '00:00' }, 'Asia/Kolkata').dueAt.toISOString(),
    ).toBe('2026-01-09T18:30:00.000Z');
    // Nova York: inverno UTC-5, verão UTC-4.
    expect(
      dueInputToUtc({ date: '2026-01-15', time: '09:00' }, 'America/New_York').dueAt.toISOString(),
    ).toBe('2026-01-15T14:00:00.000Z');
    expect(
      dueInputToUtc({ date: '2026-07-15', time: '09:00' }, 'America/New_York').dueAt.toISOString(),
    ).toBe('2026-07-15T13:00:00.000Z');
  });

  it('hora inexistente (início do horário de verão) cai depois do salto; ambígua usa a primeira', () => {
    // 2026-03-08 02:30 não existe em Nova York (02:00 → 03:00).
    const gap = zonedWallTimeToUtc('America/New_York', {
      year: 2026,
      month: 3,
      day: 8,
      hour: 2,
      minute: 30,
      ms: 0,
    });
    expect(gap.toISOString()).toBe('2026-03-08T07:30:00.000Z');
    // 2026-11-01 01:30 acontece duas vezes; a primeira é em UTC-4.
    const ambiguous = zonedWallTimeToUtc('America/New_York', {
      year: 2026,
      month: 11,
      day: 1,
      hour: 1,
      minute: 30,
      ms: 0,
    });
    expect(ambiguous.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });
});
