import { ACTIVITY_LIMIT, type Activity, type ActivityEntry } from '@raphasparda/ronin-shared';

import type { DbExecutor } from '../../db/client';
import type { CardActivityRow } from '../../db/schema';
import { toIso } from '../../lib/dates';

import { findCardActivities, insertActivity } from './repository';

/**
 * Contexto de uma atividade + par `{ type, data }` tipado pela união de `@raphasparda/ronin-shared`:
 * `data` incompatível com `type` não compila.
 */
export type RecordActivityInput = {
  cardId: string;
  boardId: string;
  actorId: string;
  now: Date;
} & ActivityEntry;

/**
 * Único ponto de escrita do histórico do card (C12, I12: append-only, sem update/delete).
 * Roda na transação da ação que gerou a atividade.
 */
export async function recordActivity(tx: DbExecutor, input: RecordActivityInput): Promise<void> {
  await insertActivity(tx, {
    cardId: input.cardId,
    boardId: input.boardId,
    actorId: input.actorId,
    type: input.type,
    data: input.data,
    now: input.now,
  });
}

export function toActivity(row: CardActivityRow): Activity {
  // `data` foi gravado por `recordActivity` com o tipo correspondente; o serializer da rota
  // valida o formato de novo na saída.
  return {
    id: row.id,
    cardId: row.cardId,
    actorId: row.actorId,
    type: row.type,
    data: row.data,
    createdAt: toIso(row.createdAt),
  } as Activity;
}

/** `GET /api/cards/:cardId/activity`: até 500, mais recentes primeiro (o chamador checa o 404). */
export async function listCardActivities(db: DbExecutor, cardId: string): Promise<Activity[]> {
  return (await findCardActivities(db, cardId, ACTIVITY_LIMIT)).map(toActivity);
}
