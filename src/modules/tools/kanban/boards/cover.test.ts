import {
  boardCoverUploadUrlResponseSchema,
  boardResponseSchema,
  boardsResponseSchema,
  createBoardResponseSchema,
  isBoardCoverKey,
  type Board,
} from '@raphasparda/ronin-shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { boardActor } from '../../../../../test/actor-context';
import { expectError, seedActor, seedTeam, type Actor } from '../../../../../test/actors';
import { createDbTestApp, createTestClock } from '../../../../../test/auth';
import { describeDb, useTestDatabase } from '../../../../../test/db';
import type { App } from '../../../../app';
import * as schema from '../../../../db/schema';
import { boardCovers } from '../../../../db/schema';
import { R2Error, type R2Client, type R2ListResult } from '../../../../lib/r2';
import { runMaintenance } from '../../../../plugins/maintenance';
import { COVER_UPLOAD_URL_RATE_LIMIT } from '../../../../plugins/rate-limit';

import { clearCoverUrlCache, COVER_ORPHAN_MIN_AGE_MS, COVER_READ_WINDOW_MS } from './cover';
import { getBoardPayload } from './service';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const NOT_AN_IMAGE = new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0, 0, 0, 0, 0, 0, 0, 0]);

interface FakeObject {
  body: Uint8Array;
  contentType: string;
  lastModified: Date;
}

/** Dublê do bucket: nenhum teste fala com a rede (o bucket real só existe na tarefa 11.9). */
function fakeR2() {
  const objects = new Map<string, FakeObject>();
  const deleted: string[] = [];
  let offline = false;

  const guard = () => {
    if (offline) throw new R2Error('bucket fora do ar');
  };

  const client: R2Client = {
    bucket: 'ronin-capas',
    presignPut(key, options) {
      return {
        url: `https://fake.r2/${key}?put=1&type=${options.contentType}&len=${options.contentLength}`,
        headers: { 'content-type': options.contentType },
      };
    },
    presignGet(key, options) {
      return `https://fake.r2/${key}?get=1&at=${options.now.getTime()}&exp=${options.expiresInSeconds}`;
    },
    head(key) {
      guard();
      const object = objects.get(key);
      return Promise.resolve(
        object ? { contentLength: object.body.length, contentType: object.contentType } : null,
      );
    },
    getRange(key, endInclusive) {
      guard();
      const object = objects.get(key);
      return Promise.resolve(object ? object.body.slice(0, endInclusive + 1) : null);
    },
    deleteObject(key) {
      guard();
      deleted.push(key);
      objects.delete(key);
      return Promise.resolve();
    },
    listObjects(prefix): Promise<R2ListResult> {
      guard();
      return Promise.resolve({
        objects: [...objects.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, object]) => ({
            key,
            size: object.body.length,
            lastModified: object.lastModified,
          })),
        nextToken: null,
      });
    },
  };

  return {
    client,
    objects,
    deleted,
    /** Simula o envio direto do navegador ao R2. */
    put(key: string, body: Uint8Array, contentType: string, lastModified = new Date()) {
      objects.set(key, { body, contentType, lastModified });
    },
    setOffline(value: boolean) {
      offline = value;
    },
  };
}

