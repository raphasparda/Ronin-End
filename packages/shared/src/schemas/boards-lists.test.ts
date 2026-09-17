import { describe, expect, it } from 'vitest';

import { ID, board, cardSummary, issuePaths, label, list } from '../test-fixtures';
import {
  archivedCardSchema,
  boardArchivedResponseSchema,
  boardIdParamsSchema,
  boardPayloadSchema,
  boardsQuerySchema,
  boardsResponseSchema,
  createBoardRequestSchema,
  createBoardResponseSchema,
  deleteBoardRequestSchema,
  updateBoardRequestSchema,
} from './boards';
import {
  createListRequestSchema,
  listSchema,
  moveListRequestSchema,
  updateListRequestSchema,
  updateListResponseSchema,
} from './lists';

describe('quadros', () => {
  it('nome: trim e 1 a 100', () => {
    expect(createBoardRequestSchema.parse({ name: ' Marketing ' })).toEqual({ name: 'Marketing' });
    expect(issuePaths(createBoardRequestSchema.safeParse({ name: ' ' }))).toEqual(['name']);
    expect(updateBoardRequestSchema.safeParse({ name: 'a'.repeat(100) }).success).toBe(true);
    const tooLong = updateBoardRequestSchema.safeParse({ name: 'a'.repeat(101) });
    expect(tooLong.error?.issues[0]?.message).toBe(
      'O nome do quadro pode ter no máximo 100 caracteres',
    );
  });

  it('?archived: padrão false, só "true"/"false"', () => {
    expect(boardsQuerySchema.parse({})).toEqual({ archived: false });
    expect(boardsQuerySchema.parse({ archived: 'true' })).toEqual({ archived: true });
    expect(boardsQuerySchema.parse({ archived: 'false' })).toEqual({ archived: false });
    expect(issuePaths(boardsQuerySchema.safeParse({ archived: '1' }))).toEqual(['archived']);
    expect(boardsQuerySchema.safeParse({ archived: 'yes' }).success).toBe(false);
  });

  it('params e respostas simples', () => {
    expect(boardIdParamsSchema.safeParse({ boardId: 'abc' }).success).toBe(false);
    expect(boardsResponseSchema.parse({ boards: [board] })).toEqual({ boards: [board] });
    expect(createBoardResponseSchema.parse({ board, lists: [list] })).toEqual({
      board,
      lists: [list],
    });
  });

  it('payload do quadro com listas, cards e etiquetas', () => {
    const payload = { board, lists: [list], cards: [cardSummary], labels: [label] };
    expect(boardPayloadSchema.parse(payload)).toEqual(payload);
    expect(boardPayloadSchema.parse({ ...payload, cards: [], labels: [] }).cards).toEqual([]);
    expect(boardPayloadSchema.safeParse({ board, lists: [list] }).success).toBe(false);
  });

  it('excluir: confirmName com trim, obrigatório', () => {
    expect(deleteBoardRequestSchema.parse({ confirmName: ' Marketing ' })).toEqual({
      confirmName: 'Marketing',
    });
    expect(deleteBoardRequestSchema.safeParse({ confirmName: '' }).error?.issues[0]?.message).toBe(
      'Digite o nome do quadro para confirmar',
    );
  });

  it('arquivados: listas e cards com contexto da lista', () => {
    const archivedCard = { ...cardSummary, listName: 'A fazer', listArchived: true };
    expect(archivedCardSchema.parse(archivedCard)).toEqual(archivedCard);
    expect(boardArchivedResponseSchema.parse({ lists: [list], cards: [archivedCard] })).toEqual({
      lists: [list],
      cards: [archivedCard],
    });
    expect(boardArchivedResponseSchema.safeParse({ lists: [], cards: [cardSummary] }).success).toBe(
      false,
    );
  });
});

describe('listas', () => {
  it('lista tem cor da paleta', () => {
    expect(listSchema.parse(list)).toEqual(list);
    expect(listSchema.safeParse({ ...list, color: '#00ff00' }).success).toBe(false);
  });

  it('criar: cor opcional, placement padrão end', () => {
    expect(createListRequestSchema.parse({ name: ' Revisão ' })).toEqual({
      name: 'Revisão',
      placement: { type: 'end' },
    });
    expect(
      createListRequestSchema.parse({
        name: 'Revisão',
        color: 'magenta',
        placement: { type: 'after', id: ID.list },
      }),
    ).toEqual({ name: 'Revisão', color: 'magenta', placement: { type: 'after', id: ID.list } });
    expect(issuePaths(createListRequestSchema.safeParse({ name: 'x', color: 'pink' }))).toEqual([
      'color',
    ]);
  });

  it('PATCH: ao menos um de nome, isDoneList, color', () => {
    expect(updateListRequestSchema.parse({ isDoneList: true })).toEqual({ isDoneList: true });
    expect(updateListRequestSchema.parse({ color: 'cyan' })).toEqual({ color: 'cyan' });
    expect(updateListRequestSchema.safeParse({}).success).toBe(false);
    expect(updateListRequestSchema.safeParse({ isDoneList: 'sim' }).success).toBe(false);
    expect(issuePaths(updateListRequestSchema.safeParse({ color: 'rosa' }))).toEqual(['color']);
  });

  it('PATCH → todas as listas e completedCardIds', () => {
    const body = { lists: [list], completedCardIds: [ID.card] };
    expect(updateListResponseSchema.parse(body)).toEqual(body);
    expect(updateListResponseSchema.safeParse({ lists: [list] }).success).toBe(false);
  });

  it('mover exige placement', () => {
    expect(moveListRequestSchema.parse({ placement: { type: 'start' } })).toEqual({
      placement: { type: 'start' },
    });
    expect(issuePaths(moveListRequestSchema.safeParse({}))).toEqual(['placement']);
  });
});
