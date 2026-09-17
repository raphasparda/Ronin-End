import { describe, expect, it } from 'vitest';

import {
  DUE_FILTER_LABELS,
  EMPTY_BOARD_FILTER,
  boardFilterToParams,
  filterCards,
  isBoardFilterActive,
  matchesBoardFilter,
  normalizeSearchText,
  parseBoardFilter,
} from './board-filter';
import type { BoardFilter, FilterableCard } from './board-filter';

const NOW = new Date('2026-09-16T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

function card(
  overrides: Partial<FilterableCard> & { id: string },
): FilterableCard & { id: string } {
  return {
    title: 'Card',
    assigneeIds: [],
    labelIds: [],
    priority: null,
    status: 'open',
    dueAt: null,
    ...overrides,
  };
}

function filter(overrides: Partial<BoardFilter>): BoardFilter {
  return { ...EMPTY_BOARD_FILTER, ...overrides };
}

const cards = [
  card({
    id: 'atrasado',
    title: 'Revisão do orçamento',
    assigneeIds: ['ana'],
    priority: 'urgent',
    dueAt: iso(-HOUR),
    labelIds: ['fin'],
  }),
  card({
    id: 'vencendo',
    title: 'Publicar relatório',
    assigneeIds: ['bia', 'ana'],
    priority: 'high',
    dueAt: iso(HOUR),
  }),
  card({
    id: 'futuro',
    title: 'Planejar sprint',
    assigneeIds: ['bia'],
    priority: 'low',
    dueAt: iso(72 * HOUR),
    labelIds: ['dev'],
  }),
  card({ id: 'sem-prazo', title: 'Organizar ORÇAMENTO anual', labelIds: ['fin', 'dev'] }),
  card({
    id: 'concluido-atrasado',
    title: 'Entregar',
    assigneeIds: ['ana'],
    status: 'completed',
    dueAt: iso(-HOUR),
  }),
];

const ids = (list: readonly { id: string }[]) => list.map((item) => item.id);

describe('isBoardFilterActive', () => {
  it('vazio (ou só espaços no texto) não está ativo', () => {
    expect(isBoardFilterActive(EMPTY_BOARD_FILTER)).toBe(false);
    expect(isBoardFilterActive(filter({ text: '   ' }))).toBe(false);
  });

  it('qualquer critério preenchido ativa', () => {
    expect(isBoardFilterActive(filter({ assigneeIds: ['ana'] }))).toBe(true);
    expect(isBoardFilterActive(filter({ labelIds: ['fin'] }))).toBe(true);
    expect(isBoardFilterActive(filter({ priorities: ['none'] }))).toBe(true);
    expect(isBoardFilterActive(filter({ due: ['overdue'] }))).toBe(true);
    expect(isBoardFilterActive(filter({ text: 'x' }))).toBe(true);
  });
});

describe('filterCards', () => {
  it('sem filtro devolve tudo (cópia)', () => {
    const result = filterCards(cards, EMPTY_BOARD_FILTER, NOW);
    expect(ids(result)).toEqual(ids(cards));
    expect(result).not.toBe(cards);
  });

  it('responsável: qualquer um dos selecionados', () => {
    expect(ids(filterCards(cards, filter({ assigneeIds: ['bia'] }), NOW))).toEqual([
      'vencendo',
      'futuro',
    ]);
    expect(ids(filterCards(cards, filter({ assigneeIds: ['ana', 'bia'] }), NOW))).toEqual([
      'atrasado',
      'vencendo',
      'futuro',
      'concluido-atrasado',
    ]);
  });

  it('etiqueta: qualquer uma das selecionadas', () => {
    expect(ids(filterCards(cards, filter({ labelIds: ['fin'] }), NOW))).toEqual([
      'atrasado',
      'sem-prazo',
    ]);
  });

  it('prioridade, incluindo "sem prioridade"', () => {
    expect(ids(filterCards(cards, filter({ priorities: ['urgent', 'high'] }), NOW))).toEqual([
      'atrasado',
      'vencendo',
    ]);
    expect(ids(filterCards(cards, filter({ priorities: ['none'] }), NOW))).toEqual([
      'sem-prazo',
      'concluido-atrasado',
    ]);
  });

  it('prazo: atrasado e vencendo ignoram concluídos; sem prazo olha só o campo', () => {
    expect(ids(filterCards(cards, filter({ due: ['overdue'] }), NOW))).toEqual(['atrasado']);
    expect(ids(filterCards(cards, filter({ due: ['due_soon'] }), NOW))).toEqual(['vencendo']);
    expect(ids(filterCards(cards, filter({ due: ['none'] }), NOW))).toEqual(['sem-prazo']);
    expect(ids(filterCards(cards, filter({ due: ['overdue', 'none'] }), NOW))).toEqual([
      'atrasado',
      'sem-prazo',
    ]);
  });

  it('texto: sem diferenciar caixa e acentos', () => {
    expect(ids(filterCards(cards, filter({ text: ' orcamento ' }), NOW))).toEqual([
      'atrasado',
      'sem-prazo',
    ]);
    expect(ids(filterCards(cards, filter({ text: 'RELATÓRIO' }), NOW))).toEqual(['vencendo']);
  });

  it('critérios combinam com E', () => {
    expect(
      ids(
        filterCards(
          cards,
          filter({ assigneeIds: ['ana'], labelIds: ['fin'], text: 'revisão' }),
          NOW,
        ),
      ),
    ).toEqual(['atrasado']);
    expect(ids(filterCards(cards, filter({ labelIds: ['dev'], due: ['overdue'] }), NOW))).toEqual(
      [],
    );
  });

  it('matchesBoardFilter com card sem nada casa só com filtro vazio', () => {
    const blank = card({ id: 'x' });
    expect(matchesBoardFilter(blank, EMPTY_BOARD_FILTER, NOW)).toBe(true);
    expect(matchesBoardFilter(blank, filter({ assigneeIds: ['ana'] }), NOW)).toBe(false);
  });
});

describe('normalizeSearchText', () => {
  it('remove acentos, espaços nas pontas e caixa', () => {
    expect(normalizeSearchText('  Ação É Útil ')).toBe('acao e util');
  });
});

describe('query string', () => {
  it('parseBoardFilter lê vírgulas, ignora desconhecidos e repetidos', () => {
    expect(
      parseBoardFilter({
        responsavel: 'ana, bia,,ana',
        etiqueta: 'fin',
        prioridade: 'none,urgent,xyz,urgent',
        prazo: 'none,overdue,amanha',
        q: '  orçamento ',
        outro: 'ignorado',
      }),
    ).toEqual({
      assigneeIds: ['ana', 'bia'],
      labelIds: ['fin'],
      priorities: ['urgent', 'none'],
      due: ['overdue', 'none'],
      text: 'orçamento',
    });
  });

  it('parseBoardFilter sem parâmetros é o filtro vazio', () => {
    expect(parseBoardFilter({})).toEqual(EMPTY_BOARD_FILTER);
    expect(parseBoardFilter({ responsavel: null, q: undefined })).toEqual(EMPTY_BOARD_FILTER);
  });

  it('boardFilterToParams omite vazios e usa ordem canônica', () => {
    expect(boardFilterToParams(EMPTY_BOARD_FILTER)).toEqual({});
    expect(
      boardFilterToParams({
        assigneeIds: ['bia', 'ana', 'bia'],
        labelIds: ['fin'],
        priorities: ['none', 'low', 'urgent'],
        due: ['none', 'due_soon'],
        text: ' texto ',
      }),
    ).toEqual({
      responsavel: 'bia,ana',
      etiqueta: 'fin',
      prioridade: 'low,urgent,none',
      prazo: 'due_soon,none',
      q: 'texto',
    });
  });

  it('ida e volta preserva o filtro', () => {
    const original: BoardFilter = {
      assigneeIds: ['ana'],
      labelIds: ['fin', 'dev'],
      priorities: ['high', 'none'],
      due: ['overdue'],
      text: 'orçamento',
    };
    expect(parseBoardFilter(boardFilterToParams(original))).toEqual(original);
  });

  it('rótulos de prazo em pt-BR', () => {
    expect(DUE_FILTER_LABELS).toEqual({
      overdue: 'Atrasado',
      due_soon: 'Vencendo',
      none: 'Sem prazo',
    });
  });
});
