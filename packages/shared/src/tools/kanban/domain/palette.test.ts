import { describe, expect, it } from 'vitest';

import { DEFAULT_BOARD_LIST_COLORS, PALETTE, PALETTE_LABELS, nextPaletteColor } from './palette';
import type { PaletteColor } from './palette';

describe('PALETTE', () => {
  it('tem as 9 chaves na ordem do enum palette_color (ADR 0012)', () => {
    expect(PALETTE).toEqual([
      'gray',
      'red',
      'orange',
      'yellow',
      'green',
      'cyan',
      'blue',
      'purple',
      'magenta',
    ]);
  });

  it('tem rótulo pt-BR para toda cor', () => {
    for (const color of PALETTE) {
      expect(PALETTE_LABELS[color]).toMatch(/\S/);
    }
    expect(PALETTE_LABELS.blue).toBe('Azul');
  });

  it('listas padrão de quadro novo usam blue, orange, green', () => {
    expect(DEFAULT_BOARD_LIST_COLORS).toEqual(['blue', 'orange', 'green']);
  });
});

describe('nextPaletteColor', () => {
  it('sem lista ativa (null) retorna a primeira cor', () => {
    expect(nextPaletteColor(null)).toBe('gray');
  });

  it('retorna a cor seguinte na ordem da paleta', () => {
    expect(nextPaletteColor('gray')).toBe('red');
    expect(nextPaletteColor('green')).toBe('cyan');
    // Depois das listas padrão (última = green), a quarta lista é cyan.
    expect(nextPaletteColor(DEFAULT_BOARD_LIST_COLORS[2])).toBe('cyan');
  });

  it('é cíclica: depois da última volta para a primeira', () => {
    expect(nextPaletteColor('magenta')).toBe('gray');
  });

  it('percorre a paleta inteira e volta ao início', () => {
    let color: PaletteColor | null = null;
    const seen: PaletteColor[] = [];
    for (let i = 0; i < PALETTE.length + 1; i++) {
      color = nextPaletteColor(color);
      seen.push(color);
    }
    expect(seen).toEqual([...PALETTE, 'gray']);
  });

  it('valor fora da paleta (JS não tipado) cai na primeira cor', () => {
    expect(nextPaletteColor('pink' as PaletteColor)).toBe('gray');
  });
});
