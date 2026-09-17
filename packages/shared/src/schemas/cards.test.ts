import { describe, expect, it } from 'vitest';

import {
  ID,
  T0,
  activity,
  cardCover,
  cardDetail,
  cardSummary,
  issuePaths,
  label,
  lockedCard,
} from '../test-fixtures';
import { ACTIVITY_TYPES, activitiesResponseSchema, activitySchema } from './activity';
import type { ActivityEntry } from './activity';
import {
  boardCardSchema,
  cardAssigneeParamsSchema,
  cardAssigneesResponseSchema,
  cardCoverUploadUrlRequestSchema,
  cardDetailResponseSchema,
  cardMutationResultSchema,
  cardSummaryResponseSchema,
  cardViewerParamsSchema,
  cardViewersResponseSchema,
  confirmCardCoverRequestSchema,
  createCardRequestSchema,
  lockedCardSchema,
  moveCardRequestSchema,
  updateCardRequestSchema,
  updateCardVisibilityRequestSchema,
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

describe('cards restritos e capa (Fatia 11)', () => {
  const objectKey = `covers/${ID.card}/abcdefghijklmnopqrstuvwxyz012345`;

  it('BoardCard discrimina pelos dois valores de locked', () => {
    expect(boardCardSchema.parse(cardSummary)).toEqual(cardSummary);
    expect(boardCardSchema.parse(lockedCard)).toEqual(lockedCard);
    // Sem o discriminante não é nenhum dos dois formatos.
    const { locked: _locked, ...semDiscriminante } = cardSummary;
    expect(boardCardSchema.safeParse(semDiscriminante).success).toBe(false);
    expect(boardCardSchema.safeParse({ ...lockedCard, locked: false }).success).toBe(false);
  });

  it('LockedCard descarta qualquer campo além dos cinco declarados', () => {
    const vazando = {
      ...lockedCard,
      dueAt: T0,
      priority: 'urgent',
      labelIds: [ID.label],
      assigneeIds: [ID.user],
      cover: cardCover,
      description: 'segredo',
      boardId: ID.board,
    };
    const parsed = boardCardSchema.parse(vazando);
    expect(parsed).toEqual(lockedCard);
    expect(Object.keys(parsed).sort()).toEqual(['id', 'listId', 'locked', 'position', 'title']);
    expect(JSON.stringify(parsed)).not.toContain('segredo');
    expect(lockedCardSchema.parse(vazando)).toEqual(lockedCard);
  });

  it('face do card traz visibilidade e capa (null sem capa)', () => {
    expect(cardSummaryResponseSchema.parse({ card: cardSummary }).card.cover).toEqual(cardCover);
    const semCapa = { ...cardSummary, cover: null, visibility: 'restricted' } as const;
    expect(cardSummaryResponseSchema.parse({ card: semCapa }).card).toEqual(semCapa);
    expect(
      cardSummaryResponseSchema.safeParse({ card: { ...cardSummary, visibility: 'privado' } })
        .success,
    ).toBe(false);
  });

  it('detalhe traz viewerIds', () => {
    const restrito = { ...cardDetail, visibility: 'restricted', viewerIds: [ID.user, ID.user2] };
    expect(cardDetailResponseSchema.parse({ card: restrito }).card.viewerIds).toEqual([
      ID.user,
      ID.user2,
    ]);
    const { viewerIds: _viewerIds, ...semViewerIds } = cardDetail;
    expect(cardDetailResponseSchema.safeParse({ card: semViewerIds }).success).toBe(false);
  });

  it('visibilidade e viewers: corpo e resposta', () => {
    expect(updateCardVisibilityRequestSchema.parse({ visibility: 'team' })).toEqual({
      visibility: 'team',
    });
    expect(updateCardVisibilityRequestSchema.safeParse({ visibility: 'privado' }).success).toBe(
      false,
    );
    expect(cardViewerParamsSchema.parse({ cardId: ID.card, userId: ID.user })).toEqual({
      cardId: ID.card,
      userId: ID.user,
    });
    expect(issuePaths(cardViewerParamsSchema.safeParse({ cardId: ID.card, userId: 'x' }))).toEqual([
      'userId',
    ]);
    expect(cardViewersResponseSchema.parse({ viewerIds: [ID.user] })).toEqual({
      viewerIds: [ID.user],
    });
  });

  it('URL de upload: tipo na lista e tamanho de 1 a 5 MiB', () => {
    expect(
      cardCoverUploadUrlRequestSchema.parse({ contentType: 'image/avif', sizeBytes: 5_242_880 }),
    ).toEqual({ contentType: 'image/avif', sizeBytes: 5_242_880 });
    expect(
      issuePaths(
        cardCoverUploadUrlRequestSchema.safeParse({ contentType: 'image/gif', sizeBytes: 10 }),
      ),
    ).toEqual(['contentType']);
    expect(
      issuePaths(
        cardCoverUploadUrlRequestSchema.safeParse({
          contentType: 'image/png',
          sizeBytes: 5_242_881,
        }),
      ),
    ).toEqual(['sizeBytes']);
    expect(
      issuePaths(
        cardCoverUploadUrlRequestSchema.safeParse({ contentType: 'image/png', sizeBytes: 0 }),
      ),
    ).toEqual(['sizeBytes']);
  });

  it('confirmação: chave no formato de capa e dimensões opcionais', () => {
    expect(confirmCardCoverRequestSchema.parse({ objectKey })).toEqual({ objectKey });
    expect(confirmCardCoverRequestSchema.parse({ objectKey, width: 800, height: 600 })).toEqual({
      objectKey,
      width: 800,
      height: 600,
    });
    expect(issuePaths(confirmCardCoverRequestSchema.safeParse({ objectKey: 'covers/x' }))).toEqual([
      'objectKey',
    ]);
    expect(
      issuePaths(confirmCardCoverRequestSchema.safeParse({ objectKey, width: 20_001 })),
    ).toEqual(['width']);
    expect(issuePaths(confirmCardCoverRequestSchema.safeParse({ objectKey, height: 0 }))).toEqual([
      'height',
    ]);
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
  it('tem os 16 tipos de overview.md §5.3', () => {
    expect(ACTIVITY_TYPES).toHaveLength(16);
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
      { type: 'card_visibility_changed', data: { from: 'team', to: 'restricted' } },
      { type: 'card_viewer_added', data: { userId: ID.user2 } },
      { type: 'card_viewer_removed', data: { userId: ID.user2 } },
      { type: 'card_cover_changed', data: {} },
      { type: 'card_cover_removed', data: {} },
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
