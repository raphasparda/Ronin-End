import type { AdminUser, Role, UserSummary } from '@raphasparda/ronin-shared';

import type { Database, DbExecutor } from '../../db/client';
import type { UserRow } from '../../db/schema';
import { AppError } from '../../lib/app-error';
import { toIso } from '../../lib/dates';
import {
  revokePendingTokensCreatedBy,
  revokeUnusedPasswordResets,
  scrubAuthTokensOfUser,
} from '../auth-tokens/repository';
import { emailThrottleKey } from '../auth/throttle';
import { deleteAvatar } from '../avatars/repository';
import { deleteBoardViewersOfUser } from '../boards/repository';
import { deleteNotificationsOfUser } from '../notifications/repository';
import { deleteUserSessions } from '../sessions/service';

import {
  anonymizeUserRow,
  deleteEmailThrottle,
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
export const USER_NOT_DEACTIVATED_MESSAGE = 'Desative a conta antes de anonimizá-la.';

export function toUserSummary(row: UserRow): UserSummary {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    status: row.status,
    anonymized: row.anonymizedAt !== null,
    avatarUpdatedAt: row.avatarUpdatedAt === null ? null : toIso(row.avatarUpdatedAt),
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
 * último Admin ativo. Mesmo papel = no-op. Rebaixar para Member revoga, na mesma transação, os
 * convites e links de redefinição pendentes que ele criou (api.md §18.5).
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
    if (target.role === 'admin' && role === 'member') {
      await revokePendingTokensCreatedBy(tx, target.id, ctx.now);
    }
    return toAdminUser(updated);
  });
}

/**
 * `POST /api/admin/users/:userId/deactivate`. Não a si mesmo; não o último Admin ativo. Apaga as
 * sessões, revoga as redefinições pendentes para ele e os convites/redefinições pendentes que ele
 * criou (api.md §18.5). Idempotente.
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
    await revokePendingTokensCreatedBy(tx, locked.id, ctx.now);
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

/**
 * `POST /api/admin/users/:userId/anonymize { confirm: true }` (overview.md §5.2, LGPD).
 * Ordem: 404 → a si mesmo (`CANNOT_TARGET_SELF`) → já anonimizado (200 no-op) → ativo
 * (`USER_NOT_DEACTIVATED`). `LAST_ADMIN` não se aplica: o alvo já está desativado, então não conta
 * como Admin ativo. Irreversível. Na mesma transação:
 * - nome "Usuário removido", e-mail e hash nulos, `anonymized_at`;
 * - apaga sessões, a foto de perfil, links de redefinição do usuário, notificações recebidas e o
 *   throttle do e-mail;
 * - revoga convites e redefinições pendentes que ele criou (api.md §18.5);
 * - tira o e-mail dos convites ligados a ele (revogando algum ainda pendente).
 * Cards, responsáveis, comentários, atividades e notificações que ele gerou para outros permanecem
 * (nome resolvido na leitura).
 */
export async function anonymizeUser(
  db: Database,
  ctx: AdminActionContext,
  userId: string,
): Promise<AdminUser> {
  return db.transaction(async (tx) => {
    // Mesma ordem de locks das demais operações de Admin (Admins ativos → alvo).
    await lockActiveAdminIds(tx);
    const target = await lockTargetOrThrow(tx, userId);
    if (target.id === ctx.actorId) {
      throw new AppError('CANNOT_TARGET_SELF', CANNOT_TARGET_SELF_MESSAGE);
    }
    if (target.anonymizedAt !== null) return toAdminUser(target);
    if (target.status !== 'deactivated') {
      throw new AppError('USER_NOT_DEACTIVATED', USER_NOT_DEACTIVATED_MESSAGE);
    }

    const updated = await anonymizeUserRow(tx, target.id, ctx.now);
    if (!updated) throw new AppError('NOT_FOUND', USER_NOT_FOUND_MESSAGE);
    await deleteUserSessions(tx, target.id);
    await deleteAvatar(tx, target.id);
    await revokePendingTokensCreatedBy(tx, target.id, ctx.now);
    await scrubAuthTokensOfUser(tx, target, ctx.now);
    await deleteNotificationsOfUser(tx, target.id);
    // RN38: conta anonimizada sai de todas as listas de acesso (o card continua restrito).
    await deleteBoardViewersOfUser(tx, target.id);
    if (target.email !== null) await deleteEmailThrottle(tx, emailThrottleKey(target.email));
    return toAdminUser(updated);
  });
}
