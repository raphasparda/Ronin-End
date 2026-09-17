import {
  and,
  asc,
  desc,
  eq,
  exists,
  isNotNull,
  isNull,
  notExists,
  sql,
  type SQL,
} from 'drizzle-orm';

import type { DbExecutor } from '../../db/client';
import {
  boards,
  cardAssignees,
  cardLabels,
  cards,
  cardViewers,
  checklistItems,
  checklists,
  comments,
  labels,
  lists,
  type CardRow,
  type ChecklistItemRow,
  type ChecklistRow,
  type CommentRow,
  type ListRow,
  type NewCardRow,
} from '../../db/schema';

import { cardAccessCondition, type CardActor } from './access';

export type CardSummaryRow = Pick<
  CardRow,
  | 'id'
  | 'boardId'
  | 'listId'
  | 'title'
  | 'position'
  | 'status'
  | 'completedAt'
  | 'dueAt'
  | 'dueHasTime'
  | 'priority'
  | 'visibility'
  | 'archivedAt'
> & {
  /** `false` = card restrito sem acesso: a resposta vira `LockedCard` (ADR 0015). */
  accessible: boolean;
  hasDescription: boolean;
  checklistDone: number;
  checklistTotal: number;
  commentCount: number;
  listName: string;
  listColor: ListRow['color'];
  listArchived: boolean;
  boardName: string;
};

/**
 * Cards de um quadro (`active` ou `archived`), um card só (arquivado ou não) ou "Meus cards"
 * (`assigneeId`: abertos, não arquivados, em lista e quadro não arquivados, atribuídos ao usuário).
 */
export type CardSummaryScope =
  { boardId: string; state: 'active' | 'archived' } | { cardId: string } | { assigneeId: string };

/** O card está numa lista ativa (e, com `withBoard`, num quadro ativo). */
function inActiveContainers(db: DbExecutor, withBoard: boolean): SQL {
  const listActive = exists(
    db
      .select({ one: sql`1` })
      .from(lists)
      .where(and(eq(lists.id, cards.listId), isNull(lists.archivedAt))),
  );
  if (!withBoard) return listActive;
  return and(
    listActive,
    exists(
      db
        .select({ one: sql`1` })
        .from(boards)
        .where(and(eq(boards.id, cards.boardId), isNull(boards.archivedAt))),
    ),
  ) as SQL;
}

/**
 * Filtro completo do escopo sobre `cards`, aplicado igualmente na consulta principal, nas
 * subconsultas de agregados e nos pares de etiquetas/responsáveis (nada fora do escopo é lido).
 */
function scopeFilterOf(db: DbExecutor, scope: CardSummaryScope): SQL {
  if ('cardId' in scope) return eq(cards.id, scope.cardId);
  if ('boardId' in scope) {
    return scope.state === 'active'
      ? (and(
          eq(cards.boardId, scope.boardId),
          isNull(cards.archivedAt),
          inActiveContainers(db, false),
        ) as SQL)
      : (and(eq(cards.boardId, scope.boardId), isNotNull(cards.archivedAt)) as SQL);
  }
  return and(
    exists(
      db
        .select({ one: sql`1` })
        .from(cardAssignees)
        .where(and(eq(cardAssignees.cardId, cards.id), eq(cardAssignees.userId, scope.assigneeId))),
    ),
    eq(cards.status, 'open'),
    isNull(cards.archivedAt),
    inActiveContainers(db, true),
  ) as SQL;
}

/**
 * Escopo + acesso: usado nos agregados e nos pares de etiquetas/responsáveis, para que **nenhum**
 * dado de card bloqueado saia do banco (ADR 0015, api.md §18.7 item 48).
 */
function scopeWithAccessOf(db: DbExecutor, scope: CardSummaryScope, actor: CardActor): SQL {
  return and(scopeFilterOf(db, scope), cardAccessCondition(db, actor)) as SQL;
}

/**
 * Cards com os agregados da face (`checklist`, `commentCount`, `hasDescription`),
 * numa única consulta com subconsultas agrupadas (sem N+1, api.md §9).
 * - quadro `active`: cards não arquivados de listas não arquivadas, por `(listId, position)`;
 * - quadro `archived`: cards arquivados individualmente, por `archivedAt` desc;
 * - card: a linha do card, em qualquer estado;
 * - `assigneeId` ("Meus cards", D1): por `dueAt ASC NULLS LAST`, prioridade, `createdAt`.
 */
