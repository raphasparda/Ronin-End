import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { isTokenFormat, randomToken, sha256Hex, TOKEN_PATTERN } from './tokens';

describe('lib/tokens', () => {
  it('randomToken: 32 bytes em base64url (43 caracteres) e sempre diferente', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => randomToken()));
    expect(tokens.size).toBe(50);
    for (const token of tokens) {
      expect(token).toMatch(TOKEN_PATTERN);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    }
  });

  it('isTokenFormat aceita só o formato gerado', () => {
    expect(isTokenFormat(randomToken())).toBe(true);
    expect(isTokenFormat('curto')).toBe(false);
    expect(isTokenFormat(`${randomToken()}a`)).toBe(false);
    expect(isTokenFormat('+'.repeat(43))).toBe(false);
    expect(isTokenFormat(undefined)).toBe(false);
  });

  it('sha256Hex: 64 caracteres hex minúsculos (formato de sessions.id)', () => {
    const token = randomToken();
    const digest = sha256Hex(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).toBe(createHash('sha256').update(token).digest('hex'));
    expect(sha256Hex(token)).toBe(digest);
  });
});
