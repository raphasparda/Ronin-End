import type { Placement } from '../../../platform/schemas/common';

/**
 * Comparação binária de chaves de posição (ADR 0004), equivalente a `COLLATE "C"` para as
 * chaves ASCII do `fractional-indexing`. Nunca use `localeCompare` para posições.
 */
export function comparePosition(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Cópia ordenada por `position` (comparação binária). */
export function sortByPosition<T extends { position: string }>(items: readonly T[]): T[] {
  return [...items].sort((x, y) => comparePosition(x.position, y.position));
}

/**
 * Converte a posição escolhida em "Mover para…" (1-based) em `Placement`.
 *
 * `orderedSiblingIds` são os irmãos ativos do destino em ordem; se o item já está no destino
 * (mesma lista), informe `movingId` para que ele seja desconsiderado. Assim as posições
 * válidas vão de 1 a `n + 1`, onde `n` é o número de irmãos **sem** o próprio item:
 * 1 → `start`, `n + 1` → `end`, demais → `after` do irmão anterior.
 *
 * @throws RangeError se `targetPosition` não for inteiro entre 1 e `n + 1`.
 */
export function placementForPosition(
  orderedSiblingIds: readonly string[],
  targetPosition: number,
  movingId?: string,
): Placement {
  const siblings = orderedSiblingIds.filter((id) => id !== movingId);
  if (
    !Number.isInteger(targetPosition) ||
    targetPosition < 1 ||
    targetPosition > siblings.length + 1
  ) {
    throw new RangeError(`Posição fora do intervalo 1..${siblings.length + 1}`);
  }
  if (targetPosition === 1) return { type: 'start' };
  if (targetPosition === siblings.length + 1) return { type: 'end' };
  // targetPosition - 2 está em [0, siblings.length - 1] pelas checagens acima.
  return { type: 'after', id: siblings[targetPosition - 2] as string };
}

/**
 * Aplica um `Placement` a uma ordem de ids (atualização otimista no cliente).
 * Remove `movingId` de onde estiver e o insere conforme o placement.
 *
 * @returns nova ordem, ou `null` se `after.id` não é irmão ou é o próprio item
 *   (o servidor responderia `409 INVALID_PLACEMENT`).
 */
export function applyPlacement(
  orderedIds: readonly string[],
  movingId: string,
  placement: Placement,
): string[] | null {
  const rest = orderedIds.filter((id) => id !== movingId);
  switch (placement.type) {
    case 'start':
      return [movingId, ...rest];
    case 'end':
      return [...rest, movingId];
    case 'after': {
      if (placement.id === movingId) return null;
      const index = rest.indexOf(placement.id);
      if (index === -1) return null;
      return [...rest.slice(0, index + 1), movingId, ...rest.slice(index + 1)];
    }
  }
}
