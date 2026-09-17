import { randomBytes } from 'node:crypto';

import {
  BOARD_COVER_CONTENT_TYPES,
  BOARD_COVER_MAX_BYTES,
  boardCoverKeyPrefix,
  isBoardCoverKey,
  type BoardCover,
  type BoardCoverUploadUrlRequest,
  type BoardCoverUploadUrlResponse,
  type BoardDetail,
  type ConfirmBoardCoverRequest,
} from '@raphasparda/ronin-shared';

import type { Database, DbExecutor } from '../../db/client';
import { AppError } from '../../lib/app-error';
import { toIso } from '../../lib/dates';
import { R2Error, type R2Client } from '../../lib/r2';

import { assertBoardAccess, type BoardActor } from './access';
import { deleteBoardCover, findBoardById, findBoardCover, upsertBoardCover } from './repository';
import {
  assertBoardWritable,
  BOARD_NOT_FOUND_MESSAGE,
  loadBoardDetail,
  lockWritableBoard,
  type BoardActionContext,
} from './service';

export const COVER_STORAGE_UNAVAILABLE_MESSAGE = 'As capas de quadro não estão disponíveis agora.';
export const COVER_UPLOAD_INVALID_MESSAGE =
  'Não foi possível confirmar a imagem enviada. Tente enviar de novo.';
export const COVER_KEY_INVALID_MESSAGE = 'Chave de imagem inválida para este quadro.';

/** A URL de escrita vale 5 minutos (ADR 0016). */
export const COVER_UPLOAD_TTL_SECONDS = 5 * 60;
/** Janela de arredondamento da URL de leitura: a mesma string sai por 5 minutos. */
export const COVER_READ_WINDOW_MS = 5 * 60 * 1000;
/** Validade da URL de leitura a partir do início da janela (efetiva: 10 a 15 minutos). */
export const COVER_READ_TTL_SECONDS = 15 * 60;
/** Cache das URLs assinadas (chave `objectKey|janela`). */
export const COVER_URL_CACHE_MAX = 500;
/** Cabeçalho de cache da imagem: privada, nunca compartilhada. */
export const COVER_CACHE_CONTROL = 'private, max-age=600';
/** Órfão só é apagado depois disso (upload iniciado e nunca confirmado). */
export const COVER_ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** Primeiros bytes de cada formato aceito (RN21: vale o conteúdo, não a extensão). */
const MAGIC_BYTES: Record<
  (typeof BOARD_COVER_CONTENT_TYPES)[number],
  (bytes: Uint8Array) => boolean
> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => b[i] === byte),
  'image/webp': (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
  'image/avif': (b) => ['ftypavif', 'ftypavis'].includes(ascii(b, 4, 12)),
};

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

/** `true` se os primeiros bytes batem com o tipo declarado (e gravado no objeto). */
export function matchesCoverMagic(contentType: string, bytes: Uint8Array): boolean {
  const check = MAGIC_BYTES[contentType as (typeof BOARD_COVER_CONTENT_TYPES)[number]];
  return check !== undefined && bytes.length >= 12 && check(bytes);
}

export function coverStorageUnavailable(cause?: unknown): AppError {
  return new AppError('COVER_STORAGE_UNAVAILABLE', COVER_STORAGE_UNAVAILABLE_MESSAGE, {
    ...(cause === undefined ? {} : { cause }),
  });
}

/** Sem R2 configurado, toda rota de capa responde `503` (ADR 0016, item 6). */
export function requireCoverStorage(storage: R2Client | null): R2Client {
  if (!storage) throw coverStorageUnavailable();
  return storage;
}

/** Erro de rede/timeout do R2 vira `503`, nunca 500. */
async function withStorage<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof R2Error) throw coverStorageUnavailable(err);
    throw err;
  }
}

/** Chave inadivinhável amarrada ao quadro: `covers/<boardId>/<32 base64url>` (24 bytes). */
export function newCoverObjectKey(boardId: string): string {
  return `${boardCoverKeyPrefix(boardId)}${randomBytes(24).toString('base64url')}`;
}

const urlCache = new Map<string, string>();

/** Só para os testes: zera o cache em memória das URLs assinadas. */
export function clearCoverUrlCache(): void {
  urlCache.clear();
}

/**
 * URL assinada de leitura, com vencimento **arredondado** para o início da janela de 5 minutos e
 * validade de 15 minutos a partir dali (ADR 0016, item 2): a mesma string sai durante a janela
 * inteira, então o polling de 30 s do quadro não invalida o cache do navegador nem faz a imagem
 * piscar. Assinar é HMAC local: a lista de quadros não custa I/O.
 */
