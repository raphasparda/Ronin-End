import type { BoardActor } from '../src/modules/tools/kanban/boards/access';
import type { CoverReadContext } from '../src/modules/tools/kanban/boards/cover';

import type { Actor } from './actors';

/** Ator (id + papel) a partir de um `Actor` de teste, para serviços que checam acesso ao quadro. */
export function boardActor(actor: Actor): BoardActor {
  return { id: actor.user.id, role: actor.user.role };
}

/** Contexto de leitura sem R2 configurado: `cover` sai sempre `null` (ADR 0016). */
export function noCovers(now = new Date()): CoverReadContext {
  return { storage: null, now };
}
