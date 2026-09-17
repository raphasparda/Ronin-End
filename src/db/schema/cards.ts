import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, textC, updatedAt } from '../types';

import { boards, lists } from './boards';
import { users } from './users';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const cardStatus = pgEnum('card_status', ['open', 'completed']);

/** Prioridade opcional do card (RN16, ADR 0012). `null` = sem prioridade. Não afeta `position`. */
export const cardPriority = pgEnum('card_priority', ['low', 'medium', 'high', 'urgent']);

/**
 * Visibilidade do card (Fatia 11, ADR 0015). `team` (padrão) = todo usuário ativo vê (RN05);
 * `restricted` = só Admins e as pessoas de `card_viewers` (I13).
 */
export const cardVisibility = pgEnum('card_visibility', ['team', 'restricted']);

/**
 * Tipos de atividade do card (overview.md §5.3). O formato de `data` de cada tipo é validado pela
 * union discriminada em `@raphasparda/ronin-shared` (`schemas/activity.ts`).
 */
export const activityType = pgEnum('activity_type', [
  'card_created',
  'card_title_changed',
  'card_moved',
  'card_assignee_added',
  'card_assignee_removed',
  'card_due_changed',
  'card_priority_changed',
  'card_completed',
  'card_reopened',
  'card_archived',
  'card_restored',
  // Fatia 11 (migration 0008): `ALTER TYPE ... ADD VALUE` não pode ser usado na mesma transação
  // que o declara; quem grava estas atividades é o código, depois do deploy.
  'card_visibility_changed',
  'card_viewer_added',
  'card_viewer_removed',
  'card_cover_changed',
  'card_cover_removed',
]);

/**
 * Cards. `status`/`completed_*` só mudam via `modules/completion` (ADR 0010).
 * `board_id` é redundante com a lista (payload do quadro sem join); a FK composta
 * `(list_id, board_id) -> lists (id, board_id)` garante I6 no banco.
 */
export const cards = pgTable(
  'cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    listId: uuid('list_id').notNull(),
    /** 1–500, sem quebras de linha (a API troca por espaço). */
    title: text('title').notNull(),
    /** Markdown, até 20.000 caracteres. */
    description: text('description').notNull().default(''),
    position: textC('position').notNull(),
    status: cardStatus('status').notNull().default('open'),
    completedAt: tstz('completed_at'),
    completedBy: uuid('completed_by').references(() => users.id, { onDelete: 'restrict' }),
    /** UTC. Sem hora: 23:59:59.999 do dia no fuso do workspace (ADR 0011). */
    dueAt: tstz('due_at'),
    dueHasTime: boolean('due_has_time').notNull().default(false),
    priority: cardPriority('priority'),
    /** Fatia 11: `restricted` exige lista de acesso em `card_viewers` (I13, ADR 0015). */
    visibility: cardVisibility('visibility').notNull().default('team'),
    archivedAt: tstz('archived_at'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'cards_list_board_fk',
      columns: [t.listId, t.boardId],
      foreignColumns: [lists.id, lists.boardId],
    }).onDelete('cascade'),
    // I5: posições únicas entre cards ativos da lista; serve à ordenação por lista.
    uniqueIndex('cards_list_position_active_unique')
      .on(t.listId, t.position)
      .where(sql`${t.archivedAt} IS NULL`),
    // Payload do quadro, arquivados do quadro e cascata ao excluir quadro.
    index('cards_board_id_idx').on(t.boardId),
    // FK composta: cascata/checagem ao excluir lista e cards arquivados de uma lista.
    index('cards_list_id_idx').on(t.listId),
    // Meus cards / prazos: só cards abertos e não arquivados têm prazo relevante.
    index('cards_due_at_open_idx')
      .on(t.dueAt)
      .where(sql`${t.status} = 'open' AND ${t.archivedAt} IS NULL`),
    // Regex do PostgreSQL: `\r`/`\n` são escapes do próprio ARE (o SQL recebe a barra literal).
    check(
      'cards_title_check',
      sql`char_length(${t.title}) BETWEEN 1 AND 500 AND ${t.title} !~ '[\\r\\n]'`,
    ),
    check('cards_description_length_check', sql`char_length(${t.description}) <= 20000`),
    check('cards_position_not_empty_check', sql`${t.position} <> ''`),
    // I7: concluído <=> data e autor da conclusão presentes.
    check(
      'cards_completion_check',
      sql`(${t.status} = 'completed' AND ${t.completedAt} IS NOT NULL AND ${t.completedBy} IS NOT NULL) OR (${t.status} = 'open' AND ${t.completedAt} IS NULL AND ${t.completedBy} IS NULL)`,
    ),
    check('cards_due_has_time_check', sql`${t.dueAt} IS NOT NULL OR NOT ${t.dueHasTime}`),
  ],
);