export function signCoverUrl(storage: R2Client, objectKey: string, now: Date): BoardCover['url'] {
  const windowStart = Math.floor(now.getTime() / COVER_READ_WINDOW_MS) * COVER_READ_WINDOW_MS;
  const cacheKey = `${objectKey}|${windowStart}`;
  const cached = urlCache.get(cacheKey);
  if (cached) return cached;
  const url = storage.presignGet(objectKey, {
    expiresInSeconds: COVER_READ_TTL_SECONDS,
    now: new Date(windowStart),
    cacheControl: COVER_CACHE_CONTROL,
  });
  // Cache simples: cheio, começa de novo (a janela troca a cada 5 minutos de qualquer forma).
  if (urlCache.size >= COVER_URL_CACHE_MAX) urlCache.clear();
  urlCache.set(cacheKey, url);
  return url;
}

/** Vencimento da URL de leitura desta janela. */
export function coverExpiresAt(now: Date): Date {
  const windowStart = Math.floor(now.getTime() / COVER_READ_WINDOW_MS) * COVER_READ_WINDOW_MS;
  return new Date(windowStart + COVER_READ_TTL_SECONDS * 1000);
}

/** Dados da capa que as consultas de quadro trazem (sem a URL: ela nunca é gravada). */
export interface CoverSource {
  objectKey: string | null;
  width: number | null;
  height: number | null;
}

/** Contexto de leitura: bucket (ou `null`) e instante, para assinar a URL na resposta. */
export interface CoverReadContext {
  storage: R2Client | null;
  now: Date;
}

/** `cover` do quadro: `null` sem capa ou com o R2 desligado. */
export function toBoardCover(source: CoverSource, covers: CoverReadContext): BoardCover | null {
  if (!covers.storage || source.objectKey === null) return null;
  return {
    url: signCoverUrl(covers.storage, source.objectKey, covers.now),
    width: source.width,
    height: source.height,
    expiresAt: toIso(coverExpiresAt(covers.now)),
  };
}

/** Contexto de leitura a partir do contexto da ação. */
export function coverReadContext(ctx: BoardActionContext): CoverReadContext {
  return { storage: ctx.coverStorage, now: ctx.now };
}

/**
 * Acesso e estado do quadro **antes** de falar com o R2: 404 → `403 BOARD_RESTRICTED` →
 * `409 BOARD_ARCHIVED`. Assim as idas à rede ficam fora da transação que bloqueia o quadro.
 */
async function assertCoverWritable(
  db: Database,
  boardId: string,
  actor: BoardActor,
): Promise<void> {
  await db.transaction(
    async (tx) => {
      const board = await findBoardById(tx, boardId);
      if (!board) throw new AppError('NOT_FOUND', BOARD_NOT_FOUND_MESSAGE);
      await assertBoardAccess(tx, board, actor);
      assertBoardWritable(board);
    },
    { isolationLevel: 'read committed', accessMode: 'read only' },
  );
}

/**
 * `POST /api/boards/:boardId/cover/upload-url` (api.md §9): assina um `PUT` de 5 minutos com tipo e
 * tamanho, e devolve a chave. Não grava nada: a chave só existe no bucket se alguém usar a URL, e
 * o que não for confirmado vira órfão (recolhido pela limpeza diária).
 * Ordem: 400 → 404 → `403 BOARD_RESTRICTED` → `409 BOARD_ARCHIVED` → 503.
 */
export async function createCoverUploadUrl(
  db: Database,
  ctx: BoardActionContext,
  boardId: string,
  input: BoardCoverUploadUrlRequest,
): Promise<BoardCoverUploadUrlResponse> {
  await assertCoverWritable(db, boardId, ctx.actor);
  const storage = requireCoverStorage(ctx.coverStorage);
  const objectKey = newCoverObjectKey(boardId);
  const signed = storage.presignPut(objectKey, {
    contentType: input.contentType,
    contentLength: input.sizeBytes,
    expiresInSeconds: COVER_UPLOAD_TTL_SECONDS,
    now: ctx.now,
  });
  return {
    uploadUrl: signed.url,
    objectKey,
    expiresAt: toIso(new Date(ctx.now.getTime() + COVER_UPLOAD_TTL_SECONDS * 1000)),
    headers: signed.headers,
  };
}

/** Apaga o objeto sem derrubar a operação: falha vira log e órfão (ADR 0016, item 4). */
export async function deleteCoverObject(
  storage: R2Client | null,
  objectKey: string,
  log?: { warn: (obj: object, msg: string) => void },
): Promise<void> {
  if (!storage) return;
  try {
    await storage.deleteObject(objectKey);
  } catch (err) {
    log?.warn({ err }, 'falha ao apagar objeto de capa no R2 (vira órfão para a limpeza)');
  }
}

/**
 * `PUT /api/boards/:boardId/cover` (api.md §9): confirma o upload direto.
 * A API reconfere no R2 (objeto existe, tamanho, `Content-Type` gravado e os 16 primeiros bytes) e,
 * se algo não bate, apaga o objeto e responde `409 COVER_UPLOAD_INVALID`. A capa anterior é apagada
 * depois do commit.
 * Ordem: 400 → 404 → 403 → `409 BOARD_ARCHIVED` → 503 → `409 COVER_UPLOAD_INVALID`.
 */
