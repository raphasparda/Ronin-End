import { describe, expect, it } from 'vitest';

import { ID, T0, checklist, comment, issuePaths, notification } from '../../../test-fixtures';
import {
  checklistItemResponseSchema,
  checklistResponseSchema,
  createChecklistItemRequestSchema,
  createChecklistRequestSchema,
  moveChecklistItemRequestSchema,
  updateChecklistItemRequestSchema,
  updateChecklistRequestSchema,
} from './checklists';
import {
  commentIdParamsSchema,
  commentResponseSchema,
  createCommentRequestSchema,
  updateCommentRequestSchema,
} from './comments';
import {
  notificationIdParamsSchema,
  notificationsQuerySchema,
  notificationsResponseSchema,
  unreadCountResponseSchema,
} from '../../../platform/schemas/notifications';

describe('checklists', () => {
  it('título 1–200 com trim', () => {
    expect(createChecklistRequestSchema.parse({ title: ' Checklist ' })).toEqual({
      title: 'Checklist',
    });
    expect(issuePaths(updateChecklistRequestSchema.safeParse({ title: 'a'.repeat(201) }))).toEqual([
      'title',
    ]);
    expect(checklistResponseSchema.parse({ checklist })).toEqual({ checklist });
  });

  it('item: texto 1–500; PATCH com ao menos um campo', () => {
    expect(createChecklistItemRequestSchema.parse({ text: ' Passo ' })).toEqual({ text: 'Passo' });
    expect(issuePaths(createChecklistItemRequestSchema.safeParse({ text: '' }))).toEqual(['text']);
    expect(updateChecklistItemRequestSchema.parse({ isChecked: false })).toEqual({
      isChecked: false,
    });
    expect(updateChecklistItemRequestSchema.safeParse({}).success).toBe(false);
    expect(issuePaths(updateChecklistItemRequestSchema.safeParse({ isChecked: 1 }))).toEqual([
      'isChecked',
    ]);
  });

  it('mover item e resposta { item }', () => {
    expect(moveChecklistItemRequestSchema.safeParse({ placement: { type: 'end' } }).success).toBe(
      true,
    );
    const item = checklist.items[0];
    expect(checklistItemResponseSchema.parse({ item })).toEqual({ item });
    expect(
      checklistItemResponseSchema.safeParse({ item: { ...item, checkedBy: 'alguém' } }).success,
    ).toBe(false);
  });
});

describe('comentários', () => {
  it('corpo 1–10.000 com trim', () => {
    expect(createCommentRequestSchema.parse({ body: '  Olá  ' })).toEqual({ body: 'Olá' });
    expect(updateCommentRequestSchema.safeParse({ body: 'a'.repeat(10_000) }).success).toBe(true);
    expect(issuePaths(updateCommentRequestSchema.safeParse({ body: 'a'.repeat(10_001) }))).toEqual([
      'body',
    ]);
    expect(createCommentRequestSchema.safeParse({ body: ' ' }).error?.issues[0]?.message).toBe(
      'Comentário vazio',
    );
  });

  it('resposta e params', () => {
    const edited = { ...comment, editedAt: T0 };
    expect(commentResponseSchema.parse({ comment: edited })).toEqual({ comment: edited });
    expect(commentIdParamsSchema.safeParse({ commentId: ID.comment }).success).toBe(true);
  });
});

describe('notificações', () => {
  it('query: limit padrão 30, 1–100, before ISO opcional', () => {
    expect(notificationsQuerySchema.parse({})).toEqual({ limit: 30 });
    expect(notificationsQuerySchema.parse({ limit: '100', before: T0 })).toEqual({
      limit: 100,
      before: T0,
    });
    expect(issuePaths(notificationsQuerySchema.safeParse({ limit: '0' }))).toEqual(['limit']);
    expect(issuePaths(notificationsQuerySchema.safeParse({ limit: '101' }))).toEqual(['limit']);
    expect(issuePaths(notificationsQuerySchema.safeParse({ limit: '2.5' }))).toEqual(['limit']);
    expect(issuePaths(notificationsQuerySchema.safeParse({ limit: 'dez' }))).toEqual(['limit']);
    expect(issuePaths(notificationsQuerySchema.safeParse({ before: 'ontem' }))).toEqual(['before']);
  });

  it('listagem, contador e params', () => {
    const body = { notifications: [notification], unreadCount: 1, nextBefore: T0 };
    expect(notificationsResponseSchema.parse(body)).toEqual(body);
    const assigned = { ...notification, type: 'card_assigned', commentId: null, readAt: T0 };
    expect(
      notificationsResponseSchema.parse({
        notifications: [assigned],
        unreadCount: 0,
        nextBefore: null,
      }).notifications[0],
    ).toEqual(assigned);
    expect(unreadCountResponseSchema.safeParse({ unreadCount: -1 }).success).toBe(false);
    expect(notificationIdParamsSchema.safeParse({ notificationId: 'x' }).success).toBe(false);
    expect(
      notificationsResponseSchema.safeParse({
        notifications: [{ ...notification, type: 'card_due_soon' }],
        unreadCount: 0,
        nextBefore: null,
      }).success,
    ).toBe(false);
  });
});