describeDb('capa do quadro (ronin_test)', () => {
  const { db, pool } = useTestDatabase();
  const clock = createTestClock();
  let app: App;
  let r2: ReturnType<typeof fakeR2>;
  let admin: Actor;
  let member: Actor;
  let outsider: Actor;

  beforeEach(async () => {
    clock.set(new Date('2026-09-16T12:03:00.000Z'));
    clearCoverUrlCache();
    r2 = fakeR2();
    app = await createDbTestApp({ clock: clock.now, coverStorage: r2.client });
    ({ admin, member } = await seedTeam(db(), clock.now()));
    outsider = await seedActor(db(), { role: 'member', name: 'Caio Membro' }, clock.now());
  });

  afterEach(async () => {
    await app.close();
  });

  async function newBoard(name = 'Quadro'): Promise<Board & { viewerIds: string[] }> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/boards',
      headers: member.headers,
      payload: { name },
    });
    expect(res.statusCode).toBe(201);
    return createBoardResponseSchema.parse(res.json()).board;
  }

  const uploadUrl = (boardId: string, body: object = { contentType: 'image/png', sizeBytes: 14 }) =>
    app.inject({
      method: 'POST',
      url: `/api/boards/${boardId}/cover/upload-url`,
      headers: member.headers,
      payload: body,
    });

  const confirm = (boardId: string, body: object, actor = member) =>
    app.inject({
      method: 'PUT',
      url: `/api/boards/${boardId}/cover`,
      headers: actor.headers,
      payload: body,
    });

  const removeCover = (boardId: string, actor = member) =>
    app.inject({ method: 'DELETE', url: `/api/boards/${boardId}/cover`, headers: actor.headers });

  /** Fluxo completo: pede a URL, "envia" ao R2 e confirma. */
  async function addCover(
    boardId: string,
    options: { body?: Uint8Array; contentType?: string; width?: number; height?: number } = {},
  ) {
    const contentType = options.contentType ?? 'image/png';
    const body = options.body ?? PNG;
    const signed = boardCoverUploadUrlResponseSchema.parse(
      (await uploadUrl(boardId, { contentType, sizeBytes: body.length })).json(),
    );
    r2.put(signed.objectKey, body, contentType, clock.now());
    const res = await confirm(boardId, {
      objectKey: signed.objectKey,
      ...(options.width === undefined ? {} : { width: options.width }),
      ...(options.height === undefined ? {} : { height: options.height }),
    });
    expect(res.statusCode).toBe(200);
    return { objectKey: signed.objectKey, board: boardResponseSchema.parse(res.json()).board };
  }

  describe('sem R2 configurado', () => {
    it('features.boardCovers = false e as três rotas respondem 503', async () => {
      const semR2 = await createDbTestApp({ clock: clock.now, coverStorage: null });
      try {
        const me = await semR2.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { cookie: member.cookie },
        });
        expect(me.json()).toMatchObject({ features: { boardCovers: false } });

        const board = createBoardResponseSchema.parse(
          (
            await semR2.inject({
              method: 'POST',
              url: '/api/boards',
              headers: member.headers,
              payload: { name: 'Sem capa' },
            })
          ).json(),
        ).board;
        expect(board.cover).toBeNull();

        expectError(
          await semR2.inject({
            method: 'POST',
            url: `/api/boards/${board.id}/cover/upload-url`,
            headers: member.headers,
            payload: { contentType: 'image/png', sizeBytes: 10 },
          }),
          503,
          'COVER_STORAGE_UNAVAILABLE',
        );
        expectError(
          await semR2.inject({
            method: 'PUT',
            url: `/api/boards/${board.id}/cover`,
            headers: member.headers,
            payload: { objectKey: `covers/${board.id}/abcdefghijklmnopqrstuvwxyz012345` },
          }),
          503,
          'COVER_STORAGE_UNAVAILABLE',
        );
        expectError(
          await semR2.inject({
            method: 'DELETE',
            url: `/api/boards/${board.id}/cover`,
            headers: member.headers,
          }),
          503,
          'COVER_STORAGE_UNAVAILABLE',
        );
      } finally {
        await semR2.close();
      }
    });
  });

  describe('POST /cover/upload-url', () => {
    it('assina a URL, devolve a chave do próprio quadro e não grava nada', async () => {
      const board = await newBoard();
      const res = await uploadUrl(board.id, { contentType: 'image/webp', sizeBytes: 2048 });
      expect(res.statusCode).toBe(200);
      const body = boardCoverUploadUrlResponseSchema.parse(res.json());
      expect(isBoardCoverKey(body.objectKey, board.id)).toBe(true);
      expect(body.uploadUrl).toContain('type=image/webp');
      expect(body.uploadUrl).toContain('len=2048');
      expect(body.headers).toEqual({ 'content-type': 'image/webp' });
      expect(body.expiresAt).toBe('2026-09-16T12:08:00.000Z');
      expect(await db().$count(boardCovers)).toBe(0);
      // Duas chamadas geram chaves diferentes (inadivinháveis).
      const outra = boardCoverUploadUrlResponseSchema.parse(
        (await uploadUrl(board.id, { contentType: 'image/webp', sizeBytes: 2048 })).json(),
      );
      expect(outra.objectKey).not.toBe(body.objectKey);
    });

    it('400 em tipo e tamanho fora da regra; 403 em quadro restrito sem acesso', async () => {
      const board = await newBoard();
      expectError(
        await uploadUrl(board.id, { contentType: 'image/gif', sizeBytes: 10 }),
        400,
        'VALIDATION_ERROR',
      );
      expectError(
        await uploadUrl(board.id, { contentType: 'image/png', sizeBytes: 5 * 1024 * 1024 + 1 }),
        400,
        'VALIDATION_ERROR',
      );

      await app.inject({
        method: 'PUT',
        url: `/api/boards/${board.id}/visibility`,
        headers: member.headers,
        payload: { visibility: 'restricted' },
      });
      expectError(
        await app.inject({
          method: 'POST',
          url: `/api/boards/${board.id}/cover/upload-url`,
          headers: outsider.headers,
          payload: { contentType: 'image/png', sizeBytes: 10 },
        }),
        403,
        'BOARD_RESTRICTED',
      );
    });

    it('limite de 30 pedidos / 5 min por usuário (api.md §9)', async () => {
      const board = await newBoard();
      for (let i = 0; i < COVER_UPLOAD_URL_RATE_LIMIT.max; i++) {
        expect((await uploadUrl(board.id)).statusCode).toBe(200);
      }
      const blocked = await uploadUrl(board.id);
      expectError(blocked, 429, 'RATE_LIMITED');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      // O limite é por usuário: outra pessoa continua pedindo normalmente.
      const res = await app.inject({
        method: 'POST',
        url: `/api/boards/${board.id}/cover/upload-url`,
        headers: outsider.headers,
        payload: { contentType: 'image/png', sizeBytes: 14 },
      });
      expect(res.statusCode).toBe(200);
    });

    it('R2 fora do ar não derruba a rota de URL (assinar é local)', async () => {
      const board = await newBoard();
      r2.setOffline(true);
      expect((await uploadUrl(board.id)).statusCode).toBe(200);
    });
  });

  describe('PUT /cover (confirmação)', () => {
    it('grava a capa e devolve a URL assinada, no quadro e na listagem', async () => {
      const board = await newBoard();
      const { objectKey, board: detail } = await addCover(board.id, { width: 1600, height: 900 });

      expect(detail.cover?.url).toContain(objectKey);
      expect(detail.cover).toMatchObject({
        width: 1600,
        height: 900,
        // Janela de 5 min iniciada em 12:00 + 15 min de validade.
        expiresAt: '2026-09-16T12:15:00.000Z',
      });
      const [row] = await db().select().from(boardCovers);
      expect(row).toMatchObject({
        objectKey,
        contentType: 'image/png',
        sizeBytes: PNG.length,
        width: 1600,
        height: 900,
        uploadedBy: member.user.id,
      });

      const listed = boardsResponseSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: '/api/boards',
            headers: { cookie: member.cookie },
          })
        ).json(),
      );
      const tile = listed.boards[0];
      expect(tile?.locked).toBe(false);
      expect(tile?.locked === false ? tile.cover?.url : null).toBe(detail.cover?.url);

      const payload = await app.inject({
        method: 'GET',
        url: `/api/boards/${board.id}`,
        headers: { cookie: member.cookie },
      });
      expect(payload.json()).toMatchObject({ board: { cover: { url: detail.cover?.url } } });
    });

    it('chave de outro quadro → 400 (IDOR de objectKey)', async () => {
      const board = await newBoard();
      const outro = await newBoard('Outro');
      const signed = boardCoverUploadUrlResponseSchema.parse((await uploadUrl(outro.id)).json());
      r2.put(signed.objectKey, PNG, 'image/png', clock.now());
      expectError(
        await confirm(board.id, { objectKey: signed.objectKey }),
        400,
        'VALIDATION_ERROR',
      );
      expect(await db().$count(boardCovers)).toBe(0);
    });

    it('objeto ausente, grande demais ou com bytes errados → 409 e o objeto é apagado', async () => {
      const board = await newBoard();

      // 1) nunca enviado
      const ausente = boardCoverUploadUrlResponseSchema.parse((await uploadUrl(board.id)).json());
      expectError(
        await confirm(board.id, { objectKey: ausente.objectKey }),
        409,
        'COVER_UPLOAD_INVALID',
      );

      // 2) acima do limite
      const grande = boardCoverUploadUrlResponseSchema.parse((await uploadUrl(board.id)).json());
      const bytes = new Uint8Array(5 * 1024 * 1024 + 1);
      bytes.set(PNG.slice(0, 8));
      r2.put(grande.objectKey, bytes, 'image/png', clock.now());
      expectError(
        await confirm(board.id, { objectKey: grande.objectKey }),
        409,
        'COVER_UPLOAD_INVALID',
      );
      expect(r2.deleted).toContain(grande.objectKey);

      // 3) tipo aceito, mas o conteúdo não é a imagem declarada (arquivo renomeado)
      const falso = boardCoverUploadUrlResponseSchema.parse((await uploadUrl(board.id)).json());
      r2.put(falso.objectKey, NOT_AN_IMAGE, 'image/png', clock.now());
      expectError(
        await confirm(board.id, { objectKey: falso.objectKey }),
        409,
        'COVER_UPLOAD_INVALID',
      );
      expect(r2.deleted).toContain(falso.objectKey);
      expect(r2.objects.size).toBe(0);

      // 4) tipo fora da lista gravado no objeto
      const gif = boardCoverUploadUrlResponseSchema.parse((await uploadUrl(board.id)).json());
      r2.put(gif.objectKey, PNG, 'image/gif', clock.now());
      expectError(
        await confirm(board.id, { objectKey: gif.objectKey }),
        409,
        'COVER_UPLOAD_INVALID',
      );

      expect(await db().$count(boardCovers)).toBe(0);
    });

    it('trocar a capa apaga o objeto anterior', async () => {
      const board = await newBoard();
      const first = await addCover(board.id);
      const second = await addCover(board.id, { body: JPEG, contentType: 'image/jpeg' });

      expect(r2.deleted).toEqual([first.objectKey]);
      expect([...r2.objects.keys()]).toEqual([second.objectKey]);
      expect(await db().$count(boardCovers)).toBe(1);
      expect(second.board.cover?.url).toContain(second.objectKey);
    });

    it('quadro arquivado → 409 BOARD_ARCHIVED (a capa só muda com o quadro ativo)', async () => {
      const board = await newBoard();
      await app.inject({
        method: 'POST',
        url: `/api/boards/${board.id}/archive`,
        headers: admin.headers,
      });
      expectError(await uploadUrl(board.id), 409, 'BOARD_ARCHIVED');
      expectError(await removeCover(board.id), 409, 'BOARD_ARCHIVED');
    });

    it('R2 fora do ar na confirmação → 503, nunca 500', async () => {
      const board = await newBoard();
      const signed = boardCoverUploadUrlResponseSchema.parse((await uploadUrl(board.id)).json());
      r2.put(signed.objectKey, PNG, 'image/png', clock.now());
      r2.setOffline(true);
      expectError(
        await confirm(board.id, { objectKey: signed.objectKey }),
        503,
        'COVER_STORAGE_UNAVAILABLE',
      );
    });
  });

  describe('DELETE /cover', () => {
    it('apaga objeto e linha e é idempotente', async () => {
      const board = await newBoard();
      const { objectKey } = await addCover(board.id);

      const res = await removeCover(board.id);
      expect(res.statusCode).toBe(200);
      expect(boardResponseSchema.parse(res.json()).board.cover).toBeNull();
      expect(r2.deleted).toEqual([objectKey]);
      expect(await db().$count(boardCovers)).toBe(0);

      expect((await removeCover(board.id)).statusCode).toBe(200);
    });

    it('R2 fora do ar → 503 e a linha continua', async () => {
      const board = await newBoard();
      await addCover(board.id);
      r2.setOffline(true);
      expectError(await removeCover(board.id), 503, 'COVER_STORAGE_UNAVAILABLE');
      expect(await db().$count(boardCovers)).toBe(1);
    });
  });

  describe('vazamento e cache da URL', () => {
    it('quadro bloqueado nunca traz capa nem sinal de que ela existe', async () => {
      const board = await newBoard();
      const { objectKey } = await addCover(board.id);
      await app.inject({
        method: 'PUT',
        url: `/api/boards/${board.id}/visibility`,
        headers: member.headers,
        payload: { visibility: 'restricted' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/boards',
        headers: { cookie: outsider.cookie },
      });
      expect(boardsResponseSchema.strict().parse(res.json()).boards).toEqual([
        { id: board.id, name: 'Quadro', locked: true },
      ]);
      expect(res.body).not.toContain(objectKey);
      expect(res.body).not.toContain('fake.r2');
    });

    it('duas leituras na mesma janela devolvem a mesma URL; a janela seguinte muda', async () => {
      const board = await newBoard();
      await addCover(board.id);
      const urlAt = async () => {
        const listed = boardsResponseSchema.parse(
          (
            await app.inject({
              method: 'GET',
              url: '/api/boards',
              headers: { cookie: member.cookie },
            })
          ).json(),
        );
        const tile = listed.boards[0];
        return tile?.locked === false ? tile.cover?.url : undefined;
      };

      const first = await urlAt();
      clock.advance(30_000); // polling da home
      expect(await urlAt()).toBe(first);
      clock.advance(COVER_READ_WINDOW_MS);
      expect(await urlAt()).not.toBe(first);
    });
  });

  describe('desempenho e sessão', () => {
    it('features.boardCovers = true com R2 configurado', async () => {
      const me = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: member.cookie },
      });
      expect(me.json()).toMatchObject({ features: { boardCovers: true } });
    });

    it('payload do quadro continua em 6 consultas com capa (assinar é local)', async () => {
      const board = await newBoard();
      await addCover(board.id);
      const lists = createBoardResponseSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/api/boards/${board.id}`,
            headers: { cookie: member.cookie },
          })
        ).json(),
      ).lists;
      const card = await app.inject({
        method: 'POST',
        url: `/api/lists/${lists[0]?.id ?? ''}/cards`,
        headers: member.headers,
        payload: { title: 'Card' },
      });
      expect(card.statusCode).toBe(201);

      const logged: string[] = [];
      const counting = drizzle({
        client: pool(),
        schema,
        logger: { logQuery: (query) => logged.push(query) },
      });
      const payload = await getBoardPayload(counting, board.id, boardActor(member), {
        storage: r2.client,
        now: clock.now(),
      });
      expect(payload.board.cover).not.toBeNull();
      const queries = logged.filter((query) => !/^(begin|commit|rollback)/i.test(query.trim()));
      expect(queries).toHaveLength(6);
    });
  });

  describe('ciclo de vida do objeto', () => {
    it('excluir o quadro (Admin) apaga o objeto', async () => {
      const board = await newBoard();
      const { objectKey } = await addCover(board.id);
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/boards/${board.id}`,
        headers: admin.headers,
        payload: { confirmName: 'Quadro' },
      });
      expect(res.statusCode).toBe(204);
      expect(r2.deleted).toEqual([objectKey]);
    });

    it('limpeza apaga só órfão com mais de 24 h', async () => {
      const board = await newBoard();
      const { objectKey } = await addCover(board.id);

      const orfaoNovo = `covers/${board.id}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
      const orfaoVelho = `covers/${board.id}/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`;
      r2.put(orfaoNovo, PNG, 'image/png', new Date(clock.now().getTime() - 60_000));
      r2.put(
        orfaoVelho,
        PNG,
        'image/png',
        new Date(clock.now().getTime() - COVER_ORPHAN_MIN_AGE_MS - 60_000),
      );

      const result = await runMaintenance(db(), clock.now(), { coverStorage: r2.client });
      expect(result.coverObjects).toBe(1);
      expect(r2.deleted).toEqual([orfaoVelho]);
      expect([...r2.objects.keys()].sort()).toEqual([objectKey, orfaoNovo].sort());
    });
  });
});
