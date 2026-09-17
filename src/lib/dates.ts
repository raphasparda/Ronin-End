/** Datas de resposta: sempre ISO 8601 UTC com `Z` (api.md §1 e §18.7). */
export function toIso(date: Date): string {
  return date.toISOString();
}

export function toIsoOrNull(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}
