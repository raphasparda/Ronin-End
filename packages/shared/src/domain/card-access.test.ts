import { describe, expect, it } from 'vitest';

import { ID } from '../test-fixtures';

import { CARD_VISIBILITIES, canAccessCard } from './card-access';
import {
  CARD_COVER_CONTENT_TYPES,
  CARD_COVER_MAX_BYTES,
  cardCoverKeyPrefix,
  isCardCoverKey,
} from './constants';

const admin = { id: ID.user, role: 'admin' } as const;
const member = { id: ID.user, role: 'member' } as const;
const other = { id: ID.user2, role: 'member' } as const;

describe('canAccessCard (ADR 0015)', () => {
  it('card team: todo usuário ativo enxerga', () => {
    const card = { visibility: 'team', viewerIds: [] } as const;
    expect(canAccessCard(card, member)).toBe(true);
    expect(canAccessCard(card, other)).toBe(true);
    expect(canAccessCard(card, admin)).toBe(true);
  });

  it('card restrito: viewer sim, não-viewer não', () => {
    const card = { visibility: 'restricted', viewerIds: [ID.user] } as const;
    expect(canAccessCard(card, member)).toBe(true);
    expect(canAccessCard(card, other)).toBe(false);
  });

  it('Admin enxerga card restrito mesmo fora da lista (RN28)', () => {
    expect(canAccessCard({ visibility: 'restricted', viewerIds: [] }, admin)).toBe(true);
    expect(canAccessCard({ visibility: 'restricted', viewerIds: [ID.user2] }, admin)).toBe(true);
  });

  it('só existem duas visibilidades', () => {
    expect(CARD_VISIBILITIES).toEqual(['team', 'restricted']);
  });
});

describe('chave da capa no R2 (ADR 0016)', () => {
  const key = `${cardCoverKeyPrefix(ID.card)}abcdefghijklmnopqrstuvwxyz012345`;

  it('aceita a chave do próprio card', () => {
    expect(isCardCoverKey(key, ID.card)).toBe(true);
  });

  it('recusa chave de outro card, prefixo errado e sufixo fora do formato', () => {
    expect(isCardCoverKey(key, ID.board)).toBe(false);
    expect(isCardCoverKey(`uploads/${ID.card}/abcdefghijklmnopqrstuvwxyz012345`, ID.card)).toBe(
      false,
    );
    expect(isCardCoverKey(`${cardCoverKeyPrefix(ID.card)}curto`, ID.card)).toBe(false);
    expect(
      isCardCoverKey(`${cardCoverKeyPrefix(ID.card)}../fora/de/casa/aaaaaaaaaaaa`, ID.card),
    ).toBe(false);
  });

  it('limites da capa: 5 MiB e quatro tipos de imagem', () => {
    expect(CARD_COVER_MAX_BYTES).toBe(5_242_880);
    expect(CARD_COVER_CONTENT_TYPES).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/avif',
    ]);
  });
});
