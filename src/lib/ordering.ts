import type { Placement } from '@raphasparda/ronin-shared';
import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

import type { DbExecutor } from '../db/client';
import { cards, checklistItems, lists } from '../db/schema';

import { AppError } from './app-error';

/** Chaves maiores que isto disparam o rebalanceamento dos irmãos (ADR 0004). */
export const MAX_POSITION_LENGTH = 64;

export const INVALID_PLACEMENT_MESSAGE =
  'Posição de destino inválida. Atualize a página e tente de novo.';

/** Conjunto de irmãos ordenados por `position` dentro de um pai (ADR 0004). */
export interface SiblingSet {
  table: PgTable;
  id: PgColumn;
  parentId: PgColumn;
  position: PgColumn;
  /** Ausente = irmãos sem arquivamento (itens de checklist). */
  archivedAt?: PgColumn;
}

/** Listas de um quadro. Pai: `boards`. */
export const LIST_SIBLINGS: SiblingSet = {
  table: lists,
  id: lists.id,
  parentId: lists.boardId,
  position: lists.position,
  archivedAt: lists.archivedAt,
};

/** Cards de uma lista. Pai: `lists`. */
export const CARD_SIBLINGS: SiblingSet = {
  table: cards,
  id: cards.id,
  parentId: cards.listId,
  position: cards.position,
  archivedAt: cards.archivedAt,
};

/** Itens de um checklist. Pai: `checklists`. */
export const CHECKLIST_ITEM_SIBLINGS: SiblingSet = {
  table: checklistItems,
  id: checklistItems.id,
  parentId: checklistItems.checklistId,
  position: checklistItems.position,
};

function activeScope(set: SiblingSet, parentId: string): SQL {
  const archived = set.archivedAt ? sql` AND ${set.archivedAt} IS NULL` : sql``;
  return sql`${set.parentId} = ${parentId}${archived}`;
}

function siblingsScope(set: SiblingSet, parentId: string, excludeId: string | null): SQL {
  const exclude = excludeId === null ? sql`` : sql` AND ${set.id} <> ${excludeId}`;
  return sql`${activeScope(set, parentId)}${exclude}`;
}

async function scalarPosition(db: DbExecutor, query: SQL): Promise<string | null> {
  const result = await db.execute<{ p: string | null }>(query);
  return result.rows[0]?.p ?? null;
}

function invalidPlacement(): AppError {
  return new AppError('INVALID_PLACEMENT', INVALID_PLACEMENT_MESSAGE);
}

/**
 * Calcula a chave de posição de um item (novo ou movido) entre os irmãos **ativos** de `parentId`
 * (ADR 0004). O próprio item (`excludeId`) não entra no cálculo.
 *
 * Pré-condição: o chamador já bloqueou a linha do pai (`SELECT ... FOR UPDATE`) na transação
 * corrente, o que serializa movimentos concorrentes no mesmo pai.
 *
 * - `start`: antes da menor posição; `end`: depois da maior;
 * - `after X`: entre `X` e o próximo irmão. `X` inexistente, arquivado, de outro pai ou igual ao
 *   item → `409 INVALID_PLACEMENT`.
 * - Chave acima de 64 caracteres: regrava as posições de todos os irmãos ativos (inclusive o item,
 *   se estiver no mesmo pai) em duas etapas, porque o índice único parcial não é `DEFERRABLE`:
 *   primeiro chaves temporárias `'~' || id` (maiores que qualquer chave base62), depois as finais.
 *   O chamador grava a chave retornada no item.
 */
export async function computePosition(
  db: DbExecutor,
  set: SiblingSet,
  parentId: string,
  placement: Placement,
  excludeId: string | null,
): Promise<string> {
  const scope = siblingsScope(set, parentId, excludeId);
  let key: string;

  switch (placement.type) {
    case 'start': {
      const first = await scalarPosition(
        db,
        sql`SELECT MIN(${set.position}) AS p FROM ${set.table} WHERE ${scope}`,
      );
      key = generateKeyBetween(null, first);
      break;
    }
    case 'end': {
      const last = await scalarPosition(
        db,
        sql`SELECT MAX(${set.position}) AS p FROM ${set.table} WHERE ${scope}`,
      );
      key = generateKeyBetween(last, null);
      break;
    }
    case 'after': {
      if (placement.id === excludeId) throw invalidPlacement();
      const anchor = await scalarPosition(
        db,
        sql`SELECT ${set.position} AS p FROM ${set.table} WHERE ${scope} AND ${set.id} = ${placement.id}`,
      );
      if (anchor === null) throw invalidPlacement();
      const next = await scalarPosition(
        db,
        sql`SELECT MIN(${set.position}) AS p FROM ${set.table} WHERE ${scope} AND ${set.position} > ${anchor}`,
      );
      key = generateKeyBetween(anchor, next);
      break;
    }
  }

  if (key.length <= MAX_POSITION_LENGTH) return key;
  return rebalance(db, set, parentId, placement, excludeId);
}

async function rebalance(
  db: DbExecutor,
  set: SiblingSet,
  parentId: string,
  placement: Placement,
  excludeId: string | null,
): Promise<string> {
  const { rows } = await db.execute<{ id: string }>(
    sql`SELECT ${set.id} AS id FROM ${set.table} WHERE ${siblingsScope(set, parentId, excludeId)} ORDER BY ${set.position}`,
  );
  const ids = rows.map((row) => row.id);

  let index: number;
  if (placement.type === 'start') index = 0;
  else if (placement.type === 'end') index = ids.length;
  else {
    const anchorIndex = ids.indexOf(placement.id);
    if (anchorIndex === -1) throw invalidPlacement();
    index = anchorIndex + 1;
  }

  const keys = generateNKeysBetween(null, null, ids.length + 1);

  // Etapa 1: chaves temporárias distintas para todos os ativos do pai (inclusive o item).
  await db.execute(
    sql`UPDATE ${set.table} SET ${sql.identifier(set.position.name)} = '~' || ${set.id}::text WHERE ${activeScope(set, parentId)}`,
  );
  // Etapa 2: chaves finais dos irmãos, pulando o índice reservado ao item.
  for (const [i, id] of ids.entries()) {
    const finalKey = keys[i < index ? i : i + 1] as string;
    await db.execute(
      sql`UPDATE ${set.table} SET ${sql.identifier(set.position.name)} = ${finalKey} WHERE ${set.id} = ${id}`,
    );
  }
  return keys[index] as string;
}
