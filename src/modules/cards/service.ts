import {
  completeTargetListId,
  completionChangeOnMove,
  completionChangeOnRestore,
  reopenTargetListId,
  type Activity,
  type BoardArchivedCard,
  type BoardCard,
  type CardDetail,
  type CardMutationResult,
  type CardSummary,
  type Checklist,
  type CompletionChange,
  type Comment,
  type LockedCard,
  type MoveCardRequest,
  type MyCard,
  type UpdateCardRequest,
} from '@raphasparda/ronin-shared';

import type { Database, DbExecutor } from '../../db/client';
import type { BoardRow, CardRow, ListRow } from '../../db/schema';
import { AppError } from '../../lib/app-error';
import { toIso, toIsoOrNull } from '../../lib/dates';
import { CARD_SIBLINGS, computePosition } from '../../lib/ordering';
import { dueInputToUtc } from '../../lib/time';
import { FORBIDDEN_MESSAGE } from '../../plugins/session';
import { listCardActivities, recordActivity } from '../activity/service';
import { findBoardById, lockBoardsShared } from '../boards/repository';
import { applyCompletionChange } from '../completion/service';
import { findActiveLists, findListById, lockListById, lockListsByIds } from '../lists/repository';
import { onAssigned } from '../notifications/hooks';
import { findUserById, lockUserShared } from '../users/repository';
import { USER_NOT_FOUND_MESSAGE } from '../users/service';
import { getWorkspace } from '../workspace/service';

import { assertCardAccess, cardRestricted, type CardActor } from './access';
import {
  deleteCardAssignee,
  deleteCardById,
  deleteForeignCardLabels,
  findCardAssigneeIds,
  findCardAssigneePairs,
  findCardById,
  findCardChecklists,
  findCardComments,
  findCardLabelPairs,
  findCardSummaryRows,
  findCardViewerIds,
  insertCardAssignee,
  insertCardRow,
  lockCardById,
  updateCardById,
  type CardSummaryRow,
  type CardSummaryScope,
} from './repository';

export const CARD_NOT_FOUND_MESSAGE = 'Card não encontrado.';
export const LIST_NOT_FOUND_MESSAGE = 'Lista não encontrada.';
export const CARD_BOARD_ARCHIVED_MESSAGE = 'Este quadro está arquivado (somente leitura).';
export const CARD_LIST_ARCHIVED_MESSAGE = 'Esta lista está arquivada.';
export const LIST_IS_DONE_LIST_MESSAGE =
  'Não é possível criar card direto na lista de conclusão. Crie em outra lista e mova para cá.';
export const CARD_ARCHIVED_MOVE_MESSAGE = 'Este card está arquivado. Restaure-o antes de mover.';
export const CARD_ARCHIVED_COMPLETION_MESSAGE =
  'Este card está arquivado. Restaure-o antes de concluir ou reabrir.';
export const USER_NOT_ACTIVE_ASSIGN_MESSAGE =
  'Esta pessoa está desativada e não pode ser atribuída ao card.';

/** Contexto de quem executa a ação (o papel entra na checagem de acesso, ADR 0015). */
export interface CardActionContext {
  actor: CardActor;
  now: Date;
}

// ---------------------------------------------------------------------------
// Leitura (faces e detalhe)
// ---------------------------------------------------------------------------

function groupBy<T>(pairs: T[], key: (pair: T) => string, value: (pair: T) => string) {
  const map = new Map<string, string[]>();
  for (const pair of pairs) {
    const k = key(pair);
    const list = map.get(k);
    if (list) list.push(value(pair));
    else map.set(k, [value(pair)]);
  }
  return map;
}

