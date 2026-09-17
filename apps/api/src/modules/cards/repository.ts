import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import type { DbExecutor } from '../../db/client';
import {
  cardAssignees,
  cardLabels,
  cards,
  checklistItems,
  checklists,
  comments,
  labels,
  lists,
  type CardRow,
} from '../../db/schema';

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
  | 'archivedAt'
> & {
  hasDescription: boolean;
  checklistDone: number;
  checklistTotal: number;
  commentCount: number;
  listName: string;
  listArchived: boolean;
};

/**
 * Cards de um quadro com os agregados da face (`checklist`, `commentCount`, `hasDescription`),
 * numa única consulta com subconsultas agrupadas (sem N+1, api.md §9).
 * - `active`: cards não arquivados de listas não arquivadas, por `(listId, position)`;
 * - `archived`: cards arquivados individualmente, por `archivedAt` desc.
 */
export async function findCardSummaryRows(
  db: DbExecutor,
  boardId: string,
  scope: 'active' | 'archived',
): Promise<CardSummaryRow[]> {
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
    .where(eq(cards.boardId, boardId))
    .groupBy(checklists.cardId)
    .as('checklist_agg');

  const commentAgg = db
    .select({
      cardId: comments.cardId,
      count: sql<number>`count(*)`.as('count'),
    })
    .from(comments)
    .innerJoin(cards, eq(cards.id, comments.cardId))
    .where(eq(cards.boardId, boardId))
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
      archivedAt: cards.archivedAt,
      hasDescription: sql<boolean>`(${cards.description} <> '')`,
      checklistDone: sql<number>`coalesce(${checklistAgg.done}, 0)`.mapWith(Number),
      checklistTotal: sql<number>`coalesce(${checklistAgg.total}, 0)`.mapWith(Number),
      commentCount: sql<number>`coalesce(${commentAgg.count}, 0)`.mapWith(Number),
      listName: lists.name,
      listArchived: sql<boolean>`(${lists.archivedAt} IS NOT NULL)`,
    })
    .from(cards)
    .innerJoin(lists, eq(lists.id, cards.listId))
    .leftJoin(checklistAgg, eq(checklistAgg.cardId, cards.id))
    .leftJoin(commentAgg, eq(commentAgg.cardId, cards.id));

  if (scope === 'active') {
    return query
      .where(and(eq(cards.boardId, boardId), isNull(cards.archivedAt), isNull(lists.archivedAt)))
      .orderBy(asc(cards.listId), asc(cards.position));
  }
  return query
    .where(and(eq(cards.boardId, boardId), isNotNull(cards.archivedAt)))
    .orderBy(desc(cards.archivedAt), asc(cards.id));
}

/** `(cardId, labelId)` das etiquetas aplicadas em cards do quadro, por nome da etiqueta. */
export async function findBoardCardLabelPairs(
  db: DbExecutor,
  boardId: string,
): Promise<{ cardId: string; labelId: string }[]> {
  return db
    .select({ cardId: cardLabels.cardId, labelId: cardLabels.labelId })
    .from(cardLabels)
    .innerJoin(cards, eq(cards.id, cardLabels.cardId))
    .innerJoin(labels, eq(labels.id, cardLabels.labelId))
    .where(eq(cards.boardId, boardId))
    .orderBy(asc(labels.name), asc(labels.id));
}

/** `(cardId, userId)` dos responsáveis de cards do quadro, por ordem de atribuição. */
export async function findBoardCardAssigneePairs(
  db: DbExecutor,
  boardId: string,
): Promise<{ cardId: string; userId: string }[]> {
  return db
    .select({ cardId: cardAssignees.cardId, userId: cardAssignees.userId })
    .from(cardAssignees)
    .innerJoin(cards, eq(cards.id, cardAssignees.cardId))
    .where(eq(cards.boardId, boardId))
    .orderBy(asc(cardAssignees.createdAt), asc(cardAssignees.userId));
}
