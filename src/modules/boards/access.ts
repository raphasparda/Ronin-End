import { canAccessBoard, type BoardVisibility, type Role } from '@raphasparda/ronin-shared';
import { and, eq, exists, or, sql, type SQL } from 'drizzle-orm';

import type { DbExecutor } from '../../db/client';
import { boards, boardViewers } from '../../db/schema';
import { AppError } from '../../lib/app-error';

export const BOARD_RESTRICTED_MESSAGE = 'Você não tem acesso a este quadro.';

/** Quem está agindo: id e papel do usuário da sessão (`requireUser`). */
export interface BoardActor {
  id: string;
  role: Role;
}

/** Quadro já lido, do ponto de vista do acesso. */
export interface BoardAccessRow {
  id: string;
  visibility: BoardVisibility;
}

/** `403 BOARD_RESTRICTED` (api.md §3). */
export function boardRestricted(): AppError {
  return new AppError('BOARD_RESTRICTED', BOARD_RESTRICTED_MESSAGE);
}

/** `true` se o ator está na lista de acesso do quadro. */
export async function isBoardViewer(
  db: DbExecutor,
  boardId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ one: sql`1` })
    .from(boardViewers)
    .where(and(eq(boardViewers.boardId, boardId), eq(boardViewers.userId, userId)))
    .limit(1);
  return row !== undefined;
}

/**
 * Regra de acesso (ADR 0015), forma imperativa: `visibility = 'team'` **ou** Admin **ou** linha em
 * `board_viewers`. Sem acesso → `403 BOARD_RESTRICTED`.
 *
 * Roda sobre a linha já lida (nas mutações, bloqueada com `FOR SHARE`/`FOR UPDATE` dentro de
 * `lockBoard`/`lockCard`), então restringir o quadro em paralelo não deixa passar mutação. A regra
 * pura, espelhada no front, é `canAccessBoard` do `@raphasparda/ronin-shared`.
 */
export async function assertBoardAccess(
  db: DbExecutor,
  board: BoardAccessRow,
  actor: BoardActor,
): Promise<void> {
  if (canAccessBoard({ visibility: board.visibility, viewerIds: [] }, actor)) return;
  if (!(await isBoardViewer(db, board.id, actor.id))) throw boardRestricted();
}

/**
 * Mesma regra em SQL, para as listagens que atravessam quadros ("Meus cards", notificações e a
 * própria lista de quadros). A consulta precisa ter `boards` no `FROM` (ou num `JOIN`): o predicado
 * é correlacionado com ela e o `EXISTS` é servido pela PK de `board_viewers` (sem N+1).
 */
export function boardAccessCondition(db: DbExecutor, actor: BoardActor): SQL {
  if (actor.role === 'admin') return sql`true`;
  return or(
    eq(boards.visibility, 'team'),
    exists(
      db
        .select({ one: sql`1` })
        .from(boardViewers)
        .where(and(eq(boardViewers.boardId, boards.id), eq(boardViewers.userId, actor.id))),
    ),
  ) as SQL;
}

export { canAccessBoard };