export async function findCardSummaryRows(
  db: DbExecutor,
  scope: CardSummaryScope,
  actor: CardActor,
): Promise<CardSummaryRow[]> {
  const access = cardAccessCondition(db, actor);
  // "Meus cards" filtra (não bloqueia): card sem acesso não é item de trabalho (§18.7 item 49).
  const scopeFilter =
    'assigneeId' in scope
      ? (and(scopeFilterOf(db, scope), access) as SQL)
      : scopeFilterOf(db, scope);
  // Agregados e listas de etiquetas/responsáveis nunca leem card bloqueado.
  const aggregateFilter = scopeWithAccessOf(db, scope, actor);

  const checklistAgg = db
    .select({
      cardId: checklists.cardId,
      done: sql<number>`count(${checklistItems.id}) FILTER (WHERE ${checklistItems.isChecked})`.as(
        'done',
      ),
      total: sql<number>`count(${checklistItems.id})`.as('total'),
    })
    .from(checklists)
    .innerJoin(cards, eq(cards.id, checklists.cardId))
    .innerJoin(checklistItems, eq(checklistItems.checklistId, checklists.id))
    .where(aggregateFilter)
    .groupBy(checklists.cardId)
    .as('checklist_agg');

  const commentAgg = db
    .select({
      cardId: comments.cardId,
      count: sql<number>`count(*)`.as('count'),
    })
    .from(comments)
    .innerJoin(cards, eq(cards.id, comments.cardId))
    .where(aggregateFilter)
    .groupBy(comments.cardId)
    .as('comment_agg');

  const query = db
    .select({
      id: cards.id,
      boardId: cards.boardId,
      listId: cards.listId,
      title: cards.title,
      position: cards.position,
      status: cards.status,
      completedAt: cards.completedAt,
      dueAt: cards.dueAt,
      dueHasTime: cards.dueHasTime,
      priority: cards.priority,
      visibility: cards.visibility,
      archivedAt: cards.archivedAt,
      accessible: sql<boolean>`(${access})`.mapWith(Boolean),
      hasDescription: sql<boolean>`(${cards.description} <> '')`,
      checklistDone: sql<number>`coalesce(${checklistAgg.done}, 0)`.mapWith(Number),
      checklistTotal: sql<number>`coalesce(${checklistAgg.total}, 0)`.mapWith(Number),
      commentCount: sql<number>`coalesce(${commentAgg.count}, 0)`.mapWith(Number),
      listName: lists.name,
      listColor: lists.color,
      listArchived: sql<boolean>`(${lists.archivedAt} IS NOT NULL)`,
      boardName: boards.name,
    })
    .from(cards)
    .innerJoin(lists, eq(lists.id, cards.listId))
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .leftJoin(checklistAgg, eq(checklistAgg.cardId, cards.id))
    .leftJoin(commentAgg, eq(commentAgg.cardId, cards.id));

  if ('cardId' in scope) return query.where(scopeFilter).limit(1);
  if ('assigneeId' in scope) {
    // D1: prazo (sem prazo por último), prioridade (enum em ordem crescente: urgent → low, nula por
    // último), criação.
    return query
      .where(scopeFilter)
      .orderBy(
        sql`${cards.dueAt} ASC NULLS LAST`,
        sql`${cards.priority} DESC NULLS LAST`,
        asc(cards.createdAt),
        asc(cards.id),
      );
  }
  if (scope.state === 'active') {
    return query.where(scopeFilter).orderBy(asc(cards.listId), asc(cards.position));
  }
  return query.where(scopeFilter).orderBy(desc(cards.archivedAt), asc(cards.id));
}

/** `(cardId, labelId)` das etiquetas aplicadas aos cards do escopo, por nome da etiqueta. */
export async function findCardLabelPairs(
  db: DbExecutor,
  scope: CardSummaryScope,
  actor: CardActor,
): Promise<{ cardId: string; labelId: string }[]> {
  return db
    .select({ cardId: cardLabels.cardId, labelId: cardLabels.labelId })
    .from(cardLabels)
    .innerJoin(cards, eq(cards.id, cardLabels.cardId))
    .innerJoin(labels, eq(labels.id, cardLabels.labelId))
    .where(scopeWithAccessOf(db, scope, actor))
    .orderBy(asc(labels.name), asc(labels.id));
}

