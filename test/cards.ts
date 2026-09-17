import { expect } from 'vitest';

/**
 * Face de card que **não** está bloqueada (ADR 0015): estreita a união `BoardCard` nos testes e
 * falha na hora se a resposta trouxer um `LockedCard` onde o teste espera o card inteiro.
 */
export function unlockedCard<T extends { locked: boolean }>(
  card: T | undefined,
): Extract<T, { locked: false }> {
  expect(card).toBeDefined();
  expect(card?.locked).toBe(false);
  return card as Extract<T, { locked: false }>;
}
