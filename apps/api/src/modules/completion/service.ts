import type { CompletionChange } from '@kanban/shared';
import { and, eq, isNull } from 'drizzle-orm';

import type { DbExecutor } from '../../db/client';
import { cards, type CardRow } from '../../db/schema';
import { recordActivity } from '../activity/service';

/**
 * Serviço único de conclusão (ADR 0010, overview.md §4.2). Mudanças de `status` do card só
 * acontecem aqui, sempre na transação da ação que as dispara e com o card bloqueado (I8).
 * As decisões ("esta ação conclui/reabre?") são as funções puras de `@kanban/shared`
 * (`completionChangeOnMove`, `completionChangeOnRestore`), as mesmas do front otimista.
 * Implementado: marcação de lista, `move` e `restore` de card. As rotas `complete`/`reopen`
 * entram na tarefa 8.2 reaproveitando `applyCompletionChange`.
 */

export interface ApplyCompletionInput {
  /** Card já bloqueado (`SELECT ... FOR UPDATE`) na transação corrente. */
  card: Pick<CardRow, 'id' | 'boardId' | 'status'>;
  change: CompletionChange;
  actorId: string;
  now: Date;
}

/**
 * Aplica a transição `open → completed` ou `completed → open` e registra `card_completed` /
 * `card_reopened`. Reabrir limpa `completed_at`/`completed_by` (`cards_completion_check`).
 * Transição que não se aplica ao status atual é um erro de programação.
 */
export async function applyCompletionChange(
  tx: DbExecutor,
  input: ApplyCompletionInput,
): Promise<CardRow> {
  const { card, change, actorId, now } = input;
  const expected = change === 'completed' ? 'open' : 'completed';
  if (card.status !== expected) {
    throw new Error(`transição de conclusão inválida: ${card.status} → ${change}`);
  }
  const values =
    change === 'completed'
      ? { status: 'completed' as const, completedAt: now, completedBy: actorId, updatedAt: now }
      : { status: 'open' as const, completedAt: null, completedBy: null, updatedAt: now };

  const [row] = await tx
    .update(cards)
    .set(values)
    .where(and(eq(cards.id, card.id), eq(cards.status, expected)))
    .returning();
  if (!row) throw new Error('update de conclusão não retornou linha (card não estava bloqueado?)');

  await recordActivity(tx, {
    cardId: card.id,
    boardId: row.boardId,
    actorId,
    now,
    ...(change === 'completed'
      ? { type: 'card_completed' as const, data: {} }
      : { type: 'card_reopened' as const, data: {} }),
  });
  return row;
}

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
  for (const cardId of ids) {
    await recordActivity(tx, {
      cardId,
      boardId: input.boardId,
      actorId: input.actorId,
      now: input.now,
      type: 'card_completed',
      data: {},
    });
  }
  return ids;
}
