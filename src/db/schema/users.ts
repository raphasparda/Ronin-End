import { sql } from 'drizzle-orm';
import { check, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { createdAt, updatedAt } from '../types';

export const userRole = pgEnum('user_role', ['admin', 'member']);
export const userStatus = pgEnum('user_status', ['active', 'deactivated']);

/**
 * Usuários nunca são excluídos: são desativados e, depois, anonimizados (overview.md §5.2).
 * Dados pessoais (LGPD): `email`, `name` e `password_hash`. A anonimização zera os três
 * (`name` vira "Usuário removido").
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Normalizado (`trim` + minúsculas) pela aplicação; o CHECK garante. Null só anonimizado. */
    email: text('email'),
    name: text('name').notNull(),
    /** Argon2id (PHC string). Null só anonimizado. */
    passwordHash: text('password_hash'),
    role: userRole('role').notNull(),
    status: userStatus('status').notNull().default('active'),
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true, mode: 'date' }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // NULLs são distintos: vários anonimizados convivem com o UNIQUE.
    unique('users_email_unique').on(t.email),
    check('users_name_length_check', sql`char_length(${t.name}) BETWEEN 1 AND 80`),
    // Sem isto, "A@x.com" e "a@x.com" passariam pelo UNIQUE como e-mails distintos.
    check(
      'users_email_normalized_check',
      sql`${t.email} = lower(btrim(${t.email})) AND char_length(${t.email}) BETWEEN 3 AND 254`,
    ),
    // Não anonimizado: e-mail e senha obrigatórios.
    check(
      'users_credentials_present_check',
      sql`${t.anonymizedAt} IS NOT NULL OR (${t.email} IS NOT NULL AND ${t.passwordHash} IS NOT NULL)`,
    ),
    // Anonimizado: e-mail e senha apagados e sempre desativado (não pode reativar, LGPD).
    check(
      'users_anonymized_check',
      sql`${t.anonymizedAt} IS NULL OR (${t.email} IS NULL AND ${t.passwordHash} IS NULL AND ${t.status} = 'deactivated')`,
    ),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
