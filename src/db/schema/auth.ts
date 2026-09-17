import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { userRole, users } from './users';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Sessões por cookie (overview.md §6.2, ADR 0002). */
export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 (hex minúsculo) do token do cookie. O token em si nunca é gravado. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
    lastSeenAt: tstz('last_seen_at').notNull().defaultNow(),
    /** `last_seen_at + 14 dias`, calculado pela aplicação. */
    idleExpiresAt: tstz('idle_expires_at').notNull(),
    /** `created_at + 30 dias`, calculado pela aplicação. */
    absoluteExpiresAt: tstz('absolute_expires_at').notNull(),
  },
  (t) => [
    // Invalidação de todas as sessões de um usuário (troca/redefinição de senha, desativação).
    index('sessions_user_id_idx').on(t.userId),
    // Impede gravar o token cru por engano: só aceita um hash SHA-256 em hex.
    check('sessions_id_sha256_check', sql`${t.id} ~ '^[0-9a-f]{64}$'`),
  ],
);

/** Bloqueio de login persistido (overview.md §6.4). Tabela pequena, limpa pela manutenção. */
export const authThrottle = pgTable(
  'auth_throttle',
  {
    /** `email:<email normalizado>` ou `ip:<ip>`. */
    key: text('key').primaryKey(),
    failures: integer('failures').notNull().default(0),
    windowStartedAt: tstz('window_started_at').notNull().defaultNow(),
    lockedUntil: tstz('locked_until'),
  },
  (t) => [
    check('auth_throttle_key_format_check', sql`${t.key} ~ '^(email|ip):.+$'`),
    check('auth_throttle_failures_check', sql`${t.failures} >= 0`),
  ],
);

export const authTokenKind = pgEnum('auth_token_kind', ['invite', 'password_reset']);

/**
 * Convites e links de redefinição de senha (overview.md §6.5, ADR 0008). Só o SHA-256 do token é
 * gravado. Consumo atômico: `UPDATE ... WHERE token_hash = $1 AND used_at IS NULL AND
 * revoked_at IS NULL AND expires_at > now() RETURNING *`.
 * Dado pessoal (LGPD): `email` do convite. A anonimização apaga os tokens cujo alvo é o usuário.
 */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: authTokenKind('kind').notNull(),
    /** SHA-256 (hex minúsculo) do token do link. */
    tokenHash: text('token_hash').notNull(),
    /** Convite: e-mail opcional (se preenchido, o aceite exige esse e-mail). Normalizado. */
    email: text('email'),
    /** Convite: papel da conta criada (obrigatório). */
    role: userRole('role'),
    /** Redefinição: usuário alvo (obrigatório). */
    targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    expiresAt: tstz('expires_at').notNull(),
    usedAt: tstz('used_at'),
    /** Convite: conta criada no aceite. Redefinição: o próprio alvo. */
    usedByUserId: uuid('used_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    revokedAt: tstz('revoked_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    // Lookup e consumo pelo hash do token recebido no corpo.
    uniqueIndex('auth_tokens_token_hash_unique').on(t.tokenHash),
    // Revogar resets pendentes do usuário, anonimização (apaga tokens alvo) e a FK.
    index('auth_tokens_target_user_id_idx')
      .on(t.targetUserId)
      .where(sql`${t.targetUserId} IS NOT NULL`),
    check('auth_tokens_token_hash_sha256_check', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    // Convite: exige papel; não tem alvo.
    check(
      'auth_tokens_invite_check',
      sql`${t.kind} <> 'invite' OR (${t.role} IS NOT NULL AND ${t.targetUserId} IS NULL)`,
    ),
    // Redefinição: exige alvo; não tem papel nem e-mail.
    check(
      'auth_tokens_password_reset_check',
      sql`${t.kind} <> 'password_reset' OR (${t.targetUserId} IS NOT NULL AND ${t.role} IS NULL AND ${t.email} IS NULL)`,
    ),
    check(
      'auth_tokens_email_normalized_check',
      sql`${t.email} = lower(btrim(${t.email})) AND char_length(${t.email}) BETWEEN 3 AND 254`,
    ),
    // `used_by_user_id` só depois do consumo (pode ser gravado depois de `used_at`, na mesma transação).
    check('auth_tokens_used_by_check', sql`${t.usedByUserId} IS NULL OR ${t.usedAt} IS NOT NULL`),
  ],
);

export type SessionRow = typeof sessions.$inferSelect;
export type AuthThrottleRow = typeof authThrottle.$inferSelect;
export type AuthTokenRow = typeof authTokens.$inferSelect;
export type NewAuthTokenRow = typeof authTokens.$inferInsert;
