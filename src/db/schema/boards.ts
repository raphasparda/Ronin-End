import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, textC, updatedAt } from '../types';

import { users } from './users';

/**
 * Chaves da paleta fixa de listas e etiquetas (RN15, ADR 0012). A ordem do enum é a ordem de
 * `PALETTE` em `@raphasparda/ronin-shared` (define o ciclo de `nextPaletteColor`). Valores visuais só em CSS.
 */
export const paletteColor = pgEnum('palette_color', [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'purple',
  'magenta',
]);

/**
 * Visibilidade do quadro (Fatia 11, ADR 0015). `team` (padrão) = todo usuário ativo vê (RN05);
 * `restricted` = só Admins e as pessoas de `board_viewers` (I13).
 */
export const boardVisibility = pgEnum('board_visibility', ['team', 'restricted']);

export const boards = pgTable(
  'boards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** Fatia 11: `restricted` exige lista de acesso em `board_viewers` (I13, ADR 0015). */
    visibility: boardVisibility('visibility').notNull().default('team'),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('boards_name_length_check', sql`char_length(${t.name}) BETWEEN 1 AND 100`)],
);

/**
 * Lista de acesso de um quadro restrito (Fatia 11, ADR 0015). Só faz sentido com
 * `boards.visibility = 'restricted'` (voltar para `team` apaga as linhas): a regra vive no serviço,
 * não há `CHECK` entre tabelas. Desativar um usuário não apaga linhas aqui — como em
 * `card_assignees`, a pessoa simplesmente não entra mais; anonimizar apaga (RN38).
 */
export const boardViewers = pgTable(
  'board_viewers',
  {
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    addedBy: uuid('added_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    // A PK (board_id, user_id) serve ao `EXISTS` correlacionado das listagens e à idempotência.
    primaryKey({ name: 'board_viewers_pkey', columns: [t.boardId, t.userId] }),
    // Anonimização (apaga o acesso da pessoa) e cascata/checagem da FK de usuário.
    index('board_viewers_user_id_idx').on(t.userId),
  ],
);

/**
 * Capa do quadro (Fatia 11, ADR 0016): no máximo uma por quadro (I14). O banco guarda só a chave do
 * objeto no R2, o tipo, o tamanho e as dimensões informadas pelo cliente — nunca a URL assinada.
 * Trocar a capa é `INSERT ... ON CONFLICT (board_id) DO UPDATE`.
 */
export const boardCovers = pgTable(
  'board_covers',
  {
    boardId: uuid('board_id')
      .primaryKey()
      .references(() => boards.id, { onDelete: 'cascade' }),
    /** `covers/<board_id>/<32 caracteres base64url>`: a chave sempre pertence ao próprio quadro. */
    objectKey: text('object_key').notNull().unique(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // I14: chave de outro quadro (ou fora do formato) não entra.
    check(
      'board_covers_object_key_check',
      sql`${t.objectKey} ~ ('^covers/' || ${t.boardId} || '/[A-Za-z0-9_-]{32}$')`,
    ),
    check(
      'board_covers_content_type_check',
      sql`${t.contentType} IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')`,
    ),
    // 5 MiB (RN22).
    check('board_covers_size_check', sql`${t.sizeBytes} BETWEEN 1 AND 5242880`),
    check(
      'board_covers_dimensions_check',
      sql`(${t.width} IS NULL OR ${t.width} BETWEEN 1 AND 20000) AND (${t.height} IS NULL OR ${t.height} BETWEEN 1 AND 20000)`,
    ),
  ],
);

/**
 * Colunas do quadro. `position` é chave de `fractional-indexing` em `text COLLATE "C"` (ADR 0004).
 * No máximo uma lista de conclusão por quadro (RN06), e ela nunca está arquivada (arquivar desmarca).
 */
export const lists = pgTable(
  'lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: textC('position').notNull(),
    isDoneList: boolean('is_done_list').notNull().default(false),
    /** Sem default: a API escolhe (`nextPaletteColor` ou cores das listas padrão). */
    color: paletteColor('color').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // I5: posições únicas entre listas ativas; serve ao payload (`board_id = $1 ... ORDER BY position`).
    uniqueIndex('lists_board_position_active_unique')
      .on(t.boardId, t.position)
      .where(sql`${t.archivedAt} IS NULL`),
    // I4 / RN06: no máximo uma lista de conclusão por quadro.
    uniqueIndex('lists_board_done_list_unique')
      .on(t.boardId)
      .where(sql`${t.isDoneList}`),
    // Todas as listas do quadro (inclusive arquivadas): `GET /boards/:id/archived` e cascata da FK.
    index('lists_board_id_idx').on(t.boardId),
    // Alvo da FK composta `cards (list_id, board_id)`: garante I6 (card no mesmo quadro da lista).
    unique('lists_id_board_id_unique').on(t.id, t.boardId),
    check('lists_name_length_check', sql`char_length(${t.name}) BETWEEN 1 AND 100`),
    check('lists_position_not_empty_check', sql`${t.position} <> ''`),
    check(
      'lists_done_list_not_archived_check',
      sql`NOT (${t.isDoneList} AND ${t.archivedAt} IS NOT NULL)`,
    ),
  ],
);

export type BoardRow = typeof boards.$inferSelect;
export type NewBoardRow = typeof boards.$inferInsert;
export type BoardViewerRow = typeof boardViewers.$inferSelect;
export type BoardCoverRow = typeof boardCovers.$inferSelect;
export type NewBoardCoverRow = typeof boardCovers.$inferInsert;
export type BoardVisibilityValue = (typeof boardVisibility.enumValues)[number];
export type ListRow = typeof lists.$inferSelect;
export type NewListRow = typeof lists.$inferInsert;
export type PaletteColorValue = (typeof paletteColor.enumValues)[number];
