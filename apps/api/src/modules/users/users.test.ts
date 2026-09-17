import { randomBytes } from 'node:crypto';

import {
  adminUserResponseSchema,
  adminUsersResponseSchema,
  usersResponseSchema,
  workspaceResponseSchema,
} from '@kanban/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { expectError, MISSING_ID, seedActor, seedTeam, type Actor } from '../../../test/actors';
import { csrfHeaders } from '../../../test/app';
import { createDbTestApp, createTestClock } from '../../../test/auth';
import { describeDb, useTestDatabase } from '../../../test/db';
import type { App } from '../../app';
import {
  authTokens,
  sessions,
  users,
  workspace,
  type AuthTokenRow,
  type NewAuthTokenRow,
} from '../../db/schema';
import { sha256Hex } from '../../lib/tokens';

import { changeUserRole, deactivateUser } from './service';

describeDb('usuários e administração (kanban_test)', () => {
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

  const anonymize = (userId: string) =>
    db()
      .update(users)
      .set({
        status: 'deactivated',
        anonymizedAt: clock.now(),
        email: null,
        passwordHash: null,
        name: 'Usuário removido',
      })
      .where(eq(users.id, userId));

  const patchRole = (userId: string, role: unknown, headers = admin.headers) =>
    app.inject({ method: 'PATCH', url: `/api/admin/users/${userId}`, headers, payload: { role } });

  const userAction = (userId: string, name: 'deactivate' | 'reactivate', headers = admin.headers) =>
    app.inject({ method: 'POST', url: `/api/admin/users/${userId}/${name}`, headers });

  describe('GET /api/users', () => {
    it('todos os usuários por nome, sem e-mail, com status e anonimização', async () => {
      const gone = await seedActor(db(), { role: 'member', name: 'Zé' }, clock.now());
      await anonymize(gone.user.id);
      await seedActor(db(), { role: 'member', name: 'Carla', status: 'deactivated' }, clock.now());

      const res = await app.inject({
        method: 'GET',
        url: '/api/users',
        headers: { cookie: member.cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain('@exemplo.com');
      const body = usersResponseSchema.strict().parse(res.json());
      expect(body.users.map((u) => [u.name, u.status, u.anonymized])).toEqual([
        ['Ana Admin', 'active', false],
        ['Beto Membro', 'active', false],
        ['Carla', 'deactivated', false],
        ['Usuário removido', 'deactivated', true],
      ]);
      expect(Object.keys(body.users[0] ?? {}).sort()).toEqual([
        'anonymized',
        'id',
        'name',
        'role',
        'status',
      ]);
      expectError(await app.inject({ method: 'GET', url: '/api/users' }), 401, 'UNAUTHENTICATED');
    });
  });

  describe('GET /api/admin/users', () => {
    it('Admin vê e-mail e criação; Member → 403; sem sessão → 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { cookie: admin.cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = adminUsersResponseSchema.strict().parse(res.json());
      expect(body.users[0]).toMatchObject({
        id: admin.user.id,
        email: admin.user.email,
        createdAt: admin.user.createdAt.toISOString(),
      });
      expectError(
        await app.inject({
          method: 'GET',
          url: '/api/admin/users',
          headers: { cookie: member.cookie },
        }),
        403,
        'FORBIDDEN',
      );
      expectError(
        await app.inject({ method: 'GET', url: '/api/admin/users' }),
        401,
        'UNAUTHENTICATED',
      );
    });
  });

  describe('PATCH /api/admin/users/:userId', () => {
    it('promove e rebaixa; mudança de papel vale na hora', async () => {
      const up = await patchRole(member.user.id, 'admin');
      expect(up.statusCode).toBe(200);
      expect(adminUserResponseSchema.strict().parse(up.json()).user).toMatchObject({
        id: member.user.id,
        role: 'admin',
      });
      const asNewAdmin = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { cookie: member.cookie },
      });
      expect(asNewAdmin.statusCode).toBe(200);

      const down = await patchRole(member.user.id, 'member');
      expect(adminUserResponseSchema.parse(down.json()).user.role).toBe('member');
      expect((await patchRole(member.user.id, 'member')).statusCode).toBe(200);
    });

    it('409 CANNOT_TARGET_SELF e USER_ANONYMIZED', async () => {
      expectError(await patchRole(admin.user.id, 'member'), 409, 'CANNOT_TARGET_SELF');

      const gone = await seedActor(db(), { role: 'member' }, clock.now());
      await anonymize(gone.user.id);
      expectError(await patchRole(gone.user.id, 'admin'), 409, 'USER_ANONYMIZED');
    });

    it('LAST_ADMIN: dois Admins rebaixando um ao outro ao mesmo tempo → só um vence', async () => {
      const other = await seedActor(db(), { role: 'admin' }, clock.now());
      const results = await Promise.all([
        patchRole(other.user.id, 'member', admin.headers),
        patchRole(admin.user.id, 'member', other.headers),
      ]);
      const statuses = results.map((r) => r.statusCode).sort();
      expect(statuses[0]).toBe(200);
      // O segundo pode perder o papel antes do preHandler (403) ou esbarrar na regra (409).
      expect([403, 409]).toContain(statuses[1]);
      expect(await db().$count(users, eq(users.role, 'admin'))).toBe(1);
    });

    it('400, 404, 403 Member, 403 CSRF, 401', async () => {
      expectError(await patchRole(member.user.id, 'dono'), 400, 'VALIDATION_ERROR');
      expectError(await patchRole(MISSING_ID, 'admin'), 404, 'NOT_FOUND');
      expectError(await patchRole(member.user.id, 'admin', member.headers), 403, 'FORBIDDEN');
      expectError(
        await patchRole(member.user.id, 'admin', { cookie: admin.cookie }),
        403,
        'CSRF_REJECTED',
      );
      expectError(await patchRole(member.user.id, 'admin', csrfHeaders()), 401, 'UNAUTHENTICATED');
    });
  });

  describe('POST /api/admin/users/:userId/deactivate|reactivate', () => {
    it('desativar derruba as sessões e revoga resets pendentes; idempotente; reativar volta', async () => {
      const linkRes = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${member.user.id}/password-reset-links`,
        headers: admin.headers,
      });
      expect(linkRes.statusCode).toBe(201);

      const res = await userAction(member.user.id, 'deactivate');
      expect(res.statusCode).toBe(200);
      expect(adminUserResponseSchema.strict().parse(res.json()).user).toMatchObject({
        status: 'deactivated',
      });
      expect(await db().$count(sessions, eq(sessions.userId, member.user.id))).toBe(0);
      const [token] = await db().select().from(authTokens);
      expect(token?.revokedAt).toEqual(clock.now());
      expectError(
        await app.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { cookie: member.cookie },
        }),
        401,
        'UNAUTHENTICATED',
      );
      expect((await userAction(member.user.id, 'deactivate')).statusCode).toBe(200);

      const back = await userAction(member.user.id, 'reactivate');
      expect(adminUserResponseSchema.parse(back.json()).user.status).toBe('active');
      expect((await userAction(member.user.id, 'reactivate')).statusCode).toBe(200);
    });

    it('409 CANNOT_TARGET_SELF; LAST_ADMIN concorrente; USER_ANONYMIZED ao reativar', async () => {
      expectError(await userAction(admin.user.id, 'deactivate'), 409, 'CANNOT_TARGET_SELF');

      const other = await seedActor(db(), { role: 'admin' }, clock.now());
      const results = await Promise.all([
        userAction(other.user.id, 'deactivate', admin.headers),
        userAction(admin.user.id, 'deactivate', other.headers),
      ]);
      const statuses = results.map((r) => r.statusCode).sort();
      expect(statuses[0]).toBe(200);
      // O perdedor pode ter a sessão derrubada antes (401) ou esbarrar na regra (409).
      expect([401, 409]).toContain(statuses[1]);
      expect(await db().$count(users, eq(users.status, 'active'))).toBe(2);
      const activeAdmins = await db().select().from(users).where(eq(users.role, 'admin'));
      expect(activeAdmins.filter((u) => u.status === 'active')).toHaveLength(1);

      const gone = await seedActor(db(), { role: 'member' }, clock.now());
      await anonymize(gone.user.id);
      expectError(await userAction(gone.user.id, 'reactivate'), 409, 'USER_ANONYMIZED');
    });

    it('404, 400, 403 Member, 403 CSRF, 401', async () => {
      for (const name of ['deactivate', 'reactivate'] as const) {
        expectError(await userAction(MISSING_ID, name), 404, 'NOT_FOUND');
        expectError(await userAction('x', name), 400, 'VALIDATION_ERROR');
        expectError(await userAction(admin.user.id, name, member.headers), 403, 'FORBIDDEN');
        expectError(
          await userAction(member.user.id, name, { cookie: admin.cookie }),
          403,
          'CSRF_REJECTED',
        );
        expectError(await userAction(member.user.id, name, csrfHeaders()), 401, 'UNAUTHENTICATED');
      }
    });
  });

  describe('tokens emitidos por quem perde o papel de Admin (api.md §18.5)', () => {
    const insertToken = async (values: Partial<NewAuthTokenRow> & { createdBy: string }) => {
      const [row] = await db()
        .insert(authTokens)
        .values({
          kind: 'invite',
          role: 'member',
          tokenHash: sha256Hex(randomBytes(16).toString('hex')),
          expiresAt: new Date(clock.now().getTime() + 86_400_000),
          ...values,
        })
        .returning();
      if (!row) throw new Error('insert falhou');
      return row;
    };

    /**
     * `issuer` (Admin) emite, pela API, um convite e um link de redefinição para `member`; os
     * tokens de controle (de outro Admin, já usado, expirado, já revogado) não podem mudar.
     */
    async function seedIssuerTokens(issuer: Actor) {
      const invite = await app.inject({
        method: 'POST',
        url: '/api/admin/invites',
        headers: issuer.headers,
        payload: { email: null, role: 'member' },
      });
      expect(invite.statusCode).toBe(201);
      const reset = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${member.user.id}/password-reset-links`,
        headers: issuer.headers,
      });
      expect(reset.statusCode).toBe(201);

      const past = new Date(clock.now().getTime() - 60_000);
      const controls = [
        await insertToken({ createdBy: admin.user.id }),
        await insertToken({ createdBy: issuer.user.id, usedAt: past }),
        await insertToken({ createdBy: issuer.user.id, expiresAt: past }),
        await insertToken({ createdBy: issuer.user.id, revokedAt: past }),
      ];
      const pendingIds = (
        await db().select().from(authTokens).where(eq(authTokens.createdBy, issuer.user.id))
      )
        .filter((t) => !controls.some((c) => c.id === t.id))
        .map((t) => t.id);
      expect(pendingIds).toHaveLength(2);
      return { pendingIds, controls };
    }

    async function expectRevoked(pendingIds: string[], controls: AuthTokenRow[]) {
      const rows = await db().select().from(authTokens);
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const id of pendingIds) expect(byId.get(id)?.revokedAt).toEqual(clock.now());
      for (const control of controls) {
        expect(byId.get(control.id)?.revokedAt).toEqual(control.revokedAt);
      }
    }

    it('desativar um Admin revoga, na mesma transação, convites e redefinições pendentes que ele criou', async () => {
      const issuer = await seedActor(db(), { role: 'admin' }, clock.now());
      const { pendingIds, controls } = await seedIssuerTokens(issuer);
      clock.advance(1000);

      expect((await userAction(issuer.user.id, 'deactivate')).statusCode).toBe(200);
      await expectRevoked(pendingIds, controls);
    });

    it('rebaixar um Admin para Member revoga os tokens pendentes que ele criou; reatribuir o mesmo papel não mexe', async () => {
      const issuer = await seedActor(db(), { role: 'admin' }, clock.now());
      const { pendingIds, controls } = await seedIssuerTokens(issuer);
      clock.advance(1000);

      // Mesmo papel: no-op, nada revogado.
      expect((await patchRole(issuer.user.id, 'admin')).statusCode).toBe(200);
      const untouched = await db().select().from(authTokens);
      for (const id of pendingIds) {
        expect(untouched.find((t) => t.id === id)?.revokedAt).toBeNull();
      }

      expect((await patchRole(issuer.user.id, 'member')).statusCode).toBe(200);
      await expectRevoked(pendingIds, controls);
    });

    it('falha na regra (LAST_ADMIN) não revoga nada (rollback)', async () => {
      const issuer = await seedActor(db(), { role: 'admin' }, clock.now());
      const { pendingIds } = await seedIssuerTokens(issuer);
      await db().update(users).set({ status: 'deactivated' }).where(eq(users.id, admin.user.id));
      await expect(
        deactivateUser(db(), { actorId: member.user.id, now: clock.now() }, issuer.user.id),
      ).rejects.toMatchObject({ code: 'LAST_ADMIN' });
      const rows = await db().select().from(authTokens);
      for (const id of pendingIds) {
        expect(rows.find((t) => t.id === id)?.revokedAt).toBeNull();
      }
    });
  });

  describe('regra do último Admin ativo (serviço)', () => {
    // Pela API o ator é sempre um Admin ativo diferente do alvo, então LAST_ADMIN só aparece em
    // corrida (testada acima). Aqui o ator já perdeu o papel, como no meio de uma corrida.
    it('rebaixar ou desativar o único Admin ativo → LAST_ADMIN, sem alterar nada', async () => {
      const ctx = { actorId: member.user.id, now: clock.now() };
      await expect(changeUserRole(db(), ctx, admin.user.id, 'member')).rejects.toMatchObject({
        code: 'LAST_ADMIN',
      });
      await expect(deactivateUser(db(), ctx, admin.user.id)).rejects.toMatchObject({
        code: 'LAST_ADMIN',
      });
      const [row] = await db().select().from(users).where(eq(users.id, admin.user.id));
      expect(row).toMatchObject({ role: 'admin', status: 'active' });
    });

    it('Admin desativado pode ser rebaixado mesmo com um único Admin ativo', async () => {
      const other = await seedActor(db(), { role: 'admin' }, clock.now());
      await db().update(users).set({ status: 'deactivated' }).where(eq(users.id, other.user.id));
      const updated = await changeUserRole(
        db(),
        { actorId: admin.user.id, now: clock.now() },
        other.user.id,
        'member',
      );
      expect(updated.role).toBe('member');
    });
  });

  describe('PATCH /api/admin/workspace', () => {
    const patch = (body: unknown, headers: Record<string, string>) =>
      app.inject({
        method: 'PATCH',
        url: '/api/admin/workspace',
        headers,
        payload: body as object,
      });

    it('200 altera nome e/ou fuso', async () => {
      const res = await patch({ name: ' Nova Equipe ' }, admin.headers);
      expect(res.statusCode).toBe(200);
      expect(workspaceResponseSchema.strict().parse(res.json())).toEqual({
        workspace: { name: 'Nova Equipe', timezone: 'America/Sao_Paulo' },
      });
      const tz = await patch({ timezone: 'America/Manaus' }, admin.headers);
      expect(workspaceResponseSchema.parse(tz.json()).workspace).toEqual({
        name: 'Nova Equipe',
        timezone: 'America/Manaus',
      });
      const [row] = await db().select().from(workspace);
      expect(row?.timezone).toBe('America/Manaus');
    });

    it('400 (vazio, fuso inválido), 403 Member, 403 CSRF, 401', async () => {
      expectError(await patch({}, admin.headers), 400, 'VALIDATION_ERROR');
      expectError(
        await patch({ timezone: 'Marte/Olympus' }, admin.headers),
        400,
        'VALIDATION_ERROR',
      );
      expectError(await patch({ name: 'X' }, member.headers), 403, 'FORBIDDEN');
      expectError(await patch({ name: 'X' }, { cookie: admin.cookie }), 403, 'CSRF_REJECTED');
      expectError(await patch({ name: 'X' }, csrfHeaders()), 401, 'UNAUTHENTICATED');
    });
  });
});
