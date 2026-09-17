import { getDueState } from './due-state';
import type { CardStatus } from './due-state';
import { CARD_PRIORITIES } from './priority';
import type { CardPriority } from './priority';

/**
 * Filtro do quadro (C11), aplicado no cliente sobre o payload do quadro (overview.md §9).
 * Dentro de um critério os valores combinam com OU; entre critérios, com E.
 */

/** "Sem prioridade" no filtro. */
export const NO_PRIORITY_FILTER = 'none';
export const PRIORITY_FILTER_VALUES = [...CARD_PRIORITIES, NO_PRIORITY_FILTER] as const;
export type PriorityFilter = (typeof PRIORITY_FILTER_VALUES)[number];

/** Prazo: atrasado, vencendo (24h) ou sem prazo. */
export const DUE_FILTER_VALUES = ['overdue', 'due_soon', 'none'] as const;
export type DueFilter = (typeof DUE_FILTER_VALUES)[number];

export const DUE_FILTER_LABELS = {
  overdue: 'Atrasado',
  due_soon: 'Vencendo',
  none: 'Sem prazo',
} as const satisfies Record<DueFilter, string>;

export interface BoardFilter {
  assigneeIds: string[];
  labelIds: string[];
  priorities: PriorityFilter[];
  due: DueFilter[];
  /** Texto buscado no título (sem diferenciar caixa e acentos). */
  text: string;
}

/** Nomes dos parâmetros na query string (`?responsavel=...&etiqueta=...&prioridade=...&prazo=...&q=...`). */
export const BOARD_FILTER_PARAMS = {
  assigneeIds: 'responsavel',
  labelIds: 'etiqueta',
  priorities: 'prioridade',
  due: 'prazo',
  text: 'q',
} as const satisfies Record<keyof BoardFilter, string>;

export const EMPTY_BOARD_FILTER: Readonly<BoardFilter> = Object.freeze({
  assigneeIds: [],
  labelIds: [],
  priorities: [],
  due: [],
  text: '',
});

export interface FilterableCard {
  title: string;
  assigneeIds: readonly string[];
  labelIds: readonly string[];
  priority: CardPriority | null;
  status: CardStatus;
  dueAt: string | null;
}

/** Minúsculas, sem acentos e sem espaços nas pontas. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function isBoardFilterActive(filter: BoardFilter): boolean {
  return (
    filter.assigneeIds.length > 0 ||
    filter.labelIds.length > 0 ||
    filter.priorities.length > 0 ||
    filter.due.length > 0 ||
    normalizeSearchText(filter.text) !== ''
  );
}

function matchesDue(card: FilterableCard, due: DueFilter, now: Date): boolean {
  // "Sem prazo" olha só o campo; atrasado/vencendo seguem getDueState (concluído nunca casa).
  if (due === 'none') return card.dueAt === null;
  return getDueState(card, now) === due;
}

/** `true` se o card atende a todos os critérios preenchidos do filtro. */
export function matchesBoardFilter(card: FilterableCard, filter: BoardFilter, now: Date): boolean {
  if (
    filter.assigneeIds.length > 0 &&
    !card.assigneeIds.some((id) => filter.assigneeIds.includes(id))
  ) {
    return false;
  }
  if (filter.labelIds.length > 0 && !card.labelIds.some((id) => filter.labelIds.includes(id))) {
    return false;
  }
  if (
    filter.priorities.length > 0 &&
    !filter.priorities.includes(card.priority ?? NO_PRIORITY_FILTER)
  ) {
    return false;
  }
  if (filter.due.length > 0 && !filter.due.some((due) => matchesDue(card, due, now))) {
    return false;
  }
  const query = normalizeSearchText(filter.text);
  return query === '' || normalizeSearchText(card.title).includes(query);
}

/** Cards que passam no filtro, na ordem original. */
export function filterCards<T extends FilterableCard>(
  cards: readonly T[],
  filter: BoardFilter,
  now: Date,
): T[] {
  if (!isBoardFilterActive(filter)) return [...cards];
  return cards.filter((card) => matchesBoardFilter(card, filter, now));
}

function splitList(raw: string | null | undefined): string[] {
  if (raw == null) return [];
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  return [...new Set(values)];
}

function pickKnown<T extends string>(raw: string | null | undefined, known: readonly T[]): T[] {
  const values = new Set(splitList(raw));
  // Ordem canônica (a da constante) para URLs estáveis; valores desconhecidos são ignorados.
  return known.filter((value) => values.has(value));
}

/**
 * Lê o filtro da query string (ex.: `Object.fromEntries(new URLSearchParams(search))`).
 * Valores separados por vírgula; desconhecidos e repetidos são ignorados.
 */
export function parseBoardFilter(
  params: Readonly<Record<string, string | null | undefined>>,
): BoardFilter {
  return {
    assigneeIds: splitList(params[BOARD_FILTER_PARAMS.assigneeIds]),
    labelIds: splitList(params[BOARD_FILTER_PARAMS.labelIds]),
    priorities: pickKnown(params[BOARD_FILTER_PARAMS.priorities], PRIORITY_FILTER_VALUES),
    due: pickKnown(params[BOARD_FILTER_PARAMS.due], DUE_FILTER_VALUES),
    text: (params[BOARD_FILTER_PARAMS.text] ?? '').trim(),
  };
}

/** Serializa o filtro para a query string, omitindo critérios vazios. */
export function boardFilterToParams(filter: BoardFilter): Record<string, string> {
  const params: Record<string, string> = {};
  const assignees = [...new Set(filter.assigneeIds)];
  const labels = [...new Set(filter.labelIds)];
  const priorities = PRIORITY_FILTER_VALUES.filter((value) => filter.priorities.includes(value));
  const due = DUE_FILTER_VALUES.filter((value) => filter.due.includes(value));
  const text = filter.text.trim();
  if (assignees.length > 0) params[BOARD_FILTER_PARAMS.assigneeIds] = assignees.join(',');
  if (labels.length > 0) params[BOARD_FILTER_PARAMS.labelIds] = labels.join(',');
  if (priorities.length > 0) params[BOARD_FILTER_PARAMS.priorities] = priorities.join(',');
  if (due.length > 0) params[BOARD_FILTER_PARAMS.due] = due.join(',');
  if (text !== '') params[BOARD_FILTER_PARAMS.text] = text;
  return params;
}