function toCardSummary(
  row: CardSummaryRow,
  labelIds: Map<string, string[]>,
  assigneeIds: Map<string, string[]>,
): CardSummary {
  return {
    locked: false,
    id: row.id,
    boardId: row.boardId,
    listId: row.listId,
    title: row.title,
    position: row.position,
    status: row.status,
    completedAt: toIsoOrNull(row.completedAt),
    dueAt: toIsoOrNull(row.dueAt),
    dueHasTime: row.dueHasTime,
    priority: row.priority,
    visibility: row.visibility,
    labelIds: labelIds.get(row.id) ?? [],
    assigneeIds: assigneeIds.get(row.id) ?? [],
    checklist: { done: row.checklistDone, total: row.checklistTotal },
    commentCount: row.commentCount,
    hasDescription: row.hasDescription,
    // A capa entra na tarefa 11.6 (sem R2 configurado continua `null`, ADR 0016).
    cover: null,
    archivedAt: toIsoOrNull(row.archivedAt),
  };
}

/** Card restrito para quem não tem acesso: só id, lista, posição e título (ADR 0015). */
function toLockedCard(row: CardSummaryRow): LockedCard {
  return {
    id: row.id,
    listId: row.listId,
    position: row.position,
    title: row.title,
    locked: true,
  };
}

async function loadSummaries(
  db: DbExecutor,
  scope: CardSummaryScope,
  actor: CardActor,
): Promise<{ row: CardSummaryRow; card: CardSummary | null }[]> {
  const rows = await findCardSummaryRows(db, scope, actor);
  if (rows.length === 0) return [];
  // Sequencial: `db` pode ser uma transação (uma conexão só).
  const labelPairs = await findCardLabelPairs(db, scope, actor);
  const assigneePairs = await findCardAssigneePairs(db, scope, actor);
  const labelIds = groupBy(
    labelPairs,
    (p) => p.cardId,
    (p) => p.labelId,
  );
  const assigneeIds = groupBy(
    assigneePairs,
    (p) => p.cardId,
    (p) => p.userId,
  );
  return rows.map((row) => ({
    row,
    card: row.accessible ? toCardSummary(row, labelIds, assigneeIds) : null,
  }));
}

/**
 * Cards do payload do quadro: não arquivados, de listas não arquivadas, por `(listId, position)`.
 * Card restrito sem acesso entra como `LockedCard`, na posição e na lista dele (ADR 0015).
 */
export async function loadBoardCards(
  db: DbExecutor,
  boardId: string,
  actor: CardActor,
): Promise<BoardCard[]> {
  return (await loadSummaries(db, { boardId, state: 'active' }, actor)).map(({ row, card }) =>
    card === null ? toLockedCard(row) : card,
  );
}

/**
 * Cards arquivados individualmente, com o contexto da lista, por `archivedAt` desc. Sem acesso: o
 * mesmo `LockedCard` do quadro, sem a lista de origem (scope §11, F4).
 */
export async function loadArchivedCards(
  db: DbExecutor,
  boardId: string,
  actor: CardActor,
): Promise<BoardArchivedCard[]> {
  return (await loadSummaries(db, { boardId, state: 'archived' }, actor)).map(({ row, card }) =>
    card === null
      ? toLockedCard(row)
      : { ...card, listName: row.listName, listArchived: row.listArchived },
  );
}

/**
 * `GET /api/me/cards` (D1): cards abertos, não arquivados, em lista e quadro não arquivados,
 * atribuídos ao usuário. Ordem: `dueAt ASC NULLS LAST`, prioridade (Urgente → sem), `createdAt`.
 * Três consultas (faces, etiquetas, responsáveis) num snapshot único.
 */
