import { describe, expect, it } from 'vitest';

import { ID, T0, activity, cardDetail, cardSummary, issuePaths, label } from '../test-fixtures';
import { ACTIVITY_TYPES, activitiesResponseSchema, activitySchema } from './activity';
import type { ActivityEntry } from './activity';
import {
  cardAssigneeParamsSchema,
  cardAssigneesResponseSchema,
  cardDetailResponseSchema,
  cardMutationResultSchema,
  cardSummaryResponseSchema,
  createCardRequestSchema,
  moveCardRequestSchema,
  updateCardRequestSchema,
} from './cards';
import {
  cardLabelParamsSchema,
  cardLabelsResponseSchema,
  createLabelRequestSchema,
  labelResponseSchema,
  updateLabelRequestSchema,
} from './labels';

describe('cards: entrada', () => {
  it('título: quebras de linha viram espaço, trim, 1 a 500', () => {
    expect(createCardRequestSchema.parse({ title: '  Linha 1\r\nLinha 2\nLinha 3\r' })).toEqual({
      title: 'Linha 1 Linha 2 Linha 3',
    });
    expect(issuePaths(createCardRequestSchema.safeParse({ title: '\n \r\n' }))).toEqual(['title']);
    expect(createCardRequestSchema.safeParse({ title: 'a'.repeat(500) }).success).toBe(true);
    expect(createCardRequestSchema.safeParse({ title: 'a'.repeat(501) }).success).toBe(false);
    expect(createCardRequestSchema.safeParse({}).error?.issues[0]?.message).toBe(
      'Título obrigatório',
    );
  });

  it('PATCH: ao menos um campo; due e priority aceitam null', () => {
    expect(updateCardRequestSchema.parse({ due: null })).toEqual({ due: null });
    expect(updateCardRequestSchema.parse({ priority: null })).toEqual({ priority: null });
    expect(updateCardRequestSchema.parse({ description: '' })).toEqual({ description: '' });
    expect(
      updateCardRequestSchema.parse({
        title: 'Novo',
        due: { date: '2026-09-20', time: '09:30' },
        priority: 'urgent',
      }),
    ).toEqual({ title: 'Novo', due: { date: '2026-09-20', time: '09:30' }, priority: 'urgent' });
    expect(updateCardRequestSchema.safeParse({}).success).toBe(false);
    expect(updateCardRequestSchema.safeParse({ status: 'completed' }).success).toBe(false);
  });

  it('PATCH: rejeita prazo inválido, prioridade desconhecida e descrição longa', () => {
    expect(
      issuePaths(updateCardRequestSchema.safeParse({ due: { date: '2026-02-30', time: null } })),
    ).toEqual(['due.date']);
    expect(
      issuePaths(updateCardRequestSchema.safeParse({ due: { date: '2026-09-20', time: '24:00' } })),
    ).toEqual(['due.time']);
    expect(issuePaths(updateCardRequestSchema.safeParse({ priority: 'none' }))).toEqual([
      'priority',
    ]);
    expect(updateCardRequestSchema.safeParse({ description: 'a'.repeat(20_000) }).success).toBe(
      true,
    );
    expect(
      issuePaths(updateCardRequestSchema.safeParse({ description: 'a'.repeat(20_001) })),
    ).toEqual(['description']);
  });

  it('mover: toListId e placement obrigatórios', () => {
    const body = { toListId: ID.list2, placement: { type: 'after', id: ID.card } };
    expect(moveCardRequestSchema.parse(body)).toEqual(body);
    expect(issuePaths(moveCardRequestSchema.safeParse({})).sort()).toEqual([
      'placement',
      'toListId',
    ]);
  });

  it('params compostos de responsável e etiqueta', () => {
    expect(cardAssigneeParamsSchema.parse({ cardId: ID.card, userId: ID.user })).toEqual({
      cardId: ID.card,
      userId: ID.user,
    });
    expect(issuePaths(cardLabelParamsSchema.safeParse({ cardId: ID.card, labelId: 'x' }))).toEqual([
      'labelId',
    ]);
  });
});