export async function confirmBoardCover(
  db: Database,
  ctx: BoardActionContext,
  boardId: string,
  input: ConfirmBoardCoverRequest,
  log?: { warn: (obj: object, msg: string) => void },
): Promise<BoardDetail> {
  if (!isBoardCoverKey(input.objectKey, boardId)) {
    throw new AppError('VALIDATION_ERROR', COVER_KEY_INVALID_MESSAGE, {
      details: [{ path: 'objectKey', message: COVER_KEY_INVALID_MESSAGE }],
    });
  }
  await assertCoverWritable(db, boardId, ctx.actor);
  const storage = requireCoverStorage(ctx.coverStorage);

  const head = await withStorage(() => storage.head(input.objectKey));
  const contentType = head?.contentType?.split(';')[0]?.trim() ?? '';
  const typeOk = (BOARD_COVER_CONTENT_TYPES as readonly string[]).includes(contentType);
  const sizeOk =
    head !== null && head.contentLength >= 1 && head.contentLength <= BOARD_COVER_MAX_BYTES;
  const bytes =
    head === null ? null : await withStorage(() => storage.getRange(input.objectKey, 15));
  if (!head || !typeOk || !sizeOk || !bytes || !matchesCoverMagic(contentType, bytes)) {
    await deleteCoverObject(storage, input.objectKey, log);
    throw new AppError('COVER_UPLOAD_INVALID', COVER_UPLOAD_INVALID_MESSAGE);
  }

  const { detail, previousKey } = await db.transaction(async (tx) => {
    const board = await lockWritableBoard(tx, boardId, ctx.actor);
    const previous = await findBoardCover(tx, board.id);
    await upsertBoardCover(tx, {
      boardId: board.id,
      objectKey: input.objectKey,
      contentType,
      sizeBytes: head.contentLength,
      width: input.width ?? null,
      height: input.height ?? null,
      uploadedBy: ctx.actor.id,
      now: ctx.now,
    });
    return {
      detail: await loadBoardDetail(tx, board.id, coverReadContext(ctx)),
      previousKey: previous && previous.objectKey !== input.objectKey ? previous.objectKey : null,
    };
  });

  // Depois do commit: se falhar, o objeto antigo vira órfão e a limpeza diária o recolhe.
  if (previousKey) await deleteCoverObject(storage, previousKey, log);
  return detail;
}

/**
 * `DELETE /api/boards/:boardId/cover` (api.md §9): apaga o objeto e a linha. Idempotente (sem capa,
 * 200 sem mudança). Com o R2 fora do ar a linha **não** é apagada: a transação cai e a resposta
 * é `503 COVER_STORAGE_UNAVAILABLE`.
 */
export async function removeBoardCover(
  db: Database,
  ctx: BoardActionContext,
  boardId: string,
): Promise<BoardDetail> {
  // Ordem de api.md §3: 404 → 403 BOARD_RESTRICTED → 409 BOARD_ARCHIVED → 503.
  await assertCoverWritable(db, boardId, ctx.actor);
  const storage = requireCoverStorage(ctx.coverStorage);
  return db.transaction(async (tx) => {
    const board = await lockWritableBoard(tx, boardId, ctx.actor);
    const cover = await findBoardCover(tx, board.id);
    if (!cover) return loadBoardDetail(tx, board.id, coverReadContext(ctx));

    // Primeiro o objeto: se o R2 falhar, a linha continua (nada de capa apontando para o nada).
    await withStorage(() => storage.deleteObject(cover.objectKey));
    await deleteBoardCover(tx, board.id);
    return loadBoardDetail(tx, board.id, coverReadContext(ctx));
  });
}

/**
 * Limpeza diária (overview.md §5.2): varre o prefixo `covers/`, compara com `board_covers` e apaga
 * o que não tem linha e tem mais de 24 h — uploads iniciados e nunca confirmados, capas cuja
 * exclusão falhou e os restos das capas de card anteriores à migration 0009. Erro de rede não
 * interrompe as demais limpezas: quem chama decide.
 *
 * @returns quantos objetos foram apagados.
 */
export async function cleanupOrphanCovers(
  db: DbExecutor,
  storage: R2Client,
  now: Date,
  knownKeys: (db: DbExecutor, keys: string[]) => Promise<Set<string>>,
  log?: { warn: (obj: object, msg: string) => void },
): Promise<number> {
  let token: string | null = null;
  let deleted = 0;
  do {
    const page: Awaited<ReturnType<R2Client['listObjects']>> = await storage.listObjects(
      'covers/',
      {
        ...(token ? { continuationToken: token } : {}),
      },
    );
    const candidates = page.objects.filter(
      (object) =>
        object.lastModified !== null &&
        now.getTime() - object.lastModified.getTime() > COVER_ORPHAN_MIN_AGE_MS,
    );
    if (candidates.length > 0) {
      const alive = await knownKeys(
        db,
        candidates.map((object) => object.key),
      );
      for (const object of candidates) {
        if (alive.has(object.key)) continue;
        await deleteCoverObject(storage, object.key, log);
        deleted += 1;
      }
    }
    token = page.nextToken;
  } while (token !== null);
  return deleted;
}
