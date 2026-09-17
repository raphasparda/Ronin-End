import {
  acceptInviteResponseSchema,
  createInviteResponseSchema,
  INVITE_TTL_MS,
  inviteLookupResponseSchema,
  invitesResponseSchema,
} from '@kanban/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { expectError, MISSING_ID, seedTeam, type Actor } from '../../../test/actors';
import { csrfHeaders } from '../../../test/app';
import { cookieHeaderOf, createDbTestApp, createTestClock, seedUser } from '../../../test/auth';
import { describeDb, useTestDatabase } from '../../../test/db';
import type { App } from '../../app';
import { authTokens, sessions, users } from '../../db/schema';
import { sha256Hex } from '../../lib/tokens';

const APP_ORIGIN = 'http://localhost:5173';

describeDb('convites (kanban_test)', () => {
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

  const createInvite = (body: unknown, headers = admin.headers) =>
    app.inject({ method: 'POST', url: '/api/admin/invites', headers, payload: body as object });

  async function invite(body: { email?: string | null; role: 'admin' | 'member' }) {
    const res = await createInvite(body);
    expect(res.statusCode).toBe(201);
    const parsed = createInviteResponseSchema.parse(res.json());
    const token = parsed.url.split('#token=')[1] ?? '';
    return { ...parsed, token };
  }

  const lookup = (token: unknown, remoteAddress?: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/invites/lookup',
      headers: csrfHeaders(),
      payload: { token },
      ...(remoteAddress ? { remoteAddress } : {}),
    });

  const accept = (body: unknown, extra: Record<string, string> = {}, remoteAddress?: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/invites/accept',
      headers: { ...csrfHeaders(), ...extra },
      payload: body as object,
      ...(remoteAddress ? { remoteAddress } : {}),
    });

  const newcomer = (token: string, email = 'nova@exemplo.com') => ({
    token,
    name: ' Nova Pessoa ',
    email,
    password: 'senha-da-nova-pessoa',
  });

  describe('POST /api/admin/invites', () => {
    it('201 com URL de fragmento; banco guarda só o SHA-256; email ausente vira null', async () => {
      const res = await createInvite({ role: 'member' });
      expect(res.statusCode).toBe(201);
      const body = createInviteResponseSchema.strict().parse(res.json());
      expect(body.url).toMatch(new RegExp(`^${APP_ORIGIN}/convite#token=[A-Za-z0-9_-]{43}$`));
      expect(body.invite).toEqual({
        id: body.invite.id,
        email: null,
        role: 'member',
        createdBy: admin.user.id,
        createdAt: '2026-09-16T12:00:00.000Z',
        expiresAt: new Date(clock.now().getTime() + INVITE_TTL_MS).toISOString(),
        state: 'pending',
        usedByUserId: null,
      });

      const token = body.url.split('#token=')[1] ?? '';
      const rows = await db().select().from(authTokens);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tokenHash).toBe(sha256Hex(token));
      expect(JSON.stringify(rows)).not.toContain(token);

      const withEmail = await createInvite({ email: ' Fixo@Exemplo.com ', role: 'admin' });
      expect(createInviteResponseSchema.parse(withEmail.json()).invite).toMatchObject({
        email: 'fixo@exemplo.com',
        role: 'admin',
      });
      const explicitNull = await createInvite({ email: null, role: 'member' });
      expect(explicitNull.statusCode).toBe(201);
    });

    it('409 EMAIL_TAKEN; 400 (e-mail vazio, papel inválido); 403 Member; 403 CSRF; 401', async () => {
      expectError(
        await createInvite({ email: member.user.email, role: 'member' }),
        409,
        'EMAIL_TAKEN',
      );
      expectError(await createInvite({ email: '', role: 'member' }), 400, 'VALIDATION_ERROR');
      expectError(await createInvite({ role: 'owner' }), 400, 'VALIDATION_ERROR');
      expectError(await createInvite({ role: 'member' }, member.headers), 403, 'FORBIDDEN');
      expectError(
        await createInvite({ role: 'member' }, { cookie: admin.cookie }),
        403,
        'CSRF_REJECTED',
      );
      expectError(await createInvite({ role: 'member' }, csrfHeaders()), 401, 'UNAUTHENTICATED');
      expect(await db().$count(authTokens)).toBe(0);
    });
  });

  describe('GET /api/admin/invites e DELETE /api/admin/invites/:id', () => {
    it('lista com estados, mais recentes primeiro, sem os antigos já resolvidos', async () => {
      const old = await invite({ role: 'member' });
      await db()
        .update(authTokens)
        .set({
          createdAt: new Date('2026-08-01T00:00:00Z'),
          revokedAt: new Date('2026-08-02T00:00:00Z'),
        })
        .where(eq(authTokens.id, old.invite.id));
      clock.advance(1_000);
      const expired = await invite({ role: 'member' });
      clock.advance(1_000);
      const revoked = await invite({ role: 'member' });
      clock.advance(1_000);
      const used = await invite({ role: 'admin' });
      clock.advance(1_000);
      const pending = await invite({ email: 'p@exemplo.com', role: 'member' });

      await db()
        .update(authTokens)
        .set({ expiresAt: new Date('2026-09-16T12:00:00.500Z') })
        .where(eq(authTokens.id, expired.invite.id));
      const del = await app.inject({
        method: 'DELETE',
        url: `/api/admin/invites/${revoked.invite.id}`,
        headers: admin.headers,
      });
      expect(del.statusCode).toBe(204);
      const accepted = await accept(newcomer(used.token));
      expect(accepted.statusCode).toBe(201);
      const newUserId = acceptInviteResponseSchema.parse(accepted.json()).user.id;

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/invites',
        headers: { cookie: admin.cookie },
      });
      expect(res.statusCode).toBe(200);
      const { invites } = invitesResponseSchema.strict().parse(res.json());
      expect(invites.map((i) => [i.id, i.state])).toEqual([
        [pending.invite.id, 'pending'],
        [used.invite.id, 'used'],
        [revoked.invite.id, 'revoked'],
        [expired.invite.id, 'expired'],
      ]);
      expect(invites[1]?.usedByUserId).toBe(newUserId);
    });

    it('DELETE: idempotente; não revoga usado; 404; 400; 403 Member; 403 CSRF; 401', async () => {
      const { invite: created } = await invite({ role: 'member' });
      const url = `/api/admin/invites/${created.id}`;
      expect((await app.inject({ method: 'DELETE', url, headers: admin.headers })).statusCode).toBe(
        204,
      );
      const [first] = await db().select().from(authTokens);
      clock.advance(10_000);
      expect((await app.inject({ method: 'DELETE', url, headers: admin.headers })).statusCode).toBe(
        204,
      );
      const [second] = await db().select().from(authTokens);
      expect(second?.revokedAt).toEqual(first?.revokedAt);

      const used = await invite({ role: 'member' });
      await accept(newcomer(used.token));
      await app.inject({
        method: 'DELETE',
        url: `/api/admin/invites/${used.invite.id}`,
        headers: admin.headers,
      });
      const [usedRow] = await db()
        .select()
        .from(authTokens)
        .where(eq(authTokens.id, used.invite.id));
      expect(usedRow?.revokedAt).toBeNull();

      expectError(
        await app.inject({
          method: 'DELETE',
          url: `/api/admin/invites/${MISSING_ID}`,
          headers: admin.headers,
        }),
        404,
        'NOT_FOUND',
      );
      expectError(
        await app.inject({
          method: 'DELETE',
          url: '/api/admin/invites/abc',
          headers: admin.headers,
        }),
        400,
        'VALIDATION_ERROR',
      );
      expectError(
        await app.inject({ method: 'DELETE', url, headers: member.headers }),
        403,
        'FORBIDDEN',
      );
      expectError(
        await app.inject({ method: 'DELETE', url, headers: { cookie: admin.cookie } }),
        403,
        'CSRF_REJECTED',
      );
      expectError(
        await app.inject({ method: 'DELETE', url, headers: csrfHeaders() }),
        401,
        'UNAUTHENTICATED',
      );
      expectError(
        await app.inject({
          method: 'GET',
          url: '/api/admin/invites',
          headers: { cookie: member.cookie },
        }),
        403,
        'FORBIDDEN',
      );
      expectError(
        await app.inject({ method: 'GET', url: '/api/admin/invites' }),
        401,
        'UNAUTHENTICATED',
      );
    });
  });

  describe('POST /api/auth/invites/lookup', () => {
    it('200 pendente; 410 expirado, usado, revogado ou inexistente; 400 token malformado', async () => {
      const ok = await invite({ email: 'fixo@exemplo.com', role: 'admin' });
      const res = await lookup(ok.token);
      expect(res.statusCode).toBe(200);
      expect(inviteLookupResponseSchema.strict().parse(res.json())).toEqual({
        email: 'fixo@exemplo.com',
        role: 'admin',
        expiresAt: ok.invite.expiresAt,
      });

      clock.advance(INVITE_TTL_MS);
      const expired = expectError(await lookup(ok.token), 410, 'TOKEN_INVALID');
      expect(expired.message).toBe('Convite inválido.');
      clock.set(new Date('2026-09-16T12:00:00.000Z'));

      const revoked = await invite({ role: 'member' });
      await app.inject({
        method: 'DELETE',
        url: `/api/admin/invites/${revoked.invite.id}`,
        headers: admin.headers,
      });
      expectError(await lookup(revoked.token), 410, 'TOKEN_INVALID');

      const used = await invite({ role: 'member' });
      await accept(newcomer(used.token));
      expectError(await lookup(used.token), 410, 'TOKEN_INVALID');

      expectError(await lookup('A'.repeat(43)), 410, 'TOKEN_INVALID');
      expectError(await lookup('curto'), 400, 'VALIDATION_ERROR');
      expectError(
        await app.inject({
          method: 'POST',
          url: '/api/auth/invites/lookup',
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify({ token: ok.token }),
        }),
        403,
        'CSRF_REJECTED',
      );
    });

    it('rate limit: 10 req / 15 min por IP → 429 RATE_LIMITED', async () => {
      for (let i = 0; i < 10; i++) {
        expect((await lookup('A'.repeat(43), '10.0.0.9')).statusCode).toBe(410);
      }
      const blocked = await lookup('A'.repeat(43), '10.0.0.9');
      expectError(blocked, 429, 'RATE_LIMITED');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(14 * 60);
      expect((await lookup('A'.repeat(43), '10.0.0.10')).statusCode).toBe(410);
    });
  });

  describe('POST /api/auth/invites/accept', () => {
    it('201: cria a conta com o papel do convite, entra (cookie) e consome o token', async () => {
      const { token, invite: created } = await invite({ role: 'admin' });
      const res = await accept(newcomer(token, ' NOVA@exemplo.com '));
      expect(res.statusCode).toBe(201);
      const body = acceptInviteResponseSchema.strict().parse(res.json());
      expect(body).toEqual({
        user: { id: body.user.id, name: 'Nova Pessoa', email: 'nova@exemplo.com', role: 'admin' },
        workspace: { name: 'Ronin', timezone: 'America/Sao_Paulo' },
      });
      const [row] = await db().select().from(authTokens).where(eq(authTokens.id, created.id));
      expect(row).toMatchObject({ usedByUserId: body.user.id, usedAt: clock.now() });

      const me = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: cookieHeaderOf(res) },
      });
      expect(me.statusCode).toBe(200);
      expectError(await accept(newcomer(token, 'outra@exemplo.com')), 410, 'TOKEN_INVALID');
    });

    it('sessão anterior do navegador é descartada', async () => {
      const { token } = await invite({ role: 'member' });
      const before = await db().$count(sessions);
      const res = await accept(newcomer(token), { cookie: member.cookie });
      expect(res.statusCode).toBe(201);
      expect(await db().$count(sessions)).toBe(before);
      const old = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: member.cookie },
      });
      expectError(old, 401, 'UNAUTHENTICATED');
    });

    it('409 INVITE_EMAIL_MISMATCH e 409 EMAIL_TAKEN sem consumir o token', async () => {
      const fixed = await invite({ email: 'fixo@exemplo.com', role: 'member' });
      expectError(
        await accept(newcomer(fixed.token, 'outro@exemplo.com')),
        409,
        'INVITE_EMAIL_MISMATCH',
      );

      const open = await invite({ role: 'member' });
      expectError(await accept(newcomer(open.token, member.user.email ?? '')), 409, 'EMAIL_TAKEN');
      const [row] = await db().select().from(authTokens).where(eq(authTokens.id, open.invite.id));
      expect(row?.usedAt).toBeNull();
      expect((await accept(newcomer(open.token, 'livre@exemplo.com'))).statusCode).toBe(201);
    });

    it('e-mail criado entre a checagem e o INSERT (corrida no UNIQUE) → 409 e token intacto', async () => {
      const { token, invite: created } = await invite({ role: 'member' });
      // Simula a corrida: o e-mail passa a existir só depois das checagens iniciais do serviço.
      const hashed = await app.passwords.hash('x'.repeat(12));
      const originalHash = app.passwords.hash.bind(app.passwords);
      app.passwords.hash = async (password: string) => {
        await seedUser(db(), {
          email: 'corrida@exemplo.com',
          name: 'Corrida',
          passwordHash: hashed,
        });
        return originalHash(password);
      };
      try {
        expectError(await accept(newcomer(token, 'corrida@exemplo.com')), 409, 'EMAIL_TAKEN');
      } finally {
        app.passwords.hash = originalHash;
      }
      const [row] = await db().select().from(authTokens).where(eq(authTokens.id, created.id));
      expect(row?.usedAt).toBeNull();
    });

    it('duas aceitações concorrentes: uma 201, outra 410', async () => {
      const { token } = await invite({ role: 'member' });
      const results = await Promise.all([
        accept(newcomer(token, 'um@exemplo.com')),
        accept(newcomer(token, 'dois@exemplo.com')),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 410]);
      expect(await db().$count(users)).toBe(3);
    });

    it('400 (senha curta, senha = e-mail, token malformado); 410 expirado; 403 CSRF', async () => {
      const { token } = await invite({ role: 'member' });
      expectError(await accept({ ...newcomer(token), password: 'curta' }), 400, 'VALIDATION_ERROR');
      const same = expectError(
        await accept({ ...newcomer(token), password: 'nova@exemplo.com' }),
        400,
        'VALIDATION_ERROR',
      );
      expect(same.details?.[0]?.path).toBe('password');
      expectError(await accept(newcomer('x'.repeat(10))), 400, 'VALIDATION_ERROR');
      clock.advance(INVITE_TTL_MS + 1);
      expectError(await accept(newcomer(token)), 410, 'TOKEN_INVALID');
      clock.set(new Date('2026-09-16T12:00:00.000Z'));
      expectError(
        await app.inject({
          method: 'POST',
          url: '/api/auth/invites/accept',
          headers: { origin: 'http://malicioso.example', 'x-kanban-csrf': '1' },
          payload: newcomer(token),
        }),
        403,
        'CSRF_REJECTED',
      );
      expect(await db().$count(users)).toBe(2);
    });
  });
});
