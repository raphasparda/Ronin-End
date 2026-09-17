import { describe, expect, it } from 'vitest';

import { ID } from '../test-fixtures';

import { BOARD_VISIBILITIES, canAccessBoard } from './board-access';
import {
  BOARD_COVER_CONTENT_TYPES,
  BOARD_COVER_MAX_BYTES,
  boardCoverKeyPrefix,
  isBoardCoverKey,
} from './constants';

const admin = { id: ID.user, role: 'admin' } as const;
const member = { id: ID.user, role: 'member' } as const;
const other = { id: ID.user2, role: 'member' } as const;

describe('canAccessBoard (ADR 0015)', () => {
  it('quadro team: todo usuário ativo enxerga', () => {
    const board = { visibility: 'team', viewerIds: [] } as const;
    expect(canAccessBoard(board, member)).toBe(true);
    expect(canAccessBoard(board, other)).toBe(true);
    expect(canAccessBoard(board, admin)).toBe(true);
  });

  it('quadro restrito: viewer sim, não-viewer não', () => {
    const board = { visibility: 'restricted', viewerIds: [ID.user] } as const;
    expect(canAccessBoard(board, member)).toBe(true);
    expect(canAccessBoard(board, other)).toBe(false);
  });

  it('Admin enxerga quadro restrito mesmo fora da lista (RN28)', () => {
    expect(canAccessBoard({ visibility: 'restricted', viewerIds: [] }, admin)).toBe(true);
    expect(canAccessBoard({ visibility: 'restricted', viewerIds: [ID.user2] }, admin)).toBe(true);
  });

  it('só existem duas visibilidades', () => {
    expect(BOARD_VISIBILITIES).toEqual(['team', 'restricted']);
  });
});

describe('chave da capa no R2 (ADR 0016)', () => {
  const key = `${boardCoverKeyPrefix(ID.board)}abcdefghijklmnopqrstuvwxyz012345`;

  it('aceita a chave do próprio quadro', () => {
    expect(isBoardCoverKey(key, ID.board)).toBe(true);
  });

  it('recusa chave de outro quadro, prefixo errado e sufixo fora do formato', () => {
    expect(isBoardCoverKey(key, ID.board2)).toBe(false);
    expect(isBoardCoverKey(`uploads/${ID.board}/abcdefghijklmnopqrstuvwxyz012345`, ID.board)).toBe(
      false,
    );
    expect(isBoardCoverKey(`${boardCoverKeyPrefix(ID.board)}curto`, ID.board)).toBe(false);
    expect(
      isBoardCoverKey(`${boardCoverKeyPrefix(ID.board)}../fora/de/casa/aaaaaaaaaaaa`, ID.board),
    ).toBe(false);
  });

  it('limites da capa: 5 MiB e quatro tipos de imagem', () => {
    expect(BOARD_COVER_MAX_BYTES).toBe(5_242_880);
    expect(BOARD_COVER_CONTENT_TYPES).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/avif',
    ]);
  });
});
