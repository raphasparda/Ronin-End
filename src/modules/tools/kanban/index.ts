import type { App } from '../../../app';

import { boardRoutes } from './boards/routes';
import { cardRoutes } from './cards/routes';
import { checklistRoutes } from './checklists/routes';
import { commentRoutes } from './comments/routes';
import { labelRoutes } from './labels/routes';
import { listRoutes } from './lists/routes';

/**
 * Ferramenta Kanban: quadros, listas, cards, etiquetas, checklists e comentários.
 * Única porta de entrada da ferramenta no `buildApp()`; `activity` e `completion` são serviços
 * internos usados pelas rotas acima.
 */
export async function registerKanbanTool(app: App): Promise<void> {
  await app.register(boardRoutes);
  await app.register(listRoutes);
  await app.register(cardRoutes);
  await app.register(labelRoutes);
  await app.register(checklistRoutes);
  await app.register(commentRoutes);
}
