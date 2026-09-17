import { randomUUID } from 'node:crypto';

import {
  activitiesResponseSchema,
  adminUserResponseSchema,
  ANONYMIZED_USER_NAME,
  cardDetailResponseSchema,
  cardSummaryResponseSchema,
  commentResponseSchema,
  createBoardResponseSchema,
  notificationsResponseSchema,
  usersResponseSchema,
  type List,
} from '@kanban/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { expectError, MISSING_ID, seedActor, seedTeam, type Actor } from '../../../test/actors';
import { csrfHeaders } from '../../../test/app';
import { createDbTestApp, createTestClock, DEFAULT_PASSWORD } from '../../../test/auth';
import { describeDb, useTestDatabase } from '../../../test/db';
import type { App } from '../../app';
import {
  authThrottle,
  authTokens,
  cardAssignees,
  comments,
  notifications,
  sessions,
  users,
} from '../../db/schema';
import { sha256Hex } from '../../lib/tokens';

describeDb('POST /api/admin/users/:userId/anonymize (kanban_test)', () => {
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

  const anonymize = (
    userId: string,
    body: unknown = { confirm: true },
    headers: Record<string, string> = admin.headers,
  ) =>
    app.inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/anonymize`,
      headers,
      payload: body as object,
    });

  const deactivate = async (userId: string) => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/deactivate`,
      headers: admin.headers,
    });
    expect(res.statusCode).toBe(200);
  };

  it('apaga dados pessoais, sessões, tokens e notificações recebidas; mantém cards, comentários, atividades e notificações enviadas', async () => {
    const zeca = await seedActor(db(), { role: 'member', name: 'Zeca Silva' }, clock.now());
    const email = zeca.user.email ?? '';

    // Zeca cria conteúdo: quadro, card, comentário; é responsável; notifica o Admin.
    const boardRes = await app.inject({
      method: 'POST',
      url: '/api/boards',
      headers: zeca.headers,
      payload: { name: 'Quadro' },
    });
    const [todo] = createBoardResponseSchema.parse(boardRes.json()).lists as [List];
    const cardRes = await app.inject({
      method: 'POST',
      url: `/api/lists/${todo.id}/cards`,
      headers: zeca.headers,
      payload: { title: 'Card do Zeca' },
    });
    const card = cardSummaryResponseSchema.parse(cardRes.json()).card;
    for (const [userId, actor] of [
      [admin.user.id, zeca],
      [zeca.user.id, admin],
    ] as const) {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/cards/${card.id}/assignees/${userId}`,
        headers: actor.headers,
      });
      expect(res.statusCode).toBe(200);
    }
    const commentRes = await app.inject({
      method: 'POST',
      url: `/api/cards/${card.id}/comments`,
      headers: zeca.headers,
      payload: { body: 'Comentário do Zeca' },
    });
    const comment = commentResponseSchema.parse(commentRes.json()).comment;
    // Admin comenta: Zeca (responsável) recebe notificação.
    await app.inject({
      method: 'POST',
      url: `/api/cards/${card.id}/comments`,
      headers: admin.headers,
      payload: { body: 'Resposta' },
    });
    expect(await db().$count(notifications, eq(notifications.userId, zeca.user.id))).toBe(2);

    await deactivate(zeca.user.id);

    // Dados que a anonimização precisa limpar (criados depois de desativar).
    await db()
      .insert(sessions)
      .values({
        id: sha256Hex(randomUUID()),
        userId: zeca.user.id,
        idleExpiresAt: new Date(clock.now().getTime() + 60_000),
        absoluteExpiresAt: new Date(clock.now().getTime() + 60_000),
      });
    const [reset] = await db()
      .insert(authTokens)
      .values({
        kind: 'password_reset',
        tokenHash: sha256Hex(randomUUID()),
        targetUserId: zeca.user.id,
        createdBy: admin.user.id,
        expiresAt: new Date(clock.now().getTime() + 60_000),
      })
      .returning();
    const [usedInvite, otherInvite] = await db()
      .insert(authTokens)
      .values([
        {
          kind: 'invite',
          role: 'member',
          email,
          tokenHash: sha256Hex(randomUUID()),
          createdBy: admin.user.id,
          expiresAt: clock.now(),
          usedAt: clock.now(),
          usedByUserId: zeca.user.id,
        },
        {
          kind: 'invite',
          role: 'member',
          email: 'outra@exemplo.com',
          tokenHash: sha256Hex(randomUUID()),
          createdBy: admin.user.id,
          expiresAt: new Date(clock.now().getTime() + 60_000),
        },
      ])
      .returning();
    await db()
      .insert(authThrottle)
      .values([
        { key: `email:${email}`, failures: 2 },
        { key: 'email:outra@exemplo.com', failures: 1 },
      ]);

    clock.advance(1_000);
    const res = await anonymize(zeca.user.id);
    expect(res.statusCode).toBe(200);
    const { user } = adminUserResponseSchema.strict().parse(res.json());
    expect(user).toEqual({
      id: zeca.user.id,
      name: ANONYMIZED_USER_NAME,
      role: 'member',
      status: 'deactivated',
      anonymized: true,
      email: null,
      createdAt: zeca.user.createdAt.toISOString(),
    });

    const [stored] = await db().select().from(users).where(eq(users.id, zeca.user.id));
    expect(stored).toMatchObject({
      name: ANONYMIZED_USER_NAME,
      email: null,
      passwordHash: null,
      anonymizedAt: new Date('2026-09-16T12:00:01.000Z'),
      status: 'deactivated',
    });
    expect(await db().$count(sessions, eq(sessions.userId, zeca.user.id))).toBe(0);
    expect(await db().$count(authTokens, eq(authTokens.id, reset?.id ?? ''))).toBe(0);
    const [invite] = await db()
      .select()
      .from(authTokens)
      .where(eq(authTokens.id, usedInvite?.id ?? ''));
    expect(invite).toMatchObject({ email: null, usedByUserId: zeca.user.id, revokedAt: null });
    const [untouched] = await db()
      .select()
      .from(authTokens)
      .where(eq(authTokens.id, otherInvite?.id ?? ''));
    expect(untouched).toMatchObject({ email: 'outra@exemplo.com', revokedAt: null });
    expect(
      (await db().select({ key: authThrottle.key }).from(authThrottle)).map((r) => r.key),
    ).toEqual(['email:outra@exemplo.com']);
    expect(await db().$count(notifications, eq(notifications.userId, zeca.user.id))).toBe(0);

    // Histórico preservado, exibindo o nome anônimo (resolvido na leitura).
    const usersRes = await app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { cookie: member.cookie },
    });
    expect(usersResponseSchema.parse(usersRes.json()).users).toContainEqual({
      id: zeca.user.id,
      name: ANONYMIZED_USER_NAME,
      role: 'member',
      status: 'deactivated',
      anonymized: true,
    });
    const detail = cardDetailResponseSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/cards/${card.id}`,
          headers: { cookie: member.cookie },
        })
      ).json(),
    ).card;
    expect(detail.createdBy).toBe(zeca.user.id);
    expect(detail.assigneeIds).toContain(zeca.user.id);
    expect(detail.comments.find((c) => c.id === comment.id)).toMatchObject({
      authorId: zeca.user.id,
      body: 'Comentário do Zeca',
    });
    const history = activitiesResponseSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/cards/${card.id}/activity`,
          headers: { cookie: member.cookie },
        })
      ).json(),
    ).activities;
    expect(history.filter((a) => a.actorId === zeca.user.id).map((a) => a.type)).toEqual([
      'card_assignee_added',
      'card_created',
    ]);
    expect(await db().$count(comments, eq(comments.authorId, zeca.user.id))).toBe(1);
    expect(await db().$count(cardAssignees, eq(cardAssignees.userId, zeca.user.id))).toBe(1);
    const adminNotifications = notificationsResponseSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/notifications',
          headers: { cookie: admin.cookie },
        })
      ).json(),
    ).notifications;
    expect(adminNotifications.map((n) => n.actorId)).toContain(zeca.user.id);

    // Login impossível; reativar → 409 USER_ANONYMIZED; repetir anonimizar → 200 no-op.
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: csrfHeaders(),
      payload: { email, password: DEFAULT_PASSWORD },
    });
    expectError(login, 401, 'INVALID_CREDENTIALS');
    expectError(
      await app.inject({
        method: 'POST',
        url: `/api/admin/users/${zeca.user.id}/reactivate`,
        headers: admin.headers,
      }),
      409,
      'USER_ANONYMIZED',
    );
    clock.advance(1_000);
    const again = await anonymize(zeca.user.id);
    expect(again.statusCode).toBe(200);
    expect(adminUserResponseSchema.parse(again.json()).user).toEqual(user);

    // O e-mail volta a ficar livre para um convite novo.
    const invite2 = await app.inject({
      method: 'POST',
      url: '/api/admin/invites',
      headers: admin.headers,
      payload: { email, role: 'member' },
    });
    expect(invite2.statusCode).toBe(201);
  });

  it('revoga convites e redefinições pendentes que o anonimizado criou (api.md §18.5)', async () => {
    const issuer = await seedActor(db(), { role: 'admin' }, clock.now());
    const expiresAt = new Date(clock.now().getTime() + 60_000);
    // Tokens emitidos enquanto era Admin; a desativação é feita direto no banco (dado legado,
    // anterior à revogação na desativação), para exercitar o caminho da anonimização.
    const [invite, reset, foreign] = await db()
      .insert(authTokens)
      .values([
        {
          kind: 'invite',
          role: 'admin',
          tokenHash: sha256Hex(randomUUID()),
          createdBy: issuer.user.id,
          expiresAt,
        },
        {
          kind: 'password_reset',
          tokenHash: sha256Hex(randomUUID()),
          targetUserId: member.user.id,
          createdBy: issuer.user.id,
          expiresAt,
        },
        {
          kind: 'invite',
          role: 'member',
          tokenHash: sha256Hex(randomUUID()),
          createdBy: admin.user.id,
          expiresAt,
        },
      ])
      .returning();
    await db().update(users).set({ status: 'deactivated' }).where(eq(users.id, issuer.user.id));
    clock.advance(1000);

    expect((await anonymize(issuer.user.id)).statusCode).toBe(200);
    const rows = await db().select().from(authTokens);
    const revokedAt = (id: string | undefined) => rows.find((r) => r.id === id)?.revokedAt;
    expect(revokedAt(invite?.id)).toEqual(clock.now());
    expect(revokedAt(reset?.id)).toEqual(clock.now());
    expect(revokedAt(foreign?.id)).toBeNull();
  });

  it('409 USER_NOT_DEACTIVATED (ativo), 409 CANNOT_TARGET_SELF, 404, 403 Member (antes do 404), 400, CSRF, 401', async () => {
    expectError(await anonymize(member.user.id), 409, 'USER_NOT_DEACTIVATED');
    expectError(await anonymize(admin.user.id), 409, 'CANNOT_TARGET_SELF');
    expectError(await anonymize(MISSING_ID), 404, 'NOT_FOUND');

    await deactivate(member.user.id);
    const other = await seedActor(db(), { role: 'member' }, clock.now());
    expectError(await anonymize(member.user.id, undefined, other.headers), 403, 'FORBIDDEN');
    expectError(await anonymize(MISSING_ID, undefined, other.headers), 403, 'FORBIDDEN');

    for (const body of [{}, { confirm: false }, { confirm: 'true' }]) {
      expectError(await anonymize(member.user.id, body), 400, 'VALIDATION_ERROR');
    }
    expectError(await anonymize('abc'), 400, 'VALIDATION_ERROR');
    expectError(
      await anonymize(member.user.id, { confirm: true }, { cookie: admin.cookie }),
      403,
      'CSRF_REJECTED',
    );
    expectError(
      await anonymize(member.user.id, { confirm: true }, csrfHeaders()),
      401,
      'UNAUTHENTICATED',
    );

    const [stored] = await db().select().from(users).where(eq(users.id, member.user.id));
    expect(stored?.anonymizedAt).toBeNull();
    expect(stored?.email).not.toBeNull();
  });
});
