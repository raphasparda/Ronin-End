import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

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

export type SessionRow = typeof sessions.$inferSelect;
export type AuthThrottleRow = typeof authThrottle.$inferSelect;
