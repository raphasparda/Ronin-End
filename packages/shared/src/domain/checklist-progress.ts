/**
 * Progresso somado de todos os checklists do card (`CardSummary.checklist`), para
 * atualizar a face do card a partir do detalhe sem novo fetch.
 */
export function checklistProgress(
  checklists: readonly { items: readonly { isChecked: boolean }[] }[],
): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const checklist of checklists) {
    for (const item of checklist.items) {
      total += 1;
      if (item.isChecked) done += 1;
    }
  }
  return { done, total };
}
