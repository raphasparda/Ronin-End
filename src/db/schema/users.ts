import { sql } from 'drizzle-orm';
import { check, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { bytea, createdAt, updatedAt } from '../types';

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
    /**
     * Espelho de `user_avatars.updated_at` (null sem foto), gravado na mesma transação. Existe
     * para que todo caminho que já lê `users` (sessão, `GET /api/users`, administração) saiba a
     * versão da foto sem carregar os bytes nem fazer join.
     */
    avatarUpdatedAt: timestamp('avatar_updated_at', { withTimezone: true, mode: 'date' }),
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

/**
 * Foto de perfil, uma por usuário (api.md §6). Fica fora de `users` porque os bytes só interessam
 * a `GET /api/users/:userId/avatar`: qualquer `SELECT * FROM users` continua barato.
 * `ON DELETE CASCADE` cobre o quadro em que a linha do usuário sumir; anonimizar apaga aqui.
 */
export const userAvatars = pgTable(
  'user_avatars',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    contentType: text('content_type').notNull(),
    bytes: bytea('bytes').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'user_avatars_content_type_check',
      sql`${t.contentType} IN ('image/webp', 'image/jpeg', 'image/png')`,
    ),
    // Mesmo teto de AVATAR_MAX_BYTES (128 KB).
    check('user_avatars_bytes_length_check', sql`octet_length(${t.bytes}) BETWEEN 1 AND 131072`),
  ],
);

export type UserAvatarRow = typeof userAvatars.$inferSelect;
