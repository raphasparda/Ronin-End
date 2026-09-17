/**
 * Inserções mínimas para os testes de schema (`src/db/schema/*.test.ts`). Não é usado em runtime.
 * Factories de domínio para testes de rota ficam em `apps/api/test/`.
 */
import { randomUUID } from 'node:crypto';

import type { Database } from './client';
import {
  boards,
  cards,
  checklists,
  comments,
  labels,
  lists,
  users,
  type BoardRow,
  type CardRow,
  type ChecklistRow,
  type CommentRow,
  type LabelRow,
  type ListRow,
  type NewBoardRow,
  type NewCardRow,
  type NewListRow,
  type NewUserRow,
  type UserRow,
} from './schema';

function one<T>(rows: T[]): T {
  const [row] = rows;
  if (!row) throw new Error('insert não retornou linha');
  return row;
}

export async function insertUser(
  db: Database,
  overrides: Partial<NewUserRow> = {},
): Promise<UserRow> {
  const suffix = randomUUID().slice(0, 8);
  return one(
    await db
      .insert(users)
      .values({
        email: `user-${suffix}@exemplo.com`,
        name: `Usuário ${suffix}`,
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fake$fake',
        role: 'member',
        ...overrides,
      })
      .returning(),
  );
}

export async function insertBoard(
  db: Database,
  createdBy: string,
  overrides: Partial<NewBoardRow> = {},
): Promise<BoardRow> {
  return one(
    await db
      .insert(boards)
      .values({ name: 'Quadro', createdBy, ...overrides })
      .returning(),
  );
}

export async function insertList(
  db: Database,
  boardId: string,
  overrides: Partial<NewListRow> = {},
): Promise<ListRow> {
  return one(
    await db
      .insert(lists)
      .values({ boardId, name: 'Lista', position: 'a0', color: 'blue', ...overrides })
      .returning(),
  );
}

export async function insertCard(
  db: Database,
  list: Pick<ListRow, 'id' | 'boardId'>,
  createdBy: string,
  overrides: Partial<NewCardRow> = {},
): Promise<CardRow> {
  return one(
    await db
      .insert(cards)
      .values({
        boardId: list.boardId,
        listId: list.id,
        title: 'Card',
        position: 'a0',
        createdBy,
        ...overrides,
      })
      .returning(),
  );
}

export async function insertLabel(db: Database, boardId: string): Promise<LabelRow> {
  return one(await db.insert(labels).values({ boardId, name: 'Bug', color: 'red' }).returning());
}

export async function insertChecklist(db: Database, cardId: string): Promise<ChecklistRow> {
  return one(await db.insert(checklists).values({ cardId, title: 'Tarefas' }).returning());
}

export async function insertComment(
  db: Database,
  cardId: string,
  authorId: string,
): Promise<CommentRow> {
  return one(await db.insert(comments).values({ cardId, authorId, body: 'Olá' }).returning());
}

/** Usuário, quadro, lista e card prontos para testes de tabelas filhas do card. */
export async function insertCardGraph(db: Database): Promise<{
  user: UserRow;
  board: BoardRow;
  list: ListRow;
  card: CardRow;
}> {
  const user = await insertUser(db);
  const board = await insertBoard(db, user.id);
  const list = await insertList(db, board.id);
  const card = await insertCard(db, list, user.id);
  return { user, board, list, card };
}
