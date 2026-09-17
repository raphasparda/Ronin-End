import type { ArchivedCard, CardSummary } from '@kanban/shared';

import type { DbExecutor } from '../../db/client';
import { toIsoOrNull } from '../../lib/dates';

import {
  findBoardCardAssigneePairs,
  findBoardCardLabelPairs,
  findCardSummaryRows,
  type CardSummaryRow,
} from './repository';

function groupBy<T>(pairs: T[], key: (pair: T) => string, value: (pair: T) => string) {
  const map = new Map<string, string[]>();
  for (const pair of pairs) {
    const k = key(pair);
    const list = map.get(k);
    if (list) list.push(value(pair));
    else map.set(k, [value(pair)]);
  }
  return map;
}

function toCardSummary(
  row: CardSummaryRow,
  labelIds: Map<string, string[]>,
  assigneeIds: Map<string, string[]>,
): CardSummary {
  return {
    id: row.id,
    boardId: row.boardId,
    listId: row.listId,
    title: row.title,
    position: row.position,
    status: row.status,
    completedAt: toIsoOrNull(row.completedAt),
    dueAt: toIsoOrNull(row.dueAt),
    dueHasTime: row.dueHasTime,
    priority: row.priority,
    labelIds: labelIds.get(row.id) ?? [],
    assigneeIds: assigneeIds.get(row.id) ?? [],
    checklist: { done: row.checklistDone, total: row.checklistTotal },
    commentCount: row.commentCount,
    hasDescription: row.hasDescription,
    archivedAt: toIsoOrNull(row.archivedAt),
  };
}

async function loadSummaries(
  db: DbExecutor,
  boardId: string,
  scope: 'active' | 'archived',
): Promise<{ row: CardSummaryRow; card: CardSummary }[]> {
  const rows = await findCardSummaryRows(db, boardId, scope);
  if (rows.length === 0) return [];
  // Sequencial: `db` pode ser uma transação (uma conexão só).
  const labelPairs = await findBoardCardLabelPairs(db, boardId);
  const assigneePairs = await findBoardCardAssigneePairs(db, boardId);
  const labelIds = groupBy(
    labelPairs,
    (p) => p.cardId,
    (p) => p.labelId,
  );
  const assigneeIds = groupBy(
    assigneePairs,
    (p) => p.cardId,
    (p) => p.userId,
  );
  return rows.map((row) => ({ row, card: toCardSummary(row, labelIds, assigneeIds) }));
}

/** Cards do payload do quadro: não arquivados, de listas não arquivadas, por `(listId, position)`. */
export async function loadBoardCards(db: DbExecutor, boardId: string): Promise<CardSummary[]> {
  return (await loadSummaries(db, boardId, 'active')).map(({ card }) => card);
}

/** Cards arquivados individualmente, com o contexto da lista, por `archivedAt` desc. */
export async function loadArchivedCards(db: DbExecutor, boardId: string): Promise<ArchivedCard[]> {
  return (await loadSummaries(db, boardId, 'archived')).map(({ row, card }) => ({
    ...card,
    listName: row.listName,
    listArchived: row.listArchived,
  }));
}