describe('cards: saída', () => {
  it('face e detalhe', () => {
    expect(cardSummaryResponseSchema.parse({ card: cardSummary })).toEqual({ card: cardSummary });
    expect(cardDetailResponseSchema.parse({ card: cardDetail })).toEqual({ card: cardDetail });
    // Face não serve como detalhe.
    expect(cardDetailResponseSchema.safeParse({ card: cardSummary }).success).toBe(false);
  });

  it('prioridade nula e concluído', () => {
    const completed = { ...cardSummary, priority: null, status: 'completed', completedAt: T0 };
    expect(cardSummaryResponseSchema.parse({ card: completed }).card).toEqual(completed);
  });

  it('resultado de mutação com completionChange e removedLabelIds', () => {
    for (const completionChange of ['completed', 'reopened', null] as const) {
      const body = { card: cardSummary, completionChange, removedLabelIds: [ID.label] };
      expect(cardMutationResultSchema.parse(body)).toEqual(body);
    }
    expect(
      cardMutationResultSchema.safeParse({
        card: cardSummary,
        completionChange: 'archived',
        removedLabelIds: [],
      }).success,
    ).toBe(false);
    expect(
      cardMutationResultSchema.safeParse({ card: cardSummary, completionChange: null }).success,
    ).toBe(false);
  });

  it('responsáveis e etiquetas do card', () => {
    expect(cardAssigneesResponseSchema.parse({ assigneeIds: [] })).toEqual({ assigneeIds: [] });
    expect(cardLabelsResponseSchema.parse({ labelIds: [ID.label] })).toEqual({
      labelIds: [ID.label],
    });
  });
});

describe('etiquetas', () => {
  it('criar exige nome (1–50) e cor da paleta', () => {
    expect(createLabelRequestSchema.parse({ name: ' Urgente ', color: 'red' })).toEqual({
      name: 'Urgente',
      color: 'red',
    });
    expect(
      issuePaths(createLabelRequestSchema.safeParse({ name: 'a'.repeat(51), color: 'red' })),
    ).toEqual(['name']);
    expect(issuePaths(createLabelRequestSchema.safeParse({ name: 'X' }))).toEqual(['color']);
  });

  it('editar: ao menos um campo', () => {
    expect(updateLabelRequestSchema.parse({ color: 'purple' })).toEqual({ color: 'purple' });
    expect(updateLabelRequestSchema.safeParse({}).success).toBe(false);
    expect(labelResponseSchema.parse({ label })).toEqual({ label });
  });
});

describe('atividade', () => {
  it('tem os 11 tipos de overview.md §5.3', () => {
    expect(ACTIVITY_TYPES).toHaveLength(11);
    expect(activitySchema.options).toHaveLength(ACTIVITY_TYPES.length);
  });

  it('aceita cada tipo com seu data', () => {
    const base = { id: ID.activity, cardId: ID.card, actorId: ID.user, createdAt: T0 };
    const entries: ActivityEntry[] = [
      { type: 'card_created', data: { listId: ID.list, listName: 'A fazer' } },
      { type: 'card_title_changed', data: { from: 'a', to: 'b' } },
      activity,
      { type: 'card_assignee_added', data: { userId: ID.user2 } },
      { type: 'card_assignee_removed', data: { userId: ID.user2 } },
      { type: 'card_due_changed', data: { from: null, to: T0, hasTime: true } },
      { type: 'card_priority_changed', data: { from: null, to: 'urgent' } },
      { type: 'card_completed', data: {} },
      { type: 'card_reopened', data: {} },
      { type: 'card_archived', data: {} },
      { type: 'card_restored', data: {} },
    ];
    const activities = entries.map((entry) => ({ ...base, type: entry.type, data: entry.data }));
    expect(activitiesResponseSchema.parse({ activities })).toEqual({ activities });
    expect(new Set(activities.map((item) => item.type)).size).toBe(ACTIVITY_TYPES.length);
  });

  it('rejeita data incompatível com o tipo e tipo desconhecido', () => {
    const base = { id: ID.activity, cardId: ID.card, actorId: ID.user, createdAt: T0 };
    expect(
      activitySchema.safeParse({ ...base, type: 'card_created', data: { from: 'a', to: 'b' } })
        .success,
    ).toBe(false);
    expect(
      activitySchema.safeParse({
        ...base,
        type: 'card_priority_changed',
        data: { from: 'none', to: null },
      }).success,
    ).toBe(false);
    expect(activitySchema.safeParse({ ...base, type: 'xp_granted', data: {} }).success).toBe(false);
  });

  it('ActivityEntry impede data fora do tipo (checagem de tipo)', () => {
    const wrong: ActivityEntry = {
      type: 'card_title_changed',
      // @ts-expect-error data de card_created não serve para card_title_changed
      data: { listId: ID.list, listName: 'x' },
    };
    expect(wrong.type).toBe('card_title_changed');
  });
});
