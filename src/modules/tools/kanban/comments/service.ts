import type { Comment, Role } from '@raphasparda/ronin-shared';

import type { Database, DbExecutor } from '../../../../db/client';
import type { CommentRow } from '../../../../db/schema';
import { AppError } from '../../../../lib/app-error';
import { toIso, toIsoOrNull } from '../../../../lib/dates';
import type { BoardActor } from '../boards/access';
import { assertBoardWritable, cardTransaction, lockCard } from '../cards/service';
import { onCommented } from '../../../platform/notifications/hooks';

import {
  deleteCommentById,
  findCommentById,
  insertComment,
  lockCommentById,
  updateCommentById,
} from './repository';

export const COMMENT_NOT_FOUND_MESSAGE = 'Comentário não encontrado.';
export const COMMENT_EDIT_FORBIDDEN_MESSAGE = 'Só quem escreveu o comentário pode editá-lo.';
export const COMMENT_DELETE_FORBIDDEN_MESSAGE =
  'Só quem escreveu o comentário ou um Admin pode excluí-lo.';

/** Quem executa a ação e quando. */
export interface CommentActionContext {
  actor: { id: string; role: Role };
  now: Date;
}

export function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    cardId: row.cardId,
    authorId: row.authorId,
    body: row.body,
    editedAt: toIsoOrNull(row.editedAt),
    createdAt: toIso(row.createdAt),
  };
}

function notFound(): AppError {
  return new AppError('NOT_FOUND', COMMENT_NOT_FOUND_MESSAGE);
}

/**
 * Comentário para mutação. Ordem (api.md §3): 404 → 403 (`canWrite`) → `409 BOARD_ARCHIVED`.
 * Locks: quadro `FOR SHARE` → card `FOR UPDATE` → comentário `FOR UPDATE`.
 */
async function lockCommentForWrite(
  tx: DbExecutor,
  actor: BoardActor,
  commentId: string,
  canWrite: (comment: CommentRow) => boolean,
  forbiddenMessage: string,
): Promise<CommentRow> {
  const found = await findCommentById(tx, commentId);
  if (!found) throw notFound();
  const { card, boards } = await lockCard(tx, found.cardId, { actor, lockLists: false });
  const comment = await lockCommentById(tx, commentId);
  if (!comment) throw notFound();
  if (!canWrite(comment)) throw new AppError('FORBIDDEN', forbiddenMessage);
  assertBoardWritable(boards.get(card.boardId));
  return comment;
}

/**
 * `POST /api/cards/:cardId/comments { body }` (Markdown guardado como texto, ADR 0007).
 * Ordem: 404 → `409 BOARD_ARCHIVED`. Card arquivado é aceito. Chama o gancho `onCommented`
 * (notificação dos responsáveis na Fatia 7).
 */
export async function createComment(
  db: Database,
  ctx: CommentActionContext,
  cardId: string,
  body: string,
): Promise<Comment> {
  return cardTransaction(db, async (tx) => {
    const { card, boards } = await lockCard(tx, cardId, { actor: ctx.actor, lockLists: false });
    assertBoardWritable(boards.get(card.boardId));
    const row = await insertComment(tx, {
      cardId: card.id,
      authorId: ctx.actor.id,
      body,
      createdAt: ctx.now,
    });
    await onCommented(tx, {
      cardId: card.id,
      commentId: row.id,
      actorId: ctx.actor.id,
      now: ctx.now,
    });
    return toComment(row);
  });
}

/**
 * `PATCH /api/comments/:commentId { body }`: só o autor (Admin também recebe `403`). Grava
 * `editedAt`; corpo igual ao atual → 200 sem gravar.
 */
export async function editComment(
  db: Database,
  ctx: CommentActionContext,
  commentId: string,
  body: string,
): Promise<Comment> {
  return cardTransaction(db, async (tx) => {
    const comment = await lockCommentForWrite(
      tx,
      ctx.actor,
      commentId,
      (row) => row.authorId === ctx.actor.id,
      COMMENT_EDIT_FORBIDDEN_MESSAGE,
    );
    if (comment.body === body) return toComment(comment);
    return toComment(await updateCommentById(tx, comment.id, { body, editedAt: ctx.now }));
  });
}

/** `DELETE /api/comments/:commentId`: autor ou Admin. */
export async function deleteComment(
  db: Database,
  ctx: CommentActionContext,
  commentId: string,
): Promise<void> {
  await cardTransaction(db, async (tx) => {
    const comment = await lockCommentForWrite(
      tx,
      ctx.actor,
      commentId,
      (row) => row.authorId === ctx.actor.id || ctx.actor.role === 'admin',
      COMMENT_DELETE_FORBIDDEN_MESSAGE,
    );
    await deleteCommentById(tx, comment.id);
  });
}
