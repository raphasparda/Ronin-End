import { describe, expect, it } from 'vitest';

import {
  cardsCompletedByMarkingDoneList,
  completeTargetListId,
  completionChangeOnMove,
  completionChangeOnRestore,
  findDoneList,
  reopenTargetListId,
} from './completion';
import type { CompletionListRef } from './completion';
import type { CardStatus } from './due-state';

// Posições propositalmente fora de ordem no array e com maiúsculas (ordem binária).
const todo: CompletionListRef = { id: 'todo', isDoneList: false, position: 'b0' };
const doing: CompletionListRef = { id: 'doing', isDoneList: false, position: 'Zz' };
const done: CompletionListRef = { id: 'done', isDoneList: true, position: 'c0' };
const archivedFirst: CompletionListRef = {
  id: 'old',
  isDoneList: false,
  position: 'A0',
  archivedAt: '2026-09-01T00:00:00.000Z',
};

describe('findDoneList', () => {
  it('acha a lista de conclusão ativa', () => {
    expect(findDoneList([todo, done, doing])).toBe(done);
    expect(findDoneList([todo, doing])).toBeNull();
  });

  it('ignora lista de conclusão arquivada', () => {
    expect(findDoneList([{ ...done, archivedAt: '2026-09-01T00:00:00.000Z' }])).toBeNull();
    expect(findDoneList([{ ...done, archivedAt: null }])?.id).toBe('done');
  });
});

describe('completionChangeOnMove (matriz status × origem × destino)', () => {
  const cases: [CardStatus, boolean, boolean, 'completed' | 'reopened' | null][] = [
    // status, origem é conclusão, destino é conclusão, esperado
    ['open', false, false, null],
    ['open', false, true, 'completed'],
    ['open', true, true, 'completed'],
    ['open', true, false, null],
    ['completed', true, false, 'reopened'],
    ['completed', true, true, null],
    ['completed', false, true, null],
    ['completed', false, false, null],
  ];

  it.each(cases)(
    '%s, origem conclusão=%s, destino conclusão=%s → %s',
    (status, from, to, expected) => {
      expect(completionChangeOnMove({ status, fromListIsDone: from, toListIsDone: to })).toBe(
        expected,
      );
    },
  );
});

describe('completeTargetListId', () => {
  it('move para a lista de conclusão quando o card não está nela', () => {
    expect(completeTargetListId({ listId: 'todo' }, [todo, doing, done])).toBe('done');
  });

  it('fica onde está se já está na lista de conclusão', () => {
    expect(completeTargetListId({ listId: 'done' }, [todo, done])).toBeNull();
  });

  it('quadro sem lista de conclusão: fica onde está', () => {
    expect(completeTargetListId({ listId: 'todo' }, [todo, doing])).toBeNull();
  });
});

describe('reopenTargetListId', () => {
  it('da lista de conclusão vai para a primeira lista ativa não-conclusão (ordem binária)', () => {
    expect(reopenTargetListId({ listId: 'done' }, [todo, done, doing])).toBe('doing');
  });

  it('ignora listas arquivadas ao escolher o destino', () => {
    expect(reopenTargetListId({ listId: 'done' }, [archivedFirst, todo, done])).toBe('todo');
  });

  it('sem outra lista ativa: fica onde está', () => {
    expect(reopenTargetListId({ listId: 'done' }, [done, archivedFirst])).toBeNull();
  });

  it('fora da lista de conclusão ou quadro sem ela: fica onde está', () => {
    expect(reopenTargetListId({ listId: 'todo' }, [todo, done])).toBeNull();
    expect(reopenTargetListId({ listId: 'todo' }, [todo, doing])).toBeNull();
  });
});

describe('completionChangeOnRestore', () => {
  it('conclui só card aberto restaurado em lista de conclusão', () => {
    expect(completionChangeOnRestore({ status: 'open', listIsDone: true })).toBe('completed');
    expect(completionChangeOnRestore({ status: 'open', listIsDone: false })).toBeNull();
    expect(completionChangeOnRestore({ status: 'completed', listIsDone: true })).toBeNull();
  });
});

describe('cardsCompletedByMarkingDoneList', () => {
  it('conta só abertos e não arquivados da lista', () => {
    const cards = [
      { id: '1', listId: 'L', status: 'open' as const, archivedAt: null },
      { id: '2', listId: 'L', status: 'completed' as const, archivedAt: null },
      { id: '3', listId: 'L', status: 'open' as const, archivedAt: '2026-09-01T00:00:00.000Z' },
      { id: '4', listId: 'M', status: 'open' as const, archivedAt: null },
      { id: '5', listId: 'L', status: 'open' as const, archivedAt: null },
    ];
    expect(cardsCompletedByMarkingDoneList(cards, 'L').map((card) => card.id)).toEqual(['1', '5']);
    expect(cardsCompletedByMarkingDoneList(cards, 'X')).toEqual([]);
  });
});
