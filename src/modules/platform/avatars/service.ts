import {
  AVATAR_MAX_BYTES,
  AVATAR_TOO_LARGE_MESSAGE,
  type AvatarContentType,
  type SessionUser,
  type UpdateAvatarRequest,
} from '@raphasparda/ronin-shared';

import type { Database, DbExecutor } from '../../../db/client';
import type { UserAvatarRow } from '../../../db/schema';
import { AppError } from '../../../lib/app-error';
import { toIso } from '../../../lib/dates';
import { updateUserById } from '../users/repository';

import { deleteAvatar, findAvatarByUserId, upsertAvatar } from './repository';

export const AVATAR_NOT_FOUND_MESSAGE = 'Foto não encontrada.';
export const AVATAR_INVALID_MESSAGE = 'Não foi possível ler a imagem. Tente outro arquivo.';

/** `Cache-Control` do avatar: a URL carrega a versão (`?v=`), então o navegador pode guardar. */
export const AVATAR_CACHE_CONTROL = 'private, max-age=86400';

/**
 * Assinatura do arquivo, não o `contentType` do cliente: o que é servido de volta na mesma origem
 * do app tem que ser mesmo uma imagem do tipo declarado (overview.md §6.7).
 */
export function matchesContentType(bytes: Buffer, contentType: AvatarContentType): boolean {
  if (contentType === 'image/png') {
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (contentType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  );
}

function invalidImage(message: string): AppError {
  return new AppError('VALIDATION_ERROR', 'Dados inválidos.', {
    details: [{ path: 'data', message }],
  });
}

/**
 * `PUT /api/me/avatar`. O base64 já veio limitado pelo schema; aqui vale o tamanho real em bytes e
 * a assinatura do arquivo. Bytes e `users.avatar_updated_at` (a versão lida por todo mundo) são
 * gravados na mesma transação.
 */
export async function setMyAvatar(
  db: Database,
  sessionUser: SessionUser,
  input: UpdateAvatarRequest,
  now: Date,
): Promise<SessionUser> {
  const bytes = Buffer.from(input.data, 'base64');
  if (bytes.length === 0) throw invalidImage(AVATAR_INVALID_MESSAGE);
  if (bytes.length > AVATAR_MAX_BYTES) throw invalidImage(AVATAR_TOO_LARGE_MESSAGE);
  if (!matchesContentType(bytes, input.contentType)) throw invalidImage(AVATAR_INVALID_MESSAGE);

  await db.transaction(async (tx) => {
    await upsertAvatar(tx, {
      userId: sessionUser.id,
      contentType: input.contentType,
      bytes,
      updatedAt: now,
    });
    if (!(await updateUserById(tx, sessionUser.id, { avatarUpdatedAt: now, updatedAt: now }))) {
      throw new Error('usuário da sessão ausente');
    }
  });

  return { ...sessionUser, avatarUpdatedAt: toIso(now) };
}

/** `DELETE /api/me/avatar`. Idempotente: sem foto, só confirma. */
export async function removeMyAvatar(
  db: Database,
  sessionUser: SessionUser,
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await deleteAvatar(tx, sessionUser.id))) return;
    await updateUserById(tx, sessionUser.id, { avatarUpdatedAt: null, updatedAt: now });
  });
}

/** `GET /api/users/:userId/avatar`. 404 também quando o usuário existe e não tem foto. */
export async function getAvatarOrThrow(db: DbExecutor, userId: string): Promise<UserAvatarRow> {
  const row = await findAvatarByUserId(db, userId);
  if (!row) throw new AppError('NOT_FOUND', AVATAR_NOT_FOUND_MESSAGE);
  return row;
}

/** ETag da foto: muda a cada envio. */
export function avatarETag(row: UserAvatarRow): string {
  return `"${row.updatedAt.getTime().toString(36)}"`;
}
