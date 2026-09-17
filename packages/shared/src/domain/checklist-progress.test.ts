import { describe, expect, it } from 'vitest';

import { checklistProgress } from './checklist-progress';
import { ACTIVITY_LIMIT, ANONYMIZED_USER_NAME, DEFAULT_BOARD_LISTS } from './constants';

describe('checklistProgress', () => {
  it('soma itens de todos os checklists', () => {
    expect(checklistProgress([])).toEqual({ done: 0, total: 0 });
    expect(
      checklistProgress([
        { items: [{ isChecked: true }, { isChecked: false }] },
        { items: [] },
        { items: [{ isChecked: true }, { isChecked: true }, { isChecked: false }] },
      ]),
    ).toEqual({ done: 3, total: 5 });
  });
});

describe('constantes de domínio', () => {
  it('listas padrão de quadro novo: A fazer (azul), Fazendo (laranja), Concluído (verde, conclusão)', () => {
    expect(DEFAULT_BOARD_LISTS).toEqual([
      { name: 'A fazer', color: 'blue', isDoneList: false },
      { name: 'Fazendo', color: 'orange', isDoneList: false },
      { name: 'Concluído', color: 'green', isDoneList: true },
    ]);
    expect(DEFAULT_BOARD_LISTS.filter((list) => list.isDoneList)).toHaveLength(1);
  });

  it('valores fixos do contrato', () => {
    expect(ANONYMIZED_USER_NAME).toBe('Usuário removido');
    expect(ACTIVITY_LIMIT).toBe(500);
  });
});
