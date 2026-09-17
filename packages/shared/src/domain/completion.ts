import type { CompletionChange } from '../schemas/cards';
import { comparePosition } from './ordering';
import type { CardStatus } from './due-state';

/**
 * Regras de conclusão (overview.md §4.2, ADR 0010) em funções puras.
 * O servidor aplica as transições em `modules/completion`; o front usa estas funções para
 * atualizações otimistas coerentes com a resposta.
 */

export interface CompletionListRef {
  id: string;
  isDoneList: boolean;
  position: string;
  /** Ausente = lista ativa (o payload do quadro só traz ativas). */
  archivedAt?: string | null;
}

function activeLists<T extends CompletionListRef>(lists: readonly T[]): T[] {
  return lists.filter((list) => list.archivedAt == null);
}

/** Lista de conclusão ativa do quadro, ou `null` (RN06: no máximo uma). */
export function findDoneList<T extends CompletionListRef>(lists: readonly T[]): T | null {
  return activeLists(lists).find((list) => list.isDoneList) ?? null;
}

/**
 * Mudança de status em `POST /cards/:id/move`:
 * aberto entrando na lista de conclusão → `completed`;
 * concluído saindo da lista de conclusão para lista comum → `reopened`; demais → `null`.
 */
export function completionChangeOnMove(input: {
  status: CardStatus;
  fromListIsDone: boolean;
  toListIsDone: boolean;
}): CompletionChange | null {
  if (input.status === 'open' && input.toListIsDone) return 'completed';
  if (input.status === 'completed' && input.fromListIsDone && !input.toListIsDone) {
    return 'reopened';
  }
  return null;
}

/**
 * Lista para onde `complete` leva o card: a lista de conclusão, se existir e o card não
 * estiver nela (entra no **fim**). `null` = o card fica onde está.
 */
export function completeTargetListId(
  card: { listId: string },
  lists: readonly CompletionListRef[],
): string | null {
  const doneList = findDoneList(lists);
  return doneList !== null && doneList.id !== card.listId ? doneList.id : null;
}

/**
 * Lista para onde `reopen` leva o card: se ele está na lista de conclusão, a primeira lista
 * ativa não-conclusão (menor `position`), no **topo**. `null` = fica onde está.
 */
export function reopenTargetListId(
  card: { listId: string },
  lists: readonly CompletionListRef[],
): string | null {
  const doneList = findDoneList(lists);
  if (doneList === null || doneList.id !== card.listId) return null;
  const candidates = activeLists(lists)
    .filter((list) => !list.isDoneList)
    .sort((a, b) => comparePosition(a.position, b.position));
  return candidates[0]?.id ?? null;
}

/** `restore` de card aberto cuja lista é de conclusão também conclui (RN12). */
export function completionChangeOnRestore(input: {
  status: CardStatus;
  listIsDone: boolean;
}): CompletionChange | null {
  return input.status === 'open' && input.listIsDone ? 'completed' : null;
}

/**
 * Cards que `PATCH /lists/:id { isDoneList: true }` concluirá: abertos e não arquivados da
 * lista. Usado no diálogo de confirmação ("N cards abertos nesta lista serão concluídos").
 */
export function cardsCompletedByMarkingDoneList<
  T extends { listId: string; status: CardStatus; archivedAt: string | null },
>(cards: readonly T[], listId: string): T[] {
  return cards.filter(
    (card) => card.listId === listId && card.status === 'open' && card.archivedAt === null,
  );
}
