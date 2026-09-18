import {
  PASSWORD_RESET_TTL_MS,
  passwordResetLinkResponseSchema,
  passwordResetLookupResponseSchema,
} from '@raphasparda/ronin-shared';
import { and, eq, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { expectError, MISSING_ID, seedActor, seedTeam, type Actor } from '../../../../test/actors';
import { csrfHeaders } from '../../../../test/app';
import {
  createDbTestApp,
  createTestClock,
  DEFAULT_PASSWORD,
  jsonMutationHeaders,
} from '../../../../test/auth';
import { describeDb, useTestDatabase } from '../../../../test/db';
import type { App } from '../../../app';
import { authTokens, sessions, users } from '../../../db/schema';
import { sha256Hex } from '../../../lib/tokens';

describeDb('redefinição de senha (ronin_test)', () => {
  const { db } = useTestDatabase();
  const clock = createTestClock();
  let app: App;
  let admin: Actor;
  let member: Actor;

  beforeEach(async () => {
    clock.set(new Date('2026-09-16T12:00:00.000Z'));
    app = await createDbTestApp({ clock: clock.now });
    ({ admin, member } = await seedTeam(db(), clock.now()));
  });

  afterEach(async () => {
    await app.close();
  });

  const createLink = (userId: string, headers = admin.headers) =>
    app.inject({ method: 'POST', url: `/api/admin/users/${userId}/password-reset-links`, headers });

  async function link(userId: string) {
    const res = await createLink(userId);
    expect(res.statusCode).toBe(201);
    const body = passwordResetLinkResponseSchema.parse(res.json());
    return { ...body, token: body.url.split('#token=')[1] ?? '' };
  }

  const lookup = (token: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/password-resets/lookup',
      headers: csrfHeaders(),
      payload: { token },
    });

  const complete = (body: unknown, headers = csrfHeaders()) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/password-resets/complete',
      headers,
      payload: body as object,
    });

  const login = (email: string, password: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: jsonMutationHeaders(),
      payload: JSON.stringify({ email, password }),
    });

  describe('POST /api/admin/users/:userId/password-reset-links', () => {
    it('201 com URL de fragmento e 24 h; novo link revoga o anterior; token só como hash', async () => {
      const res = await createLink(member.user.id);
      expect(res.statusCode).toBe(201);
      const first = passwordResetLinkResponseSchema.strict().parse(res.json());
      expect(first.url).toMatch(
        /^http:\/\/localhost:5173\/redefinir-senha#token=[A-Za-z0-9_-]{43}$/,
      );
      expect(first.expiresAt).toBe(
        new Date(clock.now().getTime() + PASSWORD_RESET_TTL_MS).toISOString(),
      );
      const firstToken = first.url.split('#token=')[1] ?? '';

      const second = await link(member.user.id);
      const rows = await db().select().from(authTokens);
      expect(rows.map((r) => r.tokenHash).sort()).toEqual(
        [sha256Hex(firstToken), sha256Hex(second.token)].sort(),
      );
      expect(JSON.stringify(rows)).not.toContain(firstToken);
      expectError(await lookup(firstToken), 410, 'TOKEN_INVALID');
      expect((await lookup(second.token)).statusCode).toBe(200);
    });

    it('409 USER_ANONYMIZED antes de USER_NOT_ACTIVE; 404; 400; 403 Member; 403 CSRF; 401', async () => {
      const deactivated = await seedActor(
        db(),
        { role: 'member', status: 'deactivated' },
        clock.now(),
      );
      expectError(await createLink(deactivated.user.id), 409, 'USER_NOT_ACTIVE');

      const anonymized = await seedActor(db(), { role: 'member' }, clock.now());
      await db()
        .update(users)
        .set({
          status: 'deactivated',
          anonymizedAt: clock.now(),
          email: null,
          passwordHash: null,
          name: 'Usuário removido',
        })
        .where(eq(users.id, anonymized.user.id));
      expectError(await createLink(anonymized.user.id), 409, 'USER_ANONYMIZED');

      expectError(await createLink(MISSING_ID), 404, 'NOT_FOUND');
      expectError(await createLink('nao-uuid'), 400, 'VALIDATION_ERROR');
      expectError(await createLink(admin.user.id, member.headers), 403, 'FORBIDDEN');
      expectError(await createLink(member.user.id, { cookie: admin.cookie }), 403, 'CSRF_REJECTED');
      expectError(await createLink(member.user.id, csrfHeaders()), 401, 'UNAUTHENTICATED');
      expect(await db().$count(authTokens)).toBe(0);
    });
  });

  describe('POST /api/auth/password-resets/lookup', () => {
    it('200 com o nome; 410 expirado, alvo desativado ou inexistente; 400 malformado', async () => {
      const { token, expiresAt } = await link(member.user.id);
      const ok = await lookup(token);
      expect(ok.statusCode).toBe(200);
      expect(passwordResetLookupResponseSchema.strict().parse(ok.json())).toEqual({
        userName: 'Beto Membro',
        expiresAt,
      });

      clock.advance(PASSWORD_RESET_TTL_MS);
      expect(expectError(await lookup(token), 410, 'TOKEN_INVALID').message).toBe(
        'Link de redefinição inválido.',
      );
      clock.set(new Date('2026-09-16T12:00:00.000Z'));

      await db().update(users).set({ status: 'deactivated' }).where(eq(users.id, member.user.id));
      expectError(await lookup(token), 410, 'TOKEN_INVALID');
      expectError(await lookup('B'.repeat(43)), 410, 'TOKEN_INVALID');
      expectError(await lookup('###'), 400, 'VALIDATION_ERROR');
    });
  });

  describe('POST /api/auth/password-resets/complete', () => {
    it('204: troca a senha, encerra todas as sessões, não cria sessão e consome o token', async () => {
      await seedActor(db(), { role: 'member' }, clock.now());
      const { token } = await link(member.user.id);
      await db()
        .insert(sessions)
        .values({
          id: 'f'.repeat(64),
          userId: member.user.id,
          idleExpiresAt: new Date('2026-10-01T00:00:00Z'),
          absoluteExpiresAt: new Date('2026-10-01T00:00:00Z'),
        });

      clock.advance(1_000);
      const res = await complete({ token, password: 'nova-senha-segura' });
      expect(res.statusCode).toBe(204);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(await db().$count(sessions, eq(sessions.userId, member.user.id))).toBe(0);
      expect(await db().$count(sessions, eq(sessions.userId, admin.user.id))).toBe(1);

      const oldSession = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: member.cookie },
      });
      expectError(oldSession, 401, 'UNAUTHENTICATED');
      const [row] = await db().select().from(users).where(eq(users.id, member.user.id));
      expect(row?.passwordChangedAt).toEqual(clock.now());
      expectError(
        await login(member.user.email ?? '', DEFAULT_PASSWORD),
        401,
        'INVALID_CREDENTIALS',
      );
      expect((await login(member.user.email ?? '', 'nova-senha-segura')).statusCode).toBe(200);

      expectError(await complete({ token, password: 'outra-senha-segura' }), 410, 'TOKEN_INVALID');
      expect(
        await db().$count(
          authTokens,
          and(eq(authTokens.targetUserId, member.user.id), isNull(authTokens.usedAt)),
        ),
      ).toBe(0);
    });

    it('400 senha igual ao e-mail (path password) sem consumir; 400 senha curta; 410 inválido; 403 CSRF', async () => {
      const { token } = await link(member.user.id);
      const same = expectError(
        await complete({ token, password: `  ${(member.user.email ?? '').toUpperCase()} ` }),
        400,
        'VALIDATION_ERROR',
      );
      expect(same.details).toEqual([{ path: 'password', message: expect.any(String) as string }]);
      expectError(await complete({ token, password: 'curta' }), 400, 'VALIDATION_ERROR');
      expectError(
        await complete({ token: 'C'.repeat(43), password: 'senha-valida-123' }),
        410,
        'TOKEN_INVALID',
      );
      expectError(
        await complete(
          { token, password: 'senha-valida-123' },
          { 'content-type': 'application/json' },
        ),
        403,
        'CSRF_REJECTED',
      );
      expect((await lookup(token)).statusCode).toBe(200);
    });

    it('usuário desativado depois de gerado o link → 410', async () => {
      const { token } = await link(member.user.id);
      await app.inject({
        method: 'POST',
        url: `/api/admin/users/${member.user.id}/deactivate`,
        headers: admin.headers,
      });
      expectError(await complete({ token, password: 'senha-valida-123' }), 410, 'TOKEN_INVALID');
    });
  });
});