export async function getMyCards(db: Database, actor: CardActor): Promise<MyCard[]> {
  return db.transaction(
    async (tx) =>
      // A consulta já omite o que o ator não pode abrir (RN32 e api.md §18.7 item 49).
      (await loadSummaries(tx, { assigneeId: actor.id }, actor)).flatMap(({ row, card }) =>
        card === null
          ? []
          : [
              {
                ...card,
                boardName: row.boardName,
                listName: row.listName,
                listColor: row.listColor,
              },
            ],
      ),
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

/** Face de um card (arquivado ou não), para quem tem acesso a ele. */
export async function loadCardSummary(
  db: DbExecutor,
  cardId: string,
  actor: CardActor,
): Promise<CardSummary> {
  const [found] = await loadSummaries(db, { cardId }, actor);
  if (!found) throw notFound();
  if (found.card === null) throw cardRestricted();
  return found.card;
}

async function loadCardDetail(
  db: DbExecutor,
  cardId: string,
  actor: CardActor,
): Promise<CardDetail> {
  const card = await findCardById(db, cardId);
  if (!card) throw notFound();
  await assertCardAccess(db, card, actor);
  const summary = await loadCardSummary(db, cardId, actor);
  const board = await findBoardById(db, card.boardId);
  const list = await findListById(db, card.listId);
  if (!board || !list) throw notFound();
  const { checklists, items } = await findCardChecklists(db, cardId);
  const commentRows = await findCardComments(db, cardId);

  const itemsByChecklist = new Map<string, Checklist['items']>();
  for (const item of items) {
    const bucket = itemsByChecklist.get(item.checklistId) ?? [];
    bucket.push({
      id: item.id,
      checklistId: item.checklistId,
      text: item.text,
      position: item.position,
      isChecked: item.isChecked,
      checkedBy: item.checkedBy,
      checkedAt: toIsoOrNull(item.checkedAt),
    });
    itemsByChecklist.set(item.checklistId, bucket);
  }

  return {
    ...summary,
    description: card.description,
    viewerIds: card.visibility === 'restricted' ? await findCardViewerIds(db, cardId) : [],
    completedBy: card.completedBy,
    createdBy: card.createdBy,
    createdAt: toIso(card.createdAt),
    updatedAt: toIso(card.updatedAt),
    board: { id: board.id, name: board.name, archived: board.archivedAt !== null },
    list: {
      id: list.id,
      name: list.name,
      color: list.color,
      isDoneList: list.isDoneList,
      archived: list.archivedAt !== null,
    },
    checklists: checklists.map((checklist): Checklist => ({
      id: checklist.id,
      cardId: checklist.cardId,
      title: checklist.title,
      createdAt: toIso(checklist.createdAt),
      items: itemsByChecklist.get(checklist.id) ?? [],
    })),
    comments: commentRows.map((comment): Comment => ({
      id: comment.id,
      cardId: comment.cardId,
      authorId: comment.authorId,
      body: comment.body,
      editedAt: toIsoOrNull(comment.editedAt),
      createdAt: toIso(comment.createdAt),
    })),
  };
}

/**
 * `GET /api/cards/:cardId`: detalhe (card arquivado também), num snapshot único.
 * Card restrito sem acesso → `403 CARD_RESTRICTED` (não 404: o quadro já mostra que ele existe).
 */
export async function getCardDetail(
  db: Database,
  cardId: string,
  actor: CardActor,
): Promise<CardDetail> {
  return db.transaction((tx) => loadCardDetail(tx, cardId, actor), {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  });
}

/** `GET /api/cards/:cardId/activity`: até 500, mais recentes primeiro. */
export async function getCardActivity(
  db: Database,
  cardId: string,
  actor: CardActor,
): Promise<Activity[]> {
  return db.transaction(
    async (tx) => {
      const card = await findCardById(tx, cardId);
      if (!card) throw notFound();
      await assertCardAccess(tx, card, actor);
      return listCardActivities(tx, cardId);
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

// ---------------------------------------------------------------------------
// Locks e erros
// ---------------------------------------------------------------------------

function notFound(): AppError {
  return new AppError('NOT_FOUND', CARD_NOT_FOUND_MESSAGE);
}

function boardArchived(): AppError {
  return new AppError('BOARD_ARCHIVED', CARD_BOARD_ARCHIVED_MESSAGE);
}

function listArchived(): AppError {
  return new AppError('LIST_ARCHIVED', CARD_LIST_ARCHIVED_MESSAGE);
}

/** O card mudou de lista/quadro entre a leitura e o lock: a transação é refeita. */
class CardMovedConcurrently extends Error {
  constructor() {
    super('card movido por outra transação durante o lock');
    this.name = 'CardMovedConcurrently';
  }
}

const MAX_LOCK_ATTEMPTS = 5;

/** `db.transaction` que refaz a transação quando o card muda de lista durante o lock. */
export async function cardTransaction<T>(
  db: Database,
  fn: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(fn);
    } catch (err) {
      if (err instanceof CardMovedConcurrently && attempt < MAX_LOCK_ATTEMPTS) continue;
      throw err;
    }
  }
}

export interface CardLock {
  card: CardRow;
  boards: Map<string, BoardRow>;
  lists: Map<string, ListRow>;
}

/**
 * Bloqueia, nesta ordem, os quadros envolvidos (`FOR SHARE`, por id), as listas envolvidas
 * (`FOR UPDATE`, por id; só se `lockLists`) e o card (`FOR UPDATE`). Mesma ordem em todas as
 * mutações de cards e compatível com as de listas (quadro → lista → card), então não há ciclo.
 * Card inexistente (ou excluído no meio) → 404. Se o card mudou de lista/quadro entre a leitura
 * e o lock, lança `CardMovedConcurrently` (a transação é refeita por `cardTransaction`).
 *
 * Depois do lock, e antes de qualquer 409, checa o acesso ao card (ADR 0015): como toda mutação de
 * card, checklist, comentário, etiqueta e responsável passa por aqui, a regra vale por construção e
 * sobre a linha já bloqueada.
 */
export async function lockCard(
  tx: DbExecutor,
  cardId: string,
  options: {
    actor: CardActor;
    lockLists: boolean;
    extraBoardIds?: string[];
    extraListIds?: string[];
  },
): Promise<CardLock> {
  const unlocked = await findCardById(tx, cardId);
  if (!unlocked) throw notFound();

  const boardRows = await lockBoardsShared(tx, [
    unlocked.boardId,
    ...(options.extraBoardIds ?? []),
  ]);
  const boards = new Map(boardRows.map((row) => [row.id, row]));
  if (!boards.has(unlocked.boardId)) throw notFound();

  const listRows = options.lockLists
    ? await lockListsByIds(tx, [unlocked.listId, ...(options.extraListIds ?? [])])
    : [];
  const lists = new Map(listRows.map((row) => [row.id, row]));

  const card = await lockCardById(tx, cardId);
  if (!card) throw notFound();
  if (card.listId !== unlocked.listId || card.boardId !== unlocked.boardId) {
    throw new CardMovedConcurrently();
  }
  await assertCardAccess(tx, card, options.actor);
  return { card, boards, lists };
}

export function assertBoardWritable(board: BoardRow | undefined): BoardRow {
  if (!board) throw notFound();
  if (board.archivedAt !== null) throw boardArchived();
  return board;
}

// ---------------------------------------------------------------------------
// Mutações
// ---------------------------------------------------------------------------

/**
 * `POST /api/lists/:listId/cards { title }`: cria no **fim** da lista e registra `card_created`.
 * Ordem: 404 → `BOARD_ARCHIVED` → `LIST_ARCHIVED` → `LIST_IS_DONE_LIST`.
 */
export async function createCard(
  db: Database,
  ctx: CardActionContext,
  listId: string,
  title: string,
): Promise<CardSummary> {
  return db.transaction(async (tx) => {
    const found = await findListById(tx, listId);
    if (!found) throw new AppError('NOT_FOUND', LIST_NOT_FOUND_MESSAGE);
    const [board] = await lockBoardsShared(tx, [found.boardId]);
    assertBoardWritable(board);
    const list = await lockListById(tx, listId);
    if (!list) throw new AppError('NOT_FOUND', LIST_NOT_FOUND_MESSAGE);
    if (list.archivedAt !== null) throw listArchived();
    if (list.isDoneList) throw new AppError('LIST_IS_DONE_LIST', LIST_IS_DONE_LIST_MESSAGE);

    const position = await computePosition(tx, CARD_SIBLINGS, list.id, { type: 'end' }, null);
    const card = await insertCardRow(tx, {
      boardId: list.boardId,
      listId: list.id,
      title,
      position,
      createdBy: ctx.actor.id,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    await recordActivity(tx, {
      cardId: card.id,
      boardId: card.boardId,
      actorId: ctx.actor.id,
      now: ctx.now,
      type: 'card_created',
      data: { listId: list.id, listName: list.name },
    });
    return loadCardSummary(tx, card.id, ctx.actor);
  });
}

/**
 * `PATCH /api/cards/:cardId { title?, description?, due?, priority? }` (api.md §11).
 * Atividades só quando o valor muda: `card_title_changed`, `card_due_changed`,
 * `card_priority_changed`. Descrição não gera atividade. Quadro arquivado → 409.
 */
export async function updateCard(
  db: Database,
  ctx: CardActionContext,
  cardId: string,
  input: UpdateCardRequest,
): Promise<CardDetail> {
  return cardTransaction(db, async (tx) => {
    const { card, boards } = await lockCard(tx, cardId, { actor: ctx.actor, lockLists: false });
    assertBoardWritable(boards.get(card.boardId));

    const changes: Parameters<typeof updateCardById>[2] = {};
    const base = { cardId: card.id, boardId: card.boardId, actorId: ctx.actor.id, now: ctx.now };

    if (input.title !== undefined && input.title !== card.title) {
      changes.title = input.title;
      await recordActivity(tx, {
        ...base,
        type: 'card_title_changed',
        data: { from: card.title, to: input.title },
      });
    }

    if (input.description !== undefined && input.description !== card.description) {
      changes.description = input.description;
    }

    if (input.due !== undefined) {
      const next =
        input.due === null
          ? { dueAt: null, dueHasTime: false }
          : dueInputToUtc(input.due, (await getWorkspace(tx)).timezone);
      const sameInstant = (next.dueAt?.getTime() ?? null) === (card.dueAt?.getTime() ?? null);
      if (!sameInstant || next.dueHasTime !== card.dueHasTime) {
        changes.dueAt = next.dueAt;
        changes.dueHasTime = next.dueHasTime;
        await recordActivity(tx, {
          ...base,
          type: 'card_due_changed',
          data: {
            from: toIsoOrNull(card.dueAt),
            to: toIsoOrNull(next.dueAt),
            hasTime: next.dueHasTime,
          },
        });
      }
    }

    if (input.priority !== undefined && input.priority !== card.priority) {
      changes.priority = input.priority;
      await recordActivity(tx, {
        ...base,
        type: 'card_priority_changed',
        data: { from: card.priority, to: input.priority },
      });
    }

    if (Object.keys(changes).length > 0) {
      await updateCardById(tx, card.id, { ...changes, updatedAt: ctx.now });
    }
    return loadCardDetail(tx, card.id, ctx.actor);
  });
}

/**
 * `POST /api/cards/:cardId/move { toListId, placement }` (api.md §11, ADR 0004/0010).
 * Ordem das checagens: 404 (card, lista) → `BOARD_ARCHIVED` (origem, destino) →
 * `LIST_ARCHIVED` (destino) → `CONFLICT` (card arquivado) → `INVALID_PLACEMENT`.
 * - Entre quadros: `list_id` e `board_id` no mesmo `UPDATE`; etiquetas de outro quadro removidas.
 * - `card_moved` só se a lista mudou; conclusão/reabertura pela matriz de §4.2.
 */
export async function moveCard(
  db: Database,
  ctx: CardActionContext,
  cardId: string,
  input: MoveCardRequest,
): Promise<CardMutationResult> {
  return cardTransaction(db, async (tx) => {
    if (!(await findCardById(tx, cardId))) throw notFound();
    const targetRef = await findListById(tx, input.toListId);
    if (!targetRef) throw new AppError('NOT_FOUND', LIST_NOT_FOUND_MESSAGE);

    const { card, boards, lists } = await lockCard(tx, cardId, {
      actor: ctx.actor,
      lockLists: true,
      extraBoardIds: [targetRef.boardId],
      extraListIds: [targetRef.id],
    });
    const sourceBoard = assertBoardWritable(boards.get(card.boardId));
    const targetBoard = boards.get(targetRef.boardId);
    if (!targetBoard) throw new AppError('NOT_FOUND', LIST_NOT_FOUND_MESSAGE);
    assertBoardWritable(targetBoard);
    const target = lists.get(targetRef.id);
    const source = lists.get(card.listId);
    if (!target || !source) throw new AppError('NOT_FOUND', LIST_NOT_FOUND_MESSAGE);
    if (target.archivedAt !== null) throw listArchived();
    if (card.archivedAt !== null) throw new AppError('CONFLICT', CARD_ARCHIVED_MOVE_MESSAGE);

    const position = await computePosition(tx, CARD_SIBLINGS, target.id, input.placement, card.id);

    const crossBoard = target.boardId !== card.boardId;
    const removedLabelIds = crossBoard
      ? await deleteForeignCardLabels(tx, card.id, target.boardId)
      : [];

    const moved = await updateCardById(tx, card.id, {
      listId: target.id,
      boardId: target.boardId,
      position,
      updatedAt: ctx.now,
    });

    const base = { cardId: card.id, boardId: target.boardId, actorId: ctx.actor.id, now: ctx.now };
    if (source.id !== target.id) {
      await recordActivity(tx, {
        ...base,
        type: 'card_moved',
        data: {
          fromListId: source.id,
          fromListName: source.name,
          toListId: target.id,
          toListName: target.name,
          fromBoardId: sourceBoard.id,
          fromBoardName: sourceBoard.name,
          toBoardId: targetBoard.id,
          toBoardName: targetBoard.name,
        },
      });
    }

    const completionChange = completionChangeOnMove({
      status: card.status,
      fromListIsDone: source.isDoneList,
      toListIsDone: target.isDoneList,
    });
    if (completionChange !== null) {
      await applyCompletionChange(tx, {
        card: moved,
        change: completionChange,
        actorId: ctx.actor.id,
        now: ctx.now,
      });
    }

    return {
      card: await loadCardSummary(tx, card.id, ctx.actor),
      completionChange,
      removedLabelIds,
    };
  });
}

/**
 * Lista de destino de `complete`/`reopen` (ADR 0010) a partir das listas ativas do quadro, ou
 * `null` se o card fica onde está.
 */
async function completionTargetListId(
  tx: DbExecutor,
  card: Pick<CardRow, 'boardId' | 'listId'>,
  change: CompletionChange,
): Promise<string | null> {
  const refs = (await findActiveLists(tx, card.boardId)).map((list) => ({
    id: list.id,
    isDoneList: list.isDoneList,
    position: list.position,
  }));
  return change === 'completed' ? completeTargetListId(card, refs) : reopenTargetListId(card, refs);
}

/**
 * `POST /api/cards/:cardId/complete` e `POST /api/cards/:cardId/reopen` (api.md §11, ADR 0010).
 * - `complete` de card aberto: conclui e, se o quadro tem lista de conclusão e o card não está nela,
 *   move para o **fim** dela;
 * - `reopen` de card concluído: reabre e, se o card está na lista de conclusão, move para o **topo**
 *   da primeira lista ativa não-conclusão (se houver);
 * - já no estado pedido: 200 no-op (`completionChange: null`).
 * Ordem: 404 → `409 BOARD_ARCHIVED` → `409 CONFLICT` (card arquivado, mesmo se no-op).
 * Atividades: `card_moved` (se mudou de lista) antes de `card_completed`/`card_reopened`.
 * Locks: quadro `FOR SHARE` → listas de origem e destino `FOR UPDATE` → card `FOR UPDATE`. O destino
 * é calculado antes dos locks e conferido depois (as listas só mudam com o quadro `FOR UPDATE`);
 * se mudou, a transação é refeita.
 */
export async function changeCardCompletion(
  db: Database,
  ctx: CardActionContext,
  cardId: string,
  change: CompletionChange,
): Promise<CardMutationResult> {
  return cardTransaction(db, async (tx) => {
    const unlocked = await findCardById(tx, cardId);
    if (!unlocked) throw notFound();
    const plannedTarget = await completionTargetListId(tx, unlocked, change);

    const { card, boards, lists } = await lockCard(tx, cardId, {
      actor: ctx.actor,
      lockLists: true,
      extraListIds: plannedTarget === null ? [] : [plannedTarget],
    });
    const board = assertBoardWritable(boards.get(card.boardId));
    if (card.archivedAt !== null) {
      throw new AppError('CONFLICT', CARD_ARCHIVED_COMPLETION_MESSAGE);
    }

    const expected = change === 'completed' ? 'open' : 'completed';
    if (card.status !== expected) {
      return {
        card: await loadCardSummary(tx, card.id, ctx.actor),
        completionChange: null,
        removedLabelIds: [],
      };
    }

    const target = await completionTargetListId(tx, card, change);
    if (target !== plannedTarget) throw new CardMovedConcurrently();

    let current: CardRow = card;
    if (target !== null) {
      const source = lists.get(card.listId);
      const destination = lists.get(target);
      if (!source || !destination) throw new CardMovedConcurrently();
      const position = await computePosition(
        tx,
        CARD_SIBLINGS,
        destination.id,
        { type: change === 'completed' ? 'end' : 'start' },
        card.id,
      );
      current = await updateCardById(tx, card.id, {
        listId: destination.id,
        position,
        updatedAt: ctx.now,
      });
      await recordActivity(tx, {
        cardId: card.id,
        boardId: card.boardId,
        actorId: ctx.actor.id,
        now: ctx.now,
        type: 'card_moved',
        data: {
          fromListId: source.id,
          fromListName: source.name,
          toListId: destination.id,
          toListName: destination.name,
          fromBoardId: board.id,
          fromBoardName: board.name,
          toBoardId: board.id,
          toBoardName: board.name,
        },
      });
    }

    await applyCompletionChange(tx, {
      card: current,
      change,
      actorId: ctx.actor.id,
      now: ctx.now,
    });
    return {
      card: await loadCardSummary(tx, card.id, ctx.actor),
      completionChange: change,
      removedLabelIds: [],
    };
  });
}

/** `POST /api/cards/:cardId/archive`: registra `card_archived`. Idempotente. Status não muda. */
export async function archiveCard(
  db: Database,
  ctx: CardActionContext,
  cardId: string,
): Promise<CardSummary> {
  return cardTransaction(db, async (tx) => {
    const { card, boards } = await lockCard(tx, cardId, { actor: ctx.actor, lockLists: true });
    assertBoardWritable(boards.get(card.boardId));
    if (card.archivedAt === null) {
      await updateCardById(tx, card.id, { archivedAt: ctx.now, updatedAt: ctx.now });
      await recordActivity(tx, {
        cardId: card.id,
        boardId: card.boardId,
        actorId: ctx.actor.id,
        now: ctx.now,
        type: 'card_archived',
        data: {},
      });
    }
    return loadCardSummary(tx, card.id, ctx.actor);
  });
}

/**
 * `POST /api/cards/:cardId/restore`: volta no **fim** da lista original e registra
 * `card_restored`; se a lista é de conclusão e o card está aberto, também conclui
 * (`card_completed`, RN12). Card não arquivado → 200 sem mudança (idempotente, checado antes da
 * lista). Lista arquivada → `409 LIST_ARCHIVED`.
 */
export async function restoreCard(
  db: Database,
  ctx: CardActionContext,
  cardId: string,
): Promise<CardSummary> {
  return cardTransaction(db, async (tx) => {
    const { card, boards, lists } = await lockCard(tx, cardId, {
      actor: ctx.actor,
      lockLists: true,
    });
    assertBoardWritable(boards.get(card.boardId));
    if (card.archivedAt === null) return loadCardSummary(tx, card.id, ctx.actor);
    const list = lists.get(card.listId);
    if (!list) throw notFound();
    if (list.archivedAt !== null) throw listArchived();

    const position = await computePosition(tx, CARD_SIBLINGS, list.id, { type: 'end' }, card.id);
    const restored = await updateCardById(tx, card.id, {
      archivedAt: null,
      position,
      updatedAt: ctx.now,
    });
    await recordActivity(tx, {
      cardId: card.id,
      boardId: card.boardId,
      actorId: ctx.actor.id,
      now: ctx.now,
      type: 'card_restored',
      data: {},
    });
    const change = completionChangeOnRestore({ status: card.status, listIsDone: list.isDoneList });
    if (change !== null) {
      await applyCompletionChange(tx, {
        card: restored,
        change,
        actorId: ctx.actor.id,
        now: ctx.now,
      });
    }
    return loadCardSummary(tx, card.id, ctx.actor);
  });
}

/**
 * `DELETE /api/cards/:cardId` (Admin): exclusão definitiva em cascata.
 * Ordem: 404 → 403 (papel) → `409 BOARD_ARCHIVED` (quadro arquivado é somente leitura, I10).
 */
export async function deleteCard(db: Database, actor: CardActor, cardId: string): Promise<void> {
  await cardTransaction(db, async (tx) => {
    const { card, boards } = await lockCard(tx, cardId, { actor, lockLists: false });
    if (actor.role !== 'admin') throw new AppError('FORBIDDEN', FORBIDDEN_MESSAGE);
    assertBoardWritable(boards.get(card.boardId));
    await deleteCardById(tx, card.id);
  });
}

// ---------------------------------------------------------------------------
// Responsáveis (C4)
// ---------------------------------------------------------------------------

/**
 * `PUT /api/cards/:cardId/assignees/:userId` (api.md §11). Ordem: 404 (card, usuário) →
 * `409 BOARD_ARCHIVED` → `409 USER_NOT_ACTIVE`. Card arquivado é aceito (como no `PATCH`).
 * Atribuição nova: atividade `card_assignee_added` e gancho `onAssigned` (notificação na Fatia 7).
 * Já atribuído: 200 sem atividade (idempotente), inclusive se o usuário foi desativado depois.
 * O usuário fica com lock `FOR SHARE` até o fim, então desativar em paralelo não "fura" a regra.
 */
export async function assignCard(
  db: Database,
  ctx: CardActionContext,
  cardId: string,
  userId: string,
): Promise<string[]> {
  return cardTransaction(db, async (tx) => {
    const { card, boards } = await lockCard(tx, cardId, { actor: ctx.actor, lockLists: false });
    if (!(await findUserById(tx, userId))) throw new AppError('NOT_FOUND', USER_NOT_FOUND_MESSAGE);
    assertBoardWritable(boards.get(card.boardId));

    const current = await findCardAssigneeIds(tx, card.id);
    if (current.includes(userId)) return current;

    const user = await lockUserShared(tx, userId);
    if (!user) throw new AppError('NOT_FOUND', USER_NOT_FOUND_MESSAGE);
    if (user.status !== 'active' || user.anonymizedAt !== null) {
      throw new AppError('USER_NOT_ACTIVE', USER_NOT_ACTIVE_ASSIGN_MESSAGE);
    }

    const inserted = await insertCardAssignee(tx, {
      cardId: card.id,
      userId,
      assignedBy: ctx.actor.id,
      now: ctx.now,
    });
    if (inserted) {
      await recordActivity(tx, {
        cardId: card.id,
        boardId: card.boardId,
        actorId: ctx.actor.id,
        now: ctx.now,
        type: 'card_assignee_added',
        data: { userId },
      });
      await onAssigned(tx, { cardId: card.id, userId, actorId: ctx.actor.id, now: ctx.now });
    }
    return findCardAssigneeIds(tx, card.id);
  });
}

/**
 * `DELETE /api/cards/:cardId/assignees/:userId`: remove (qualquer status de usuário). Ordem: 404
 * (card, usuário) → `409 BOARD_ARCHIVED`. Se existia: `card_assignee_removed`. Idempotente.
 */
export async function unassignCard(
  db: Database,
  ctx: CardActionContext,
  cardId: string,
  userId: string,
): Promise<string[]> {
  return cardTransaction(db, async (tx) => {
    const { card, boards } = await lockCard(tx, cardId, { actor: ctx.actor, lockLists: false });
    if (!(await findUserById(tx, userId))) throw new AppError('NOT_FOUND', USER_NOT_FOUND_MESSAGE);
    assertBoardWritable(boards.get(card.boardId));

    if (await deleteCardAssignee(tx, card.id, userId)) {
      await recordActivity(tx, {
        cardId: card.id,
        boardId: card.boardId,
        actorId: ctx.actor.id,
        now: ctx.now,
        type: 'card_assignee_removed',
        data: { userId },
      });
    }
    return findCardAssigneeIds(tx, card.id);
  });
}
