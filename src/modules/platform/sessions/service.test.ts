import { describe, expect, it } from 'vitest';

import type { SessionWithUser } from './repository';
import {
  checkSession,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_MS,
  SESSION_TOUCH_INTERVAL_MS,
} from './service';

const created = new Date('2026-09-01T00:00:00.000Z');
const at = (ms: number) => new Date(created.getTime() + ms);

function found(overrides: {
  session?: Partial<SessionWithUser['session']>;
  user?: Partial<SessionWithUser['user']>;
}): SessionWithUser {
  return {
    session: {
      id: 'a'.repeat(64),
      userId: 'u',
      createdAt: created,
      lastSeenAt: created,
      idleExpiresAt: at(SESSION_IDLE_TTL_MS),
      absoluteExpiresAt: at(SESSION_ABSOLUTE_TTL_MS),
      ...overrides.session,
    },
    user: {
      id: '8a4b6f0e-3c2d-4e5f-9a1b-2c3d4e5f6a7b',
      name: 'Ana',
      email: 'ana@exemplo.com',
      role: 'member',
      status: 'active',
      anonymizedAt: null,
      avatarUpdatedAt: null,
      ...overrides.user,
    },
  };
}

describe('checkSession', () => {
  it('14 dias ociosa e 30 dias absoluta', () => {
    expect(SESSION_IDLE_TTL_MS).toBe(14 * 86_400_000);
    expect(SESSION_ABSOLUTE_TTL_MS).toBe(30 * 86_400_000);
  });

  it('válida devolve o SessionUser (sem campos extras)', () => {
    const result = checkSession(found({}), at(1_000));
    expect(result).toEqual({
      valid: true,
      needsTouch: false,
      user: {
        id: '8a4b6f0e-3c2d-4e5f-9a1b-2c3d4e5f6a7b',
        name: 'Ana',
        email: 'ana@exemplo.com',
        role: 'member',
        avatarUpdatedAt: null,
      },
    });
  });

  it('renova last_seen_at só depois de 5 min', () => {
    expect(checkSession(found({}), at(SESSION_TOUCH_INTERVAL_MS - 1))).toMatchObject({
      needsTouch: false,
    });
    expect(checkSession(found({}), at(SESSION_TOUCH_INTERVAL_MS))).toMatchObject({
      needsTouch: true,
    });
  });

  it('expira no limite ocioso e no absoluto', () => {
    expect(checkSession(found({}), at(SESSION_IDLE_TTL_MS))).toEqual({
      valid: false,
      reason: 'idle_expired',
    });
    const renewed = found({ session: { idleExpiresAt: at(SESSION_ABSOLUTE_TTL_MS + 1_000) } });
    expect(checkSession(renewed, at(SESSION_ABSOLUTE_TTL_MS))).toEqual({
      valid: false,
      reason: 'absolute_expired',
    });
  });

  it('usuário desativado ou anonimizado invalida a sessão', () => {
    expect(checkSession(found({ user: { status: 'deactivated' } }), at(1))).toEqual({
      valid: false,
      reason: 'user_inactive',
    });
    expect(
      checkSession(
        found({ user: { status: 'deactivated', anonymizedAt: created, email: null } }),
        at(1),
      ),
    ).toMatchObject({ valid: false });
  });
});
