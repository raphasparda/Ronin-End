import { desc, eq, sql } from 'drizzle-orm';

import type { DbExecutor } from '../../../../db/client';
import { cardActivities, type CardActivityRow } from '../../../../db/schema';

export interface InsertActivityValues {
  cardId: string;
  boardId: string;
  actorId: string;
  type: CardActivityRow['type'];
  data: Record<string, unknown>;
  now: Date;
}

/**
 * Insere uma atividade com `created_at` estritamente maior que a última do mesmo card
 * (`greatest(now, max + 1 µs)`). Várias atividades gravadas no mesmo instante do relógio (ex.:
 * `card_moved` + `card_completed`) ficam em ordem de gravação, e a resposta continua com o mesmo
 * milissegundo (a API expõe ms). O chamador mantém o card bloqueado (ou recém-criado), então não
 * há corrida entre inserções do mesmo card.
 */
export async function insertActivity(
  db: DbExecutor,
  values: InsertActivityValues,
): Promise<CardActivityRow> {
  const [row] = await db
    .insert(cardActivities)
    .values({
      cardId: values.cardId,
      boardId: values.boardId,
      actorId: values.actorId,
      type: values.type,
      data: values.data,
      createdAt: sql`greatest(${values.now.toISOString()}::timestamptz, (SELECT max(${sql.identifier('created_at')}) + interval '1 microsecond' FROM ${cardActivities} WHERE ${sql.identifier('card_id')} = ${values.cardId}))`,
    })
    .returning();
  if (!row) throw new Error('insert em card_activities não retornou linha');
  return row;
}

/** Atividades do card, mais recentes primeiro, até `limit`. */
export async function findCardActivities(
  db: DbExecutor,
  cardId: string,
  limit: number,
): Promise<CardActivityRow[]> {
  return db
    .select()
    .from(cardActivities)
    .where(eq(cardActivities.cardId, cardId))
    .orderBy(desc(cardActivities.createdAt), desc(cardActivities.id))
    .limit(limit);
}
