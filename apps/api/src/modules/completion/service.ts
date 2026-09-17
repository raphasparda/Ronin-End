import { and, eq, isNull } from 'drizzle-orm';

import type { DbExecutor } from '../../db/client';
import { cardActivities, cards } from '../../db/schema';

/**
 * Serviço único de conclusão (ADR 0010, overview.md §4.2). Mudanças de `status` do card só
 * acontecem aqui. Nesta fatia: a conclusão em massa ao marcar uma lista como de conclusão; as
 * transições de `complete`/`reopen`/`move`/`restore` entram na tarefa 8.2.
 */

export interface CompleteListCardsInput {
  boardId: string;
  listId: string;
  actorId: string;
  now: Date;
}

/**
 * Conclui os cards abertos e não arquivados da lista (ator = quem marcou), mantendo as posições,
 * e registra `card_completed` para cada um. Deve rodar na mesma transação que marca a lista.
 * O `UPDATE` bloqueia cada card: um `complete` concorrente espera e reavalia `status = 'open'`,
 * então nenhum card é concluído (nem registrado) duas vezes.
 *
 * @returns ids dos cards concluídos por esta chamada (ordenados).
 */
export async function completeOpenCardsInList(
  tx: DbExecutor,
  input: CompleteListCardsInput,
): Promise<string[]> {
  const completed = await tx
    .update(cards)
    .set({
      status: 'completed',
      completedAt: input.now,
      completedBy: input.actorId,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(cards.listId, input.listId),
        eq(cards.boardId, input.boardId),
        eq(cards.status, 'open'),
        isNull(cards.archivedAt),
      ),
    )
    .returning({ id: cards.id });

  const ids = completed.map((row) => row.id).sort();
  if (ids.length > 0) {
    await tx.insert(cardActivities).values(
      ids.map((cardId) => ({
        cardId,
        boardId: input.boardId,
        actorId: input.actorId,
        type: 'card_completed' as const,
        data: {},
        createdAt: input.now,
      })),
    );
  }
  return ids;
}