/** `(cardId, userId)` dos responsáveis dos cards do escopo, por ordem de atribuição. */
export async function findCardAssigneePairs(
  db: DbExecutor,
  scope: CardSummaryScope,
  actor: CardActor,
): Promise<{ cardId: string; userId: string }[]> {
  return db
    .select({ cardId: cardAssignees.cardId, userId: cardAssignees.userId })
    .from(cardAssignees)
    .innerJoin(cards, eq(cards.id, cardAssignees.cardId))
    .where(scopeWithAccessOf(db, scope, actor))
    .orderBy(asc(cardAssignees.createdAt), asc(cardAssignees.userId));
}

export async function findCardById(db: DbExecutor, id: string): Promise<CardRow | undefined> {
  const [row] = await db.select().from(cards).where(eq(cards.id, id)).limit(1);
  return row;
}

/** Card com lock de linha (I8). Ordem de locks: quadro(s) → lista(s) → card. */
export async function lockCardById(db: DbExecutor, id: string): Promise<CardRow | undefined> {
  const [row] = await db.select().from(cards).where(eq(cards.id, id)).limit(1).for('update');
  return row;
}

export async function insertCardRow(db: DbExecutor, values: NewCardRow): Promise<CardRow> {
  const [row] = await db.insert(cards).values(values).returning();
  if (!row) throw new Error('insert em cards não retornou linha');
  return row;
}

/**
 * Atualiza campos do card que não são de conclusão (esses só em `modules/completion`).
 * Mover entre quadros grava `listId` e `boardId` juntos (FK composta `cards_list_board_fk`).
 */
export async function updateCardById(
  db: DbExecutor,
  id: string,
  values: Partial<
    Pick<
      NewCardRow,
      | 'title'
      | 'description'
      | 'dueAt'
      | 'dueHasTime'
      | 'priority'
      | 'visibility'
      | 'listId'
      | 'boardId'
      | 'position'
      | 'archivedAt'
      | 'updatedAt'
    >
  >,
): Promise<CardRow> {
  const [row] = await db.update(cards).set(values).where(eq(cards.id, id)).returning();
  if (!row) throw new Error('update em cards não retornou linha');
  return row;
}

export async function deleteCardById(db: DbExecutor, id: string): Promise<void> {
  await db.delete(cards).where(eq(cards.id, id));
}

/**
 * Remove do card as etiquetas que não pertencem a `boardId` (mover entre quadros).
 * @returns ids das etiquetas removidas, ordenados.
 */
export async function deleteForeignCardLabels(
  db: DbExecutor,
  cardId: string,
  boardId: string,
): Promise<string[]> {
  const rows = await db
    .delete(cardLabels)
    .where(
      and(
        eq(cardLabels.cardId, cardId),
        notExists(
          db
            .select({ id: labels.id })
            .from(labels)
            .where(and(eq(labels.id, cardLabels.labelId), eq(labels.boardId, boardId))),
        ),
      ),
    )
    .returning({ labelId: cardLabels.labelId });
  return rows.map((row) => row.labelId).sort();
}

/** Checklists do card (ordem de criação) e seus itens (por `position`). */
export async function findCardChecklists(
  db: DbExecutor,
  cardId: string,
): Promise<{ checklists: ChecklistRow[]; items: ChecklistItemRow[] }> {
  const checklistRows = await db
    .select()
    .from(checklists)
    .where(eq(checklists.cardId, cardId))
    .orderBy(asc(checklists.createdAt), asc(checklists.id));
  if (checklistRows.length === 0) return { checklists: [], items: [] };
  const items = await db
    .select({ item: checklistItems })
    .from(checklistItems)
    .innerJoin(checklists, eq(checklists.id, checklistItems.checklistId))
    .where(eq(checklists.cardId, cardId))
    .orderBy(asc(checklistItems.position), asc(checklistItems.id));
  return { checklists: checklistRows, items: items.map((row) => row.item) };
}

/** Comentários do card em ordem cronológica crescente. */
export async function findCardComments(db: DbExecutor, cardId: string): Promise<CommentRow[]> {
  return db
    .select()
    .from(comments)
    .where(eq(comments.cardId, cardId))
    .orderBy(asc(comments.createdAt), asc(comments.id));
}

