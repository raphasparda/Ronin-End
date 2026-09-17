import { errorResponseSchema } from '@kanban/shared';
import { z } from 'zod';

/** Corpo de `204 No Content`. */
export const noContentSchema = z.null().describe('Sem conteúdo');

/**
 * Mapa `status → errorResponseSchema` para o `schema.response` de uma rota. Os erros são enviados
 * pelo handler global (`plugins/errors.ts`); declarar os status documenta a rota no OpenAPI.
 */
export function errorResponses<const S extends readonly number[]>(
  ...statuses: S
): Record<S[number], typeof errorResponseSchema> {
  return Object.fromEntries(statuses.map((status) => [status, errorResponseSchema])) as Record<
    S[number],
    typeof errorResponseSchema
  >;
}
