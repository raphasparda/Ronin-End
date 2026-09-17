import type { AdminUser, Role, UserSummary } from '@kanban/shared';

import type { Database, DbExecutor } from '../../db/client';
import type { UserRow } from '../../db/schema';
import { AppError } from '../../lib/app-error';
import { toIso } from '../../lib/dates';
import { revokeUnusedPasswordResets } from '../auth-tokens/repository';
import { deleteUserSessions } from '../sessions/service';

import {
  findUserById,
  listUsersByName,
  lockActiveAdminIds,
  lockUserById,
  updateUserById,
} from './repository';

export const USER_NOT_FOUND_MESSAGE = 'Usuário não encontrado.';
export const LAST_ADMIN_MESSAGE = 'É preciso manter ao menos um Admin ativo.';
export const CANNOT_TARGET_SELF_MESSAGE = 'Você não pode fazer isso com a sua própria conta.';
export const USER_ANONYMIZED_MESSAGE = 'Esta conta foi anonimizada e não pode ser alterada.';

export function toUserSummary(row: UserRow): UserSummary {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    status: row.status,
    anonymized: row.anonymizedAt !== null,
  };
}

export function toAdminUser(row: UserRow): AdminUser {
  return { ...toUserSummary(row), email: row.email, createdAt: toIso(row.createdAt) };
}

/** `GET /api/users`: todos, por nome, sem e-mail. */
export async function listUsers(db: DbExecutor): Promise<UserSummary[]> {
  return (await listUsersByName(db)).map(toUserSummary);
}

/** `GET /api/admin/users`. */
export async function listAdminUsers(db: DbExecutor): Promise<AdminUser[]> {
  return (await listUsersByName(db)).map(toAdminUser);
}

export async function getUserOrThrow(db: DbExecutor, userId: string): Promise<UserRow> {
  const user = await findUserById(db, userId);
  if (!user) throw new AppError('NOT_FOUND', USER_NOT_FOUND_MESSAGE);
  return user;
}

export interface AdminActionContext {
  actorId: string;
  now: Date;
}

async function lockTargetOrThrow(tx: DbExecutor, userId: string): Promise<UserRow> {
  const user = await lockUserById(tx, userId);
  if (!user) throw new AppError('NOT_FOUND', USER_NOT_FOUND_MESSAGE);
  return user;
}

/**
 * `PATCH /api/admin/users/:userId { role }`. Ordem: 404 → a si mesmo (rebaixar) → anonimizado →
 * último Admin ativo. Mesmo papel = no-op.
 */
export async function changeUserRole(
  db: Database,
  ctx: AdminActionContext,
  userId: string,
  role: Role,
): Promise<AdminUser> {
  return db.transaction(async (tx) => {
    // Admins primeiro, depois o alvo: mesma ordem de locks em todas as operações de Admin.
    const adminIds = await lockActiveAdminIds(tx);
    const target = await lockTargetOrThrow(tx, userId);
    if (target.id === ctx.actorId && role !== target.role) {
      throw new AppError('CANNOT_TARGET_SELF', CANNOT_TARGET_SELF_MESSAGE);
    }
    if (target.anonymizedAt !== null) {
      throw new AppError('USER_ANONYMIZED', USER_ANONYMIZED_MESSAGE);
    }
    if (target.role === role) return toAdminUser(target);
    if (role === 'member' && adminIds.includes(target.id) && adminIds.length <= 1) {
      throw new AppError('LAST_ADMIN', LAST_ADMIN_MESSAGE);
    }
    const updated = await updateUserById(tx, target.id, { role, updatedAt: ctx.now });
    if (!updated) throw new AppError('NOT_FOUND', USER_NOT_FOUND_MESSAGE);
    return toAdminUser(updated);
  });
}

/**
 * `POST /api/admin/users/:userId/deactivate`. Não a si mesmo; não o último Admin ativo. Apaga as
 * sessões e revoga as redefinições pendentes. Idempotente.
 */
export async function deactivateUser(
  db: Database,
  ctx: AdminActionContext,
  userId: string,
): Promise<AdminUser> {
  return db.transaction(async (tx) => {
    const adminIds = await lockActiveAdminIds(tx);
    const locked = await lockTargetOrThrow(tx, userId);
    if (locked.id === ctx.actorId) {
      throw new AppError('CANNOT_TARGET_SELF', CANNOT_TARGET_SELF_MESSAGE);
    }
    if (locked.status === 'deactivated') return toAdminUser(locked);
    if (adminIds.includes(locked.id) && adminIds.length <= 1) {
      throw new AppError('LAST_ADMIN', LAST_ADMIN_MESSAGE);
    }

    const updated = await updateUserById(tx, locked.id, {
      status: 'deactivated',
      updatedAt: ctx.now,
    });
    if (!updated) throw new AppError('NOT_FOUND', USER_NOT_FOUND_MESSAGE);
    await deleteUserSessions(tx, locked.id);
    await revokeUnusedPasswordResets(tx, locked.id, ctx.now);
    return toAdminUser(updated);
  });
}

/** `POST /api/admin/users/:userId/reactivate`. Anonimizado → 409. Idempotente. */
export async function reactivateUser(
  db: Database,
  ctx: AdminActionContext,
  userId: string,
): Promise<AdminUser> {
  return db.transaction(async (tx) => {
    const target = await lockTargetOrThrow(tx, userId);
    if (target.anonymizedAt !== null) {
      throw new AppError('USER_ANONYMIZED', USER_ANONYMIZED_MESSAGE);
    }
    if (target.status === 'active') return toAdminUser(target);
    const updated = await updateUserById(tx, target.id, { status: 'active', updatedAt: ctx.now });
    if (!updated) throw new AppError('NOT_FOUND', USER_NOT_FOUND_MESSAGE);
    return toAdminUser(updated);
  });
}