// ---------------------------------------------------------------------------
// Responsáveis (C4) e etiquetas aplicadas (C6)
// ---------------------------------------------------------------------------

/** Responsáveis de um card, por ordem de atribuição (mesma ordem do payload do quadro). */
export async function findCardAssigneeIds(db: DbExecutor, cardId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: cardAssignees.userId })
    .from(cardAssignees)
    .where(eq(cardAssignees.cardId, cardId))
    .orderBy(asc(cardAssignees.createdAt), asc(cardAssignees.userId));
  return rows.map((row) => row.userId);
}

/** Atribui; `true` se a atribuição é nova (`ON CONFLICT DO NOTHING` na PK). */
export async function insertCardAssignee(
  db: DbExecutor,
  values: { cardId: string; userId: string; assignedBy: string; now: Date },
): Promise<boolean> {
  const rows = await db
    .insert(cardAssignees)
    .values({
      cardId: values.cardId,
      userId: values.userId,
      assignedBy: values.assignedBy,
      createdAt: values.now,
    })
    .onConflictDoNothing()
    .returning({ userId: cardAssignees.userId });
  return rows.length > 0;
}

/** Remove a atribuição; `true` se existia. */
export async function deleteCardAssignee(
  db: DbExecutor,
  cardId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .delete(cardAssignees)
    .where(and(eq(cardAssignees.cardId, cardId), eq(cardAssignees.userId, userId)))
    .returning({ userId: cardAssignees.userId });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Lista de acesso do card restrito (Fatia 11, ADR 0015)
// ---------------------------------------------------------------------------

/** Lista de acesso do card, por ordem de inclusão (mesma ordem devolvida em `viewerIds`). */
export async function findCardViewerIds(db: DbExecutor, cardId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: cardViewers.userId })
    .from(cardViewers)
    .where(eq(cardViewers.cardId, cardId))
    .orderBy(asc(cardViewers.createdAt), asc(cardViewers.userId));
  return rows.map((row) => row.userId);
}

/** Inclui na lista de acesso; `true` se a inclusão é nova (`ON CONFLICT DO NOTHING` na PK). */
export async function insertCardViewer(
  db: DbExecutor,
  values: { cardId: string; userId: string; addedBy: string; now: Date },
): Promise<boolean> {
  const rows = await db
    .insert(cardViewers)
    .values({
      cardId: values.cardId,
      userId: values.userId,
      addedBy: values.addedBy,
      createdAt: values.now,
    })
    .onConflictDoNothing()
    .returning({ userId: cardViewers.userId });
  return rows.length > 0;
}

/** Remove da lista de acesso; `true` se existia. */
export async function deleteCardViewer(
  db: DbExecutor,
  cardId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .delete(cardViewers)
    .where(and(eq(cardViewers.cardId, cardId), eq(cardViewers.userId, userId)))
    .returning({ userId: cardViewers.userId });
  return rows.length > 0;
}

/** Apaga a lista de acesso inteira (voltar o card para `team`). */
export async function deleteCardViewers(db: DbExecutor, cardId: string): Promise<void> {
  await db.delete(cardViewers).where(eq(cardViewers.cardId, cardId));
}

/** Etiquetas aplicadas a um card, por nome da etiqueta (mesma ordem do payload do quadro). */
export async function findCardLabelIds(db: DbExecutor, cardId: string): Promise<string[]> {
  const rows = await db
    .select({ labelId: cardLabels.labelId })
    .from(cardLabels)
    .innerJoin(labels, eq(labels.id, cardLabels.labelId))
    .where(eq(cardLabels.cardId, cardId))
    .orderBy(asc(labels.name), asc(labels.id));
  return rows.map((row) => row.labelId);
}

/** Aplica a etiqueta ao card (idempotente). */
export async function insertCardLabel(
  db: DbExecutor,
  cardId: string,
  labelId: string,
): Promise<void> {
  await db.insert(cardLabels).values({ cardId, labelId }).onConflictDoNothing();
}

/** Remove a etiqueta do card (idempotente). */
export async function deleteCardLabel(
  db: DbExecutor,
  cardId: string,
  labelId: string,
): Promise<void> {
  await db
    .delete(cardLabels)
    .where(and(eq(cardLabels.cardId, cardId), eq(cardLabels.labelId, labelId)));
}
