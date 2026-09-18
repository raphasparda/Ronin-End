import {
  INVITE_TTL_MS,
  type AcceptInviteRequest,
  type AuthSessionResponse,
  type CreateInviteRequest,
  type CreateInviteResponse,
  type Invite,
  type InviteLookupResponse,
  type InviteState,
} from '@raphasparda/ronin-shared';

import type { Database } from '../../db/client';
import type { AuthTokenRow } from '../../db/schema';
import { AppError } from '../../lib/app-error';
import { toIso } from '../../lib/dates';
import type { PasswordHasher } from '../../lib/password';
import { randomToken, sha256Hex } from '../../lib/tokens';
import { findPgErrorCode } from '../../plugins/errors';
import {
  consumeToken,
  findInviteById,
  findPendingToken,
  insertAuthToken,
  listInvites as listInviteRows,
  revokePendingInvite,
  setTokenUsedBy,
} from '../auth-tokens/repository';
import { createSession, deleteSession, toSessionUser } from '../sessions/service';
import { findUserByEmail, insertUser } from '../users/repository';
import { getWorkspace } from '../workspace/service';

export const INVITE_INVALID_MESSAGE = 'Convite inválido.';
export const INVITE_NOT_FOUND_MESSAGE = 'Convite não encontrado.';
export const EMAIL_TAKEN_MESSAGE = 'Já existe uma conta com este e-mail.';
export const INVITE_EMAIL_MISMATCH_MESSAGE = 'Este convite é para outro e-mail.';

/** Convites usados, revogados ou expirados continuam listados por 30 dias (api.md §8). */
export const INVITE_HISTORY_MS = 30 * 24 * 60 * 60 * 1000;

const PG_UNIQUE_VIOLATION = '23505';

export function inviteState(row: AuthTokenRow, now: Date): InviteState {
  if (row.usedAt !== null) return 'used';
  if (row.revokedAt !== null) return 'revoked';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'pending';
}

export function toInvite(row: AuthTokenRow, now: Date): Invite {
  if (row.role === null) throw new Error('convite sem papel (viola auth_tokens_invite_check)');
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt),
    expiresAt: toIso(row.expiresAt),
    state: inviteState(row, now),
    usedByUserId: row.usedByUserId,
  };
}

/** URL exibida uma única vez ao Admin; token no fragmento (ADR 0008). */
export function inviteUrl(appOrigin: string, token: string): string {
  return `${appOrigin}/convite#token=${token}`;
}

/** `GET /api/admin/invites`: últimos 30 dias + pendentes, mais recentes primeiro. */
export async function listInvites(db: Database, now: Date): Promise<Invite[]> {
  const rows = await listInviteRows(db, new Date(now.getTime() - INVITE_HISTORY_MS), now);
  return rows.map((row) => toInvite(row, now));
}

/** `POST /api/admin/invites`. E-mail de usuário existente → `409 EMAIL_TAKEN`. */
export async function createInvite(
  deps: { db: Database; now: Date; appOrigin: string },
  actorId: string,
  input: CreateInviteRequest,
): Promise<CreateInviteResponse> {
  const { db, now, appOrigin } = deps;
  if (input.email !== null && (await findUserByEmail(db, input.email))) {
    throw new AppError('EMAIL_TAKEN', EMAIL_TAKEN_MESSAGE);
  }
  const token = randomToken();
  const row = await insertAuthToken(db, {
    kind: 'invite',
    tokenHash: sha256Hex(token),
    email: input.email,
    role: input.role,
    createdBy: actorId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
  });
  return { invite: toInvite(row, now), url: inviteUrl(appOrigin, token) };
}

/** `DELETE /api/admin/invites/:inviteId`: revoga se pendente. Idempotente; inexistente → 404. */
export async function revokeInvite(db: Database, inviteId: string, now: Date): Promise<void> {
  if (await revokePendingInvite(db, inviteId, now)) return;
  if (!(await findInviteById(db, inviteId))) {
    throw new AppError('NOT_FOUND', INVITE_NOT_FOUND_MESSAGE);
  }
}

function invalidInvite(): AppError {
  return new AppError('TOKEN_INVALID', INVITE_INVALID_MESSAGE);
}

/** `POST /api/auth/invites/lookup`. */
export async function lookupInvite(
  db: Database,
  token: string,
  now: Date,
): Promise<InviteLookupResponse> {
  const row = await findPendingToken(db, 'invite', sha256Hex(token), now);
  if (!row || row.role === null) throw invalidInvite();
  return { email: row.email, role: row.role, expiresAt: toIso(row.expiresAt) };
}

export interface AcceptInviteResult extends Omit<AuthSessionResponse, 'features'> {
  /** Token cru para o cookie. */
  token: string;
}

/**
 * `POST /api/auth/invites/accept` (ADR 0008). Checagens baratas antes do Argon2id; depois, numa
 * transação: consumo atômico do token, criação do usuário com o papel do convite e da sessão.
 * E-mail já existente (inclusive por corrida no `UNIQUE`) → `409 EMAIL_TAKEN`, e o rollback devolve
 * o token ao estado pendente.
 */
export async function acceptInvite(
  deps: { db: Database; passwords: PasswordHasher; now: Date },
  input: AcceptInviteRequest,
  currentSessionId: string | null,
): Promise<AcceptInviteResult> {
  const { db, passwords, now } = deps;
  const tokenHash = sha256Hex(input.token);

  const pending = await findPendingToken(db, 'invite', tokenHash, now);
  if (!pending) throw invalidInvite();
  if (pending.email !== null && pending.email !== input.email) {
    throw new AppError('INVITE_EMAIL_MISMATCH', INVITE_EMAIL_MISMATCH_MESSAGE);
  }
  if (await findUserByEmail(db, input.email)) {
    throw new AppError('EMAIL_TAKEN', EMAIL_TAKEN_MESSAGE);
  }

  const passwordHash = await passwords.hash(input.password);

  try {
    return await db.transaction(async (tx) => {
      const consumed = await consumeToken(tx, 'invite', tokenHash, now, null);
      if (!consumed || consumed.role === null) throw invalidInvite();

      const user = await insertUser(tx, {
        email: input.email,
        name: input.name,
        passwordHash,
        role: consumed.role,
        passwordChangedAt: now,
      });
      await setTokenUsedBy(tx, consumed.id, user.id);
      // O navegador pode ter uma sessão de outra conta: descarta e cria a nova (sem fixação).
      if (currentSessionId) await deleteSession(tx, currentSessionId);
      const { token } = await createSession(tx, user.id, now);

      return {
        token,
        user: toSessionUser(user, input.email),
        workspace: await getWorkspace(tx),
      };
    });
  } catch (err) {
    if (findPgErrorCode(err, PG_UNIQUE_VIOLATION)) {
      throw new AppError('EMAIL_TAKEN', EMAIL_TAKEN_MESSAGE, { cause: err });
    }
    throw err;
  }
}
