import { DEFAULT_BOARD_LIST_COLORS } from './palette';
import type { PaletteColor } from './palette';

/** Nome exibido para usuário anonimizado (overview.md §5.2). */
export const ANONYMIZED_USER_NAME = 'Usuário removido';

/** Validade do link de convite (A2): 7 dias. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Validade do link de redefinição de senha (A4): 24 horas. */
export const PASSWORD_RESET_TTL_MS = 24 * 60 * 60 * 1000;

export interface DefaultBoardList {
  name: string;
  color: PaletteColor;
  isDoneList: boolean;
}

/** Listas criadas com todo quadro novo (api.md §9, B1), nesta ordem. */
export const DEFAULT_BOARD_LISTS: readonly DefaultBoardList[] = [
  { name: 'A fazer', color: DEFAULT_BOARD_LIST_COLORS[0], isDoneList: false },
  { name: 'Fazendo', color: DEFAULT_BOARD_LIST_COLORS[1], isDoneList: false },
  { name: 'Concluído', color: DEFAULT_BOARD_LIST_COLORS[2], isDoneList: true },
];

/** Título sugerido pela UI para um checklist novo (api.md §13). */
export const DEFAULT_CHECKLIST_TITLE = 'Checklist';

/** Máximo de itens em `GET /api/cards/:cardId/activity` (api.md §11). */
export const ACTIVITY_LIMIT = 500;

/** Paginação de notificações (api.md §15). */
export const NOTIFICATIONS_DEFAULT_LIMIT = 30;
export const NOTIFICATIONS_MAX_LIMIT = 100;

/** Notificações lidas há mais que isso podem ser apagadas (RN19). */
export const READ_NOTIFICATION_RETENTION_DAYS = 90;
