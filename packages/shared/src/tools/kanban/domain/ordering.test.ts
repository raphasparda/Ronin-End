import { describe, expect, it } from 'vitest';

import { applyPlacement, comparePosition, placementForPosition, sortByPosition } from './ordering';

describe('comparePosition', () => {
  it('compara por código (binário), não por localidade', () => {
    // Em COLLATE "C", maiúsculas vêm antes de minúsculas: 'Zz' < 'a'.
    expect(comparePosition('Zz', 'a')).toBe(-1);
    expect(comparePosition('a', 'Zz')).toBe(1);
    expect(comparePosition('a0', 'a0')).toBe(0);
    expect(comparePosition('a0', 'a0V')).toBe(-1);
  });

  it('sortByPosition devolve cópia ordenada sem alterar a original', () => {
    const items = [{ position: 'b' }, { position: 'Zz' }, { position: 'a' }];
    const sorted = sortByPosition(items);
    expect(sorted.map((item) => item.position)).toEqual(['Zz', 'a', 'b']);
    expect(items.map((item) => item.position)).toEqual(['b', 'Zz', 'a']);
  });
});

describe('placementForPosition', () => {
  const ids = ['A', 'B', 'C'];

  it('outra lista: 1 → start, n+1 → end, meio → after do anterior', () => {
    expect(placementForPosition(ids, 1)).toEqual({ type: 'start' });
    expect(placementForPosition(ids, 2)).toEqual({ type: 'after', id: 'A' });
    expect(placementForPosition(ids, 3)).toEqual({ type: 'after', id: 'B' });
    expect(placementForPosition(ids, 4)).toEqual({ type: 'end' });
  });

  it('lista vazia: posição 1 é end e start ao mesmo tempo (start)', () => {
    expect(placementForPosition([], 1)).toEqual({ type: 'start' });
  });

  it('mesma lista: desconsidera o próprio item', () => {
    // Movendo B em [A, B, C]: irmãos [A, C], posições 1..3.
    expect(placementForPosition(ids, 1, 'B')).toEqual({ type: 'start' });
    expect(placementForPosition(ids, 2, 'B')).toEqual({ type: 'after', id: 'A' });
    expect(placementForPosition(ids, 3, 'B')).toEqual({ type: 'end' });
    expect(() => placementForPosition(ids, 4, 'B')).toThrow(RangeError);
  });

  it('lança RangeError fora de 1..n+1 ou não inteiro', () => {
    expect(() => placementForPosition(ids, 0)).toThrow(RangeError);
    expect(() => placementForPosition(ids, 5)).toThrow(RangeError);
    expect(() => placementForPosition(ids, 1.5)).toThrow(RangeError);
    expect(() => placementForPosition(ids, Number.NaN)).toThrow(RangeError);
  });
});

describe('applyPlacement', () => {
  const ids = ['A', 'B', 'C'];

  it('start e end', () => {
    expect(applyPlacement(ids, 'C', { type: 'start' })).toEqual(['C', 'A', 'B']);
    expect(applyPlacement(ids, 'A', { type: 'end' })).toEqual(['B', 'C', 'A']);
  });

  it('after dentro da mesma lista', () => {
    expect(applyPlacement(ids, 'A', { type: 'after', id: 'B' })).toEqual(['B', 'A', 'C']);
    expect(applyPlacement(ids, 'A', { type: 'after', id: 'C' })).toEqual(['B', 'C', 'A']);
    expect(applyPlacement(ids, 'C', { type: 'after', id: 'A' })).toEqual(['A', 'C', 'B']);
  });

  it('item vindo de outra lista é inserido', () => {
    expect(applyPlacement(ids, 'X', { type: 'after', id: 'A' })).toEqual(['A', 'X', 'B', 'C']);
    expect(applyPlacement([], 'X', { type: 'end' })).toEqual(['X']);
  });

  it('after inválido (inexistente ou o próprio item) → null', () => {
    expect(applyPlacement(ids, 'A', { type: 'after', id: 'Z' })).toBeNull();
    expect(applyPlacement(ids, 'A', { type: 'after', id: 'A' })).toBeNull();
  });

  it('é o inverso de placementForPosition', () => {
    for (let position = 1; position <= 3; position++) {
      const placement = placementForPosition(ids, position, 'B');
      const result = applyPlacement(ids, 'B', placement);
      expect(result?.indexOf('B')).toBe(position - 1);
    }
  });
});
