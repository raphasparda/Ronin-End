import { expect } from 'vitest';

import type { CardActor } from '../src/modules/cards/access';

import type { Actor } from './actors';

/** Ator (id + papel) a partir de um `Actor` de teste, para serviços que checam acesso ao card. */
export function cardActor(actor: Actor): CardActor {
  return { id: actor.user.id, role: actor.user.role };
}

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
