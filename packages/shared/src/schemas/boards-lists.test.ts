import { describe, expect, it } from 'vitest';

import {
  ID,
  T0,
  board,
  boardCover,
  boardDetail,
  cardSummary,
  issuePaths,
  label,
  list,
  lockedBoard,
} from '../test-fixtures';
import {
  archivedCardSchema,
  boardArchivedResponseSchema,
  boardCoverUploadUrlRequestSchema,
  boardIdParamsSchema,
  boardListItemSchema,
  boardPayloadSchema,
  boardResponseSchema,
  boardViewerParamsSchema,
  boardViewersResponseSchema,
  boardsQuerySchema,
  boardsResponseSchema,
  confirmBoardCoverRequestSchema,
  createBoardRequestSchema,
  createBoardResponseSchema,
  deleteBoardRequestSchema,
  lockedBoardSchema,
  updateBoardRequestSchema,
  updateBoardVisibilityRequestSchema,
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
    expect(createBoardResponseSchema.parse({ board: boardDetail, lists: [list] })).toEqual({
      board: boardDetail,
      lists: [list],
    });
    expect(boardResponseSchema.parse({ board: boardDetail })).toEqual({ board: boardDetail });
  });

  it('payload do quadro com listas, cards e etiquetas', () => {
    const payload = { board: boardDetail, lists: [list], cards: [cardSummary], labels: [label] };
    expect(boardPayloadSchema.parse(payload)).toEqual(payload);
    expect(boardPayloadSchema.parse({ ...payload, cards: [], labels: [] }).cards).toEqual([]);
    expect(boardPayloadSchema.safeParse({ board: boardDetail, lists: [list] }).success).toBe(false);
    // Sem `viewerIds` não é o quadro aberto (o payload é sempre de quem tem acesso).
    expect(boardPayloadSchema.safeParse({ ...payload, board }).success).toBe(false);
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

describe('quadros restritos e capa (Fatia 11)', () => {
  const objectKey = `covers/${ID.board}/abcdefghijklmnopqrstuvwxyz012345`;

  it('BoardListItem discrimina pelos dois valores de locked', () => {
    expect(boardListItemSchema.parse(board)).toEqual(board);
    expect(boardListItemSchema.parse(lockedBoard)).toEqual(lockedBoard);
    const { locked: _locked, ...semDiscriminante } = board;
    expect(boardListItemSchema.safeParse(semDiscriminante).success).toBe(false);
    expect(boardListItemSchema.safeParse({ ...lockedBoard, locked: false }).success).toBe(false);
  });

  it('LockedBoard descarta qualquer campo além dos três declarados', () => {
    const vazando = {
      ...lockedBoard,
      visibility: 'restricted',
      cover: boardCover,
      archivedAt: null,
      createdAt: T0,
      updatedAt: T0,
      viewerIds: [ID.user],
    };
    const parsed = boardListItemSchema.parse(vazando);
    expect(parsed).toEqual(lockedBoard);
    expect(Object.keys(parsed).sort()).toEqual(['id', 'locked', 'name']);
    expect(lockedBoardSchema.parse(vazando)).toEqual(lockedBoard);
  });

  it('quadro aberto traz visibilidade e capa (null sem capa)', () => {
    expect(boardsResponseSchema.parse({ boards: [board] }).boards[0]).toEqual(board);
    const semCapa = { ...board, cover: null, visibility: 'restricted' } as const;
    expect(boardListItemSchema.parse(semCapa)).toEqual(semCapa);
    expect(boardListItemSchema.safeParse({ ...board, visibility: 'privado' }).success).toBe(false);
  });

  it('visibilidade e viewers: corpo, parâmetros e resposta', () => {
    expect(updateBoardVisibilityRequestSchema.parse({ visibility: 'team' })).toEqual({
      visibility: 'team',
    });
    expect(updateBoardVisibilityRequestSchema.safeParse({ visibility: 'privado' }).success).toBe(
      false,
    );
    expect(boardViewerParamsSchema.parse({ boardId: ID.board, userId: ID.user })).toEqual({
      boardId: ID.board,
      userId: ID.user,
    });
    expect(
      issuePaths(boardViewerParamsSchema.safeParse({ boardId: ID.board, userId: 'x' })),
    ).toEqual(['userId']);
    expect(boardViewersResponseSchema.parse({ viewerIds: [ID.user] })).toEqual({
      viewerIds: [ID.user],
    });
  });

  it('URL de upload: tipo na lista e tamanho de 1 a 5 MiB', () => {
    expect(
      boardCoverUploadUrlRequestSchema.parse({ contentType: 'image/avif', sizeBytes: 5_242_880 }),
    ).toEqual({ contentType: 'image/avif', sizeBytes: 5_242_880 });
    expect(
      issuePaths(
        boardCoverUploadUrlRequestSchema.safeParse({ contentType: 'image/gif', sizeBytes: 10 }),
      ),
    ).toEqual(['contentType']);
    expect(
      issuePaths(
        boardCoverUploadUrlRequestSchema.safeParse({
          contentType: 'image/png',
          sizeBytes: 5_242_881,
        }),
      ),
    ).toEqual(['sizeBytes']);
    expect(
      issuePaths(
        boardCoverUploadUrlRequestSchema.safeParse({ contentType: 'image/png', sizeBytes: 0 }),
      ),
    ).toEqual(['sizeBytes']);
  });

  it('confirmação: chave no formato de capa e dimensões opcionais', () => {
    expect(confirmBoardCoverRequestSchema.parse({ objectKey })).toEqual({ objectKey });
    expect(confirmBoardCoverRequestSchema.parse({ objectKey, width: 800, height: 600 })).toEqual({
      objectKey,
      width: 800,
      height: 600,
    });
    expect(issuePaths(confirmBoardCoverRequestSchema.safeParse({ objectKey: 'covers/x' }))).toEqual(
      ['objectKey'],
    );
    expect(
      issuePaths(confirmBoardCoverRequestSchema.safeParse({ objectKey, width: 20_001 })),
    ).toEqual(['width']);
    expect(issuePaths(confirmBoardCoverRequestSchema.safeParse({ objectKey, height: 0 }))).toEqual([
      'height',
    ]);
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
