import {
  AVATAR_MAX_BASE64_LENGTH,
  updateAvatarResponseSchema,
  usersResponseSchema,
} from '@raphasparda/ronin-shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { expectError, MISSING_ID, seedTeam, type Actor } from '../../../../test/actors';
import { csrfHeaders } from '../../../../test/app';
import { createDbTestApp, createTestClock } from '../../../../test/auth';
import { describeDb, useTestDatabase } from '../../../../test/db';
import type { App } from '../../../app';
import { userAvatars, users } from '../../../db/schema';

import { AVATAR_CACHE_CONTROL } from './service';

/** PNG 1×1 transparente. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** WebP mínimo: só o cabeçalho RIFF/WEBP, que é o que o servidor confere. */
const WEBP_BASE64 = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x10, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 ', 'latin1'),
  Buffer.alloc(8, 0x42),
]).toString('base64');

describeDb('foto de perfil (ronin_test)', () => {
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

  const putAvatar = (body: unknown, headers = member.headers) =>
    app.inject({ method: 'PUT', url: '/api/me/avatar', headers, payload: body as object });

  const deleteAvatar = (headers = member.headers) =>
    app.inject({ method: 'DELETE', url: '/api/me/avatar', headers });

  const getAvatar = (userId: string, headers: Record<string, string> = { cookie: member.cookie }) =>
    app.inject({ method: 'GET', url: `/api/users/${userId}/avatar`, headers });

  describe('PUT /api/me/avatar', () => {
    it('200 grava a foto, versiona o usuário e serve a imagem', async () => {
      const res = await putAvatar({ contentType: 'image/webp', data: WEBP_BASE64 });
      expect(res.statusCode).toBe(200);
      const { user } = updateAvatarResponseSchema.strict().parse(res.json());
      expect(user.avatarUpdatedAt).toBe(clock.now().toISOString());

      const [row] = await db().select().from(users).where(eq(users.id, member.user.id));
      expect(row?.avatarUpdatedAt).toEqual(clock.now());

      const image = await getAvatar(member.user.id);
      expect(image.statusCode).toBe(200);
      expect(image.headers['content-type']).toBe('image/webp');
      expect(image.headers['cache-control']).toBe(AVATAR_CACHE_CONTROL);
      expect(image.rawPayload.equals(Buffer.from(WEBP_BASE64, 'base64'))).toBe(true);

      // Mesmo ETag → 304 sem corpo.
      const etag = image.headers.etag as string;
      const again = await getAvatar(member.user.id, {
        cookie: member.cookie,
        'if-none-match': etag,
      });
      expect(again.statusCode).toBe(304);
      expect(again.rawPayload.length).toBe(0);
    });

    it('200 substitui a foto anterior (uma por usuário) e muda a versão', async () => {
      await putAvatar({ contentType: 'image/webp', data: WEBP_BASE64 });
      const first = (await getAvatar(member.user.id)).headers.etag;

      clock.advance(60_000);
      const res = await putAvatar({ contentType: 'image/png', data: PNG_BASE64 });
      expect(res.statusCode).toBe(200);

      expect(await db().$count(userAvatars, eq(userAvatars.userId, member.user.id))).toBe(1);
      const image = await getAvatar(member.user.id);
      expect(image.headers['content-type']).toBe('image/png');
      expect(image.headers.etag).not.toBe(first);
    });

    it('400 quando o tipo não bate com o arquivo, o base64 é inválido ou a imagem é grande demais', async () => {
      expectError(
        await putAvatar({ contentType: 'image/png', data: WEBP_BASE64 }),
        400,
        'VALIDATION_ERROR',
      );
      expectError(
        await putAvatar({ contentType: 'image/webp', data: '???' }),
        400,
        'VALIDATION_ERROR',
      );
      expectError(
        await putAvatar({ contentType: 'image/gif', data: PNG_BASE64 }),
        400,
        'VALIDATION_ERROR',
      );
      expectError(
        await putAvatar({
          contentType: 'image/webp',
          data: 'A'.repeat(AVATAR_MAX_BASE64_LENGTH + 4),
        }),
        400,
        'VALIDATION_ERROR',
      );
      expect(await db().$count(userAvatars)).toBe(0);
    });

    it('403 sem CSRF e 401 sem sessão', async () => {
      const body = { contentType: 'image/webp', data: WEBP_BASE64 };
      expectError(await putAvatar(body, { cookie: member.cookie }), 403, 'CSRF_REJECTED');
      expectError(await putAvatar(body, csrfHeaders()), 401, 'UNAUTHENTICATED');
    });
  });

  describe('DELETE /api/me/avatar', () => {
    it('204 apaga a foto e é idempotente', async () => {
      await putAvatar({ contentType: 'image/webp', data: WEBP_BASE64 });

      expect((await deleteAvatar()).statusCode).toBe(204);
      expect((await deleteAvatar()).statusCode).toBe(204);
      expect(await db().$count(userAvatars)).toBe(0);
      const [row] = await db().select().from(users).where(eq(users.id, member.user.id));
      expect(row?.avatarUpdatedAt).toBeNull();
      expectError(await getAvatar(member.user.id), 404, 'NOT_FOUND');
    });
  });

  describe('GET /api/users/:userId/avatar', () => {
    it('404 sem foto ou sem usuário, 400 com id inválido, 401 sem sessão', async () => {
      const missing = await getAvatar(admin.user.id);
      expectError(missing, 404, 'NOT_FOUND');
      // Erro nunca é cacheado, mesmo na rota que declara cache.
      expect(missing.headers['cache-control']).toBe('no-store');
      expectError(await getAvatar(MISSING_ID), 404, 'NOT_FOUND');
      expectError(await getAvatar('nao-e-uuid'), 400, 'VALIDATION_ERROR');
      expectError(await getAvatar(member.user.id, {}), 401, 'UNAUTHENTICATED');
    });

    it('a versão da foto aparece em GET /api/users (é o que monta a URL)', async () => {
      await putAvatar({ contentType: 'image/webp', data: WEBP_BASE64 });
      const res = await app.inject({
        method: 'GET',
        url: '/api/users',
        headers: { cookie: admin.cookie },
      });
      const { users: list } = usersResponseSchema.parse(res.json());
      expect(list.find((u) => u.id === member.user.id)?.avatarUpdatedAt).toBe(
        clock.now().toISOString(),
      );
      expect(list.find((u) => u.id === admin.user.id)?.avatarUpdatedAt).toBeNull();
    });
  });

  it('anonimizar apaga a foto (LGPD)', async () => {
    await putAvatar({ contentType: 'image/webp', data: WEBP_BASE64 });
    const asAdmin = { method: 'POST' as const, headers: admin.headers };
    await app.inject({ ...asAdmin, url: `/api/admin/users/${member.user.id}/deactivate` });
    const res = await app.inject({
      ...asAdmin,
      url: `/api/admin/users/${member.user.id}/anonymize`,
      payload: { confirm: true },
    });
    expect(res.statusCode).toBe(200);

    expect(await db().$count(userAvatars)).toBe(0);
    const [row] = await db().select().from(users).where(eq(users.id, member.user.id));
    expect(row?.avatarUpdatedAt).toBeNull();
  });
});