/**
 * Histórico do card (C12, I12). Append-only: não há rota de update/delete e um trigger recusa
 * `UPDATE` (migration `0004`). Linhas só somem em cascata ao excluir card ou quadro.
 * Nomes de listas/quadros são "fotografados" em `data`; nomes de usuário são resolvidos na leitura.
 */
export const cardActivities = pgTable(
  'card_activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    type: activityType('type').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    // `GET /cards/:id/activity` (por data) e cascata ao excluir card.
    index('card_activities_card_id_created_at_idx').on(t.cardId, t.createdAt),
    // Cascata ao excluir quadro (sem ele, `DELETE boards` varre a tabela inteira).
    index('card_activities_board_id_idx').on(t.boardId),
    check('card_activities_data_object_check', sql`jsonb_typeof(${t.data}) = 'object'`),
  ],
);

/** Responsáveis do card (C4). Usuários nunca são excluídos: atribuições de desativados permanecem. */
export const cardAssignees = pgTable(
  'card_assignees',
  {
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    assignedBy: uuid('assigned_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    // A PK (card_id, user_id) atende o payload do quadro (`card_id = ANY(...)`) e a idempotência.
    primaryKey({ name: 'card_assignees_pkey', columns: [t.cardId, t.userId] }),
    // Meus cards: `JOIN card_assignees ON user_id = $me`.
    index('card_assignees_user_id_idx').on(t.userId),
  ],
);

/**
 * Lista de acesso de um card restrito (Fatia 11, ADR 0015). Só faz sentido com
 * `cards.visibility = 'restricted'` (voltar para `team` apaga as linhas): a regra vive no serviço,
 * não há `CHECK` entre tabelas. Desativar ou anonimizar usuário não apaga linhas aqui — como em
 * `card_assignees`, a pessoa simplesmente não entra mais.
 */
export const cardViewers = pgTable(
  'card_viewers',
  {
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    addedBy: uuid('added_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    // A PK (card_id, user_id) serve ao `EXISTS` correlacionado das listagens e à idempotência.
    primaryKey({ name: 'card_viewers_pkey', columns: [t.cardId, t.userId] }),
    // Anonimização (apaga o acesso da pessoa) e cascata/checagem da FK de usuário.
    index('card_viewers_user_id_idx').on(t.userId),
  ],
);

/**
 * Capa do card (Fatia 11, ADR 0016): no máximo uma por card (I14). O banco guarda só a chave do
 * objeto no R2, o tipo, o tamanho e as dimensões informadas pelo cliente — nunca a URL assinada.
 * Trocar a capa é `INSERT ... ON CONFLICT (card_id) DO UPDATE`.
 */
export const cardCovers = pgTable(
  'card_covers',
  {
    cardId: uuid('card_id')
      .primaryKey()
      .references(() => cards.id, { onDelete: 'cascade' }),
    /** `covers/<card_id>/<32 caracteres base64url>`: a chave sempre pertence ao próprio card. */
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
    // I14: chave de outro card (ou fora do formato) não entra.
    check(
      'card_covers_object_key_check',
      sql`${t.objectKey} ~ ('^covers/' || ${t.cardId} || '/[A-Za-z0-9_-]{32}$')`,
    ),
    check(
      'card_covers_content_type_check',
      sql`${t.contentType} IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')`,
    ),
    // 5 MiB (RN22).
    check('card_covers_size_check', sql`${t.sizeBytes} BETWEEN 1 AND 5242880`),
    check(
      'card_covers_dimensions_check',
      sql`(${t.width} IS NULL OR ${t.width} BETWEEN 1 AND 20000) AND (${t.height} IS NULL OR ${t.height} BETWEEN 1 AND 20000)`,
    ),
  ],
);

export type CardRow = typeof cards.$inferSelect;
export type NewCardRow = typeof cards.$inferInsert;
export type CardActivityRow = typeof cardActivities.$inferSelect;
export type NewCardActivityRow = typeof cardActivities.$inferInsert;
export type CardAssigneeRow = typeof cardAssignees.$inferSelect;
export type CardViewerRow = typeof cardViewers.$inferSelect;
export type CardCoverRow = typeof cardCovers.$inferSelect;
export type NewCardCoverRow = typeof cardCovers.$inferInsert;
export type CardVisibilityValue = (typeof cardVisibility.enumValues)[number];
export type CardPriorityValue = (typeof cardPriority.enumValues)[number];
export type ActivityTypeValue = (typeof activityType.enumValues)[number];
