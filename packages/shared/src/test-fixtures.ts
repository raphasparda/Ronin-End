/**
 * Exemplos válidos de respostas (só para testes; não exportado pelo barrel).
 * Servem também de referência para handlers MSW.
 */
import type { Activity } from './schemas/activity';
import type { Invite } from './schemas/admin';
import type { Board } from './schemas/boards';
import type { CardDetail, CardSummary } from './schemas/cards';
import type { Checklist } from './schemas/checklists';
import type { Comment } from './schemas/comments';
import type { Label } from './schemas/labels';
import type { List } from './schemas/lists';
import type { Notification } from './schemas/notifications';
import type { AdminUser, UserSummary } from './schemas/users';

export const ID = {
  user: '3f1c2b1e-8a4d-4c3b-9f2e-1a2b3c4d5e6f',
  user2: '0b6f2d4c-1e3a-4b5c-8d7e-9f0a1b2c3d4e',
  board: '6d3f1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b',
  board2: '7e4a2b3c-5d6e-4f7a-9b0c-1d2e3f4a5b6c',
  list: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  list2: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
  card: '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  label: '4d5e6f7a-8b9c-4d0e-8f1a-2b3c4d5e6f7a',
  checklist: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b',
  item: '6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f7a8b9c',
  comment: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d',
  invite: '8b9c0d1e-2f3a-4b4c-9d5e-6f7a8b9c0d1e',
  notification: '9c0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f',
  activity: 'a0d1e2f3-4b5c-4d6e-9f7a-8b9c0d1e2f3a',
} as const;

export const T0 = '2026-09-16T14:03:00.000Z';
export const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123-_Z';

export const userSummary: UserSummary = {
  id: ID.user,
  name: 'Ana Souza',
  role: 'admin',
  status: 'active',
  anonymized: false,
};

export const adminUser: AdminUser = { ...userSummary, email: 'ana@exemplo.com', createdAt: T0 };

export const invite: Invite = {
  id: ID.invite,
  email: null,
  role: 'member',
  createdBy: ID.user,
  createdAt: T0,
  expiresAt: '2026-09-23T14:03:00.000Z',
  state: 'pending',
  usedByUserId: null,
};

export const board: Board = {
  id: ID.board,
  name: 'Marketing',
  archivedAt: null,
  createdAt: T0,
  updatedAt: T0,
};

export const list: List = {
  id: ID.list,
  boardId: ID.board,
  name: 'A fazer',
  position: 'a0',
  isDoneList: false,
  color: 'blue',
  archivedAt: null,
};

export const label: Label = { id: ID.label, boardId: ID.board, name: 'Financeiro', color: 'green' };

export const cardSummary: CardSummary = {
  id: ID.card,
  boardId: ID.board,
  listId: ID.list,
  title: 'Revisar orçamento',
  position: 'a0',
  status: 'open',
  completedAt: null,
  dueAt: '2026-09-21T02:59:59.999Z',
  dueHasTime: false,
  priority: 'high',
  labelIds: [ID.label],
  assigneeIds: [ID.user],
  checklist: { done: 1, total: 2 },
  commentCount: 1,
  hasDescription: true,
  archivedAt: null,
};

export const checklist: Checklist = {
  id: ID.checklist,
  cardId: ID.card,
  title: 'Checklist',
  createdAt: T0,
  items: [
    {
      id: ID.item,
      checklistId: ID.checklist,
      text: 'Levantar custos',
      position: 'a0',
      isChecked: true,
      checkedBy: ID.user,
      checkedAt: T0,
    },
  ],
};

export const comment: Comment = {
  id: ID.comment,
  cardId: ID.card,
  authorId: ID.user,
  body: '**Ok**',
  editedAt: null,
  createdAt: T0,
};

export const cardDetail: CardDetail = {
  ...cardSummary,
  description: '# Contexto',
  completedBy: null,
  createdBy: ID.user,
  createdAt: T0,
  updatedAt: T0,
  board: { id: ID.board, name: 'Marketing', archived: false },
  list: { id: ID.list, name: 'A fazer', color: 'blue', isDoneList: false, archived: false },
  checklists: [checklist],
  comments: [comment],
};

export const activity: Activity = {
  id: ID.activity,
  cardId: ID.card,
  actorId: ID.user,
  createdAt: T0,
  type: 'card_moved',
  data: {
    fromListId: ID.list,
    fromListName: 'A fazer',
    toListId: ID.list2,
    toListName: 'Fazendo',
    fromBoardId: ID.board,
    fromBoardName: 'Marketing',
    toBoardId: ID.board2,
    toBoardName: 'Vendas',
  },
};

export const notification: Notification = {
  id: ID.notification,
  type: 'card_commented',
  actorId: ID.user2,
  card: { id: ID.card, title: 'Revisar orçamento', boardId: ID.board, boardName: 'Marketing' },
  commentId: ID.comment,
  readAt: null,
  createdAt: T0,
};

export function issuePaths(result: {
  error?: { issues: { path: PropertyKey[] }[] } | undefined;
}): string[] {
  return (result.error?.issues ?? []).map((issue) => issue.path.join('.'));
}
