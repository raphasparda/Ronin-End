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

// ---------------------------------------------------------------------------
// Capa do quadro (Fatia 11, ADR 0016)
// ---------------------------------------------------------------------------

/** Tipos de imagem aceitos na capa (RN21). Sem SVG (script) e sem GIF (animação pesada). */
export const BOARD_COVER_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const;
export type BoardCoverContentType = (typeof BOARD_COVER_CONTENT_TYPES)[number];

/** Tamanho máximo da capa: 5 MiB (RN22). */
export const BOARD_COVER_MAX_BYTES = 5 * 1024 * 1024;

/** Dimensão máxima aceita em `width`/`height` da capa (informadas pelo cliente). */
export const BOARD_COVER_MAX_DIMENSION = 20_000;

/** Caracteres aleatórios (base64url) no fim da chave do objeto: 24 bytes → 32 caracteres. */
export const BOARD_COVER_KEY_RANDOM_LENGTH = 32;

/** Prefixo das chaves de capa no bucket (`covers/<boardId>/...`). */
export const BOARD_COVER_KEY_PREFIX = 'covers/';

/** Sufixo aleatório de uma chave de capa (o que vem depois de `covers/<boardId>/`). */
const BOARD_COVER_KEY_RANDOM = /^[A-Za-z0-9_-]{32}$/;

/** Prefixo das capas de um quadro: `covers/<boardId>/`. */
export function boardCoverKeyPrefix(boardId: string): string {
  return `${BOARD_COVER_KEY_PREFIX}${boardId}/`;
}

/**
 * `true` se `objectKey` é uma chave de capa **daquele** quadro (I14):
 * `covers/<boardId>/<32 caracteres base64url>` (ADR 0016). Comparação sem montar regex com a
 * entrada, então serve para validar chave vinda do cliente.
 */
export function isBoardCoverKey(objectKey: string, boardId: string): boolean {
  const prefix = boardCoverKeyPrefix(boardId);
  if (!objectKey.startsWith(prefix)) return false;
  return BOARD_COVER_KEY_RANDOM.test(objectKey.slice(prefix.length));
}

// ---------------------------------------------------------------------------
// Foto de perfil (api.md §6)
// ---------------------------------------------------------------------------

/** Lado do quadrado gerado pelo front antes de enviar (o recorte é central). */
export const AVATAR_SIZE_PX = 256;

/** Teto da imagem já processada. Cabe com folga no limite de corpo da API (256 KB). */
export const AVATAR_MAX_BYTES = 128 * 1024;

/** Comprimento máximo do base64 de `AVATAR_MAX_BYTES` (com padding). */
export const AVATAR_MAX_BASE64_LENGTH = Math.ceil(AVATAR_MAX_BYTES / 3) * 4;

/** Tipos aceitos em `PUT /api/me/avatar`. O front sempre envia WebP. */
export const AVATAR_CONTENT_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;

export type AvatarContentType = (typeof AVATAR_CONTENT_TYPES)[number];

/** Extensões oferecidas no seletor de arquivo (o servidor valida pelo `contentType`). */
export const AVATAR_ACCEPT = 'image/png,image/jpeg,image/webp';
