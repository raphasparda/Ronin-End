import {
  boardPayloadSchema,
  cardCoverUploadUrlResponseSchema,
  cardDetailResponseSchema,
  cardSummaryResponseSchema,
  createBoardResponseSchema,
  isCardCoverKey,
  type ActivityType,
  type List,
} from '@raphasparda/ronin-shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { expectError, seedActor, seedTeam, type Actor } from '../../../test/actors';
import { createDbTestApp, createTestClock } from '../../../test/auth';
import { cardActor, unlockedCard } from '../../../test/cards';
import { describeDb, useTestDatabase } from '../../../test/db';
import type { App } from '../../app';
import * as schema from '../../db/schema';
import { cardActivities, cardCovers, cards, cardViewers } from '../../db/schema';
import { R2Error, type R2Client, type R2ListResult } from '../../lib/r2';
import { runMaintenance } from '../../plugins/maintenance';
import { getBoardPayload } from '../boards/service';

import { clearCoverUrlCache, COVER_ORPHAN_MIN_AGE_MS, COVER_READ_WINDOW_MS } from './cover';

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

describeDb('capa do card (kanban_test)', () => {
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

  async function newBoard() {
    const res = await app.inject({
      method: 'POST',
      url: '/api/boards',
      headers: member.headers,
      payload: { name: 'Quadro' },
    });
    const body = createBoardResponseSchema.parse(res.json());
    const [todo] = body.lists;
    if (!todo) throw new Error('listas padrão ausentes');
    return { board: body.board, todo };
  }

  async function newCard(list: Pick<List, 'id'>, title = 'Peça gráfica') {
    const res = await app.inject({
      method: 'POST',
      url: `/api/lists/${list.id}/cards`,
      headers: member.headers,
      payload: { title },
    });
    return cardSummaryResponseSchema.parse(res.json()).card;
  }

  const uploadUrl = (cardId: string, body: object = { contentType: 'image/png', sizeBytes: 14 }) =>
    app.inject({
      method: 'POST',
      url: `/api/cards/${cardId}/cover/upload-url`,
      headers: member.headers,
      payload: body,
    });

  const confirm = (cardId: string, body: object, actor = member) =>
    app.inject({
      method: 'PUT',
      url: `/api/cards/${cardId}/cover`,
      headers: actor.headers,
      payload: body,
    });

  const removeCover = (cardId: string, actor = member) =>
    app.inject({ method: 'DELETE', url: `/api/cards/${cardId}/cover`, headers: actor.headers });

  /** Fluxo completo: pede a URL, "envia" ao R2 e confirma. */
  async function addCover(
    cardId: string,
    options: { body?: Uint8Array; contentType?: string; width?: number; height?: number } = {},
  ) {
    const contentType = options.contentType ?? 'image/png';
    const body = options.body ?? PNG;
    const signed = cardCoverUploadUrlResponseSchema.parse(
      (await uploadUrl(cardId, { contentType, sizeBytes: body.length })).json(),
    );
    r2.put(signed.objectKey, body, contentType, clock.now());
    const res = await confirm(cardId, {
      objectKey: signed.objectKey,
      ...(options.width === undefined ? {} : { width: options.width }),
      ...(options.height === undefined ? {} : { height: options.height }),
    });
    expect(res.statusCode).toBe(200);
    return { objectKey: signed.objectKey, card: cardDetailResponseSchema.parse(res.json()).card };
  }

  async function activityTypes(cardId: string): Promise<ActivityType[]> {
    const rows = await db()
      .select({ type: cardActivities.type })
      .from(cardActivities)
      .where(eq(cardActivities.cardId, cardId));
    return rows.map((row) => row.type);
  }

  describe('sem R2 configurado', () => {
    it('features.cardCovers = false e as três rotas respondem 503', async () => {
      const semR2 = await createDbTestApp({ clock: clock.now, coverStorage: null });
      try {
        const me = await semR2.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { cookie: member.cookie },
        });
        expect(me.json()).toMatchObject({ features: { cardCovers: false } });

        const board = createBoardResponseSchema.parse(
          (
            await semR2.inject({
              method: 'POST',
              url: '/api/boards',
              headers: member.headers,
              payload: { name: 'Sem capa' },
            })
          ).json(),
        );
        const list = board.lists[0];
        const card = cardSummaryResponseSchema.parse(
          (
            await semR2.inject({
              method: 'POST',
              url: `/api/lists/${list?.id ?? ''}/cards`,
              headers: member.headers,
              payload: { title: 'Card' },
            })
          ).json(),
        ).card;
        expect(card.cover).toBeNull();

        expectError(
          await semR2.inject({
            method: 'POST',
            url: `/api/cards/${card.id}/cover/upload-url`,
            headers: member.headers,
            payload: { contentType: 'image/png', sizeBytes: 10 },
          }),
          503,
          'COVER_STORAGE_UNAVAILABLE',
        );
        expectError(
          await semR2.inject({
            method: 'PUT',
            url: `/api/cards/${card.id}/cover`,
            headers: member.headers,
            payload: { objectKey: `covers/${card.id}/abcdefghijklmnopqrstuvwxyz012345` },
          }),
          503,
          'COVER_STORAGE_UNAVAILABLE',
        );
        expectError(
          await semR2.inject({
            method: 'DELETE',
            url: `/api/cards/${card.id}/cover`,
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
    it('assina a URL, devolve a chave do próprio card e não grava nada', async () => {
      const { todo } = await newBoard();
      const card = await newCard(todo);
      const res = await uploadUrl(card.id, { contentType: 'image/webp', sizeBytes: 2048 });
      expect(res.statusCode).toBe(200);
      const body = cardCoverUploadUrlResponseSchema.parse(res.json());
      expect(isCardCoverKey(body.objectKey, card.id)).toBe(true);
      expect(body.uploadUrl).toContain('type=image/webp');
      expect(body.uploadUrl).toContain('len=2048');
      expect(body.headers).toEqual({ 'content-type': 'image/webp' });
      expect(body.expiresAt).toBe('2026-09-16T12:08:00.000Z');
      expect(await db().$count(cardCovers)).toBe(0);
      // Duas chamadas geram chaves diferentes (inadivinháveis).
      const outra = cardCoverUploadUrlResponseSchema.parse(
        (await uploadUrl(card.id, { contentType: 'image/webp', sizeBytes: 2048 })).json(),
      );
      expect(outra.objectKey).not.toBe(body.objectKey);
    });

    it('400 em tipo e tamanho fora da regra; 403 em card restrito sem acesso', async () => {
      const { todo } = await newBoard();
      const card = await newCard(todo);
      expectError(
        await uploadUrl(card.id, { contentType: 'image/gif', sizeBytes: 10 }),
        400,
        'VALIDATION_ERROR',
      );
      expectError(
        await uploadUrl(card.id, { contentType: 'image/png', sizeBytes: 5 * 1024 * 1024 + 1 }),
        400,
        'VALIDATION_ERROR',
      );

      await db().update(cards).set({ visibility: 'restricted' }).where(eq(cards.id, card.id));
      await db().insert(cardViewers).values({
        cardId: card.id,
        userId: member.user.id,
        addedBy: member.user.id,
        createdAt: clock.now(),
      });
      expectError(
        await app.inject({
          method: 'POST',
          url: `/api/cards/${card.id}/cover/upload-url`,
          headers: outsider.headers,
          payload: { contentType: 'image/png', sizeBytes: 10 },
        }),
        403,
        'CARD_RESTRICTED',
      );
    });

    it('R2 fora do ar não derruba a rota de URL (assinar é local)', async () => {
      const { todo } = await newBoard();
      const card = await newCard(todo);
      r2.setOffline(true);
      expect((await uploadUrl(card.id)).statusCode).toBe(200);
    });
  });

  describe('PUT /cover (confirmação)', () => {
    it('grava a capa, registra atividade e devolve a URL assinada', async () => {
      const { board, todo } = await newBoard();
      const card = await newCard(todo);
      const { objectKey, card: detail } = await addCover(card.id, { width: 1600, height: 900 });

      expect(detail.cover?.url).toContain(objectKey);
      expect(detail.cover).toMatchObject({
        width: 1600,
        height: 900,
        // Janela de 5 min iniciada em 12:00 + 15 min de validade.
        expiresAt: '2026-09-16T12:15:00.000Z',
      });
      expect(await activityTypes(card.id)).toEqual(['card_created', 'card_cover_changed']);
      const [row] = await db().select().from(cardCovers);
      expect(row).toMatchObject({
        objectKey,
        contentType: 'image/png',
        sizeBytes: PNG.length,
        width: 1600,
        height: 900,
        uploadedBy: member.user.id,
      });

      const payload = boardPayloadSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/api/boards/${board.id}`,
            headers: { cookie: member.cookie },
          })
        ).json(),
      );
      expect(unlockedCard(payload.cards[0]).cover?.url).toBe(detail.cover?.url);
    });

    it('chave de outro card → 400 (IDOR de objectKey)', async () => {
      const { todo } = await newBoard();
      const card = await newCard(todo);
      const outro = await newCard(todo, 'Outro');
      const signed = cardCoverUploadUrlResponseSchema.parse((await uploadUrl(outro.id)).json());
      r2.put(signed.objectKey, PNG, 'image/png', clock.now());
      expectError(await confirm(card.id, { objectKey: signed.objectKey }), 400, 'VALIDATION_ERROR');
      expect(await db().$count(cardCovers)).toBe(0);
    });

    it('objeto ausente, grande demais ou com bytes errados → 409 e o objeto é apagado', async () => {
      const { todo } = await newBoard();
      const card = await newCard(todo);

      // 1) nunca enviado
      const ausente = cardCoverUploadUrlResponseSchema.parse((await uploadUrl(card.id)).json());
      expectError(
        await confirm(card.id, { objectKey: ausente.objectKey }),
        409,
        'COVER_UPLOAD_INVALID',
      );

      // 2) acima do limite
      const grande = cardCoverUploadUrlResponseSchema.parse((await uploadUrl(card.id)).json());
      const bytes = new Uint8Array(5 * 1024 * 1024 + 1);
      bytes.set(PNG.slice(0, 8));
      r2.put(grande.objectKey, bytes, 'image/png', clock.now());
      expectError(
        await confirm(card.id, { objectKey: grande.objectKey }),
        409,
        'COVER_UPLOAD_INVALID',
      );
      expect(r2.deleted).toContain(grande.objectKey);

      // 3) tipo aceito, mas o conteúdo não é a imagem declarada (arquivo renomeado)
      const falso = cardCoverUploadUrlResponseSchema.parse((await uploadUrl(card.id)).json());
      r2.put(falso.objectKey, NOT_AN_IMAGE, 'image/png', clock.now());
      expectError(
        await confirm(card.id, { objectKey: falso.objectKey }),
        409,
        'COVER_UPLOAD_INVALID',
      );
      expect(r2.deleted).toContain(falso.objectKey);
      expect(r2.objects.size).toBe(0);

      // 4) tipo fora da lista gravado no objeto
      const gif = cardCoverUploadUrlResponseSchema.parse((await uploadUrl(card.id)).json());
      r2.put(gif.objectKey, PNG, 'image/gif', clock.now());
      expectError(
        await confirm(card.id, { objectKey: gif.objectKey }),
        409,
        'COVER_UPLOAD_INVALID',
      );

      expect(await db().$count(cardCovers)).toBe(0);
      expect(await activityTypes(card.id)).toEqual(['card_created']);
    });

    it('trocar a capa apaga o objeto anterior', async () => {
      const { todo } = await newBoard();
      const card = await newCard(todo);
      const first = await addCover(card.id);
      const second = await addCover(card.id, { body: JPEG, contentType: 'image/jpeg' });

      expect(r2.deleted).toEqual([first.objectKey]);
      expect([...r2.objects.keys()]).toEqual([second.objectKey]);
      expect(await db().$count(cardCovers)).toBe(1);
      expect(second.card.cover?.url).toContain(second.objectKey);
      expect(await activityTypes(card.id)).toEqual([
        'card_created',
        'card_cover_changed',
        'card_cover_changed',
      ]);
    });

    it('R2 fora do ar na confirmação → 503, nunca 500', async () => {
      const { todo } = await newBoard();
      const card = await newCard(todo);
      const signed = cardCoverUploadUrlResponseSchema.parse((await uploadUrl(card.id)).json());
      r2.put(signed.objectKey, PNG, 'image/png', clock.now());
      r2.setOffline(true);
      expectError(
        await confirm(card.id, { objectKey: signed.objectKey }),
        503,
        'COVER_STORAGE_UNAVAILABLE',
      );
    });
  });

  describe('DELETE /cover', () => {
    it('apaga objeto e linha, registra atividade e é idempotente', async () => {
      const { todo } = await newBoard();
      const card = await newCard(todo);
      const { objectKey } = await addCover(card.id);

      const res = await removeCover(card.id);
      expect(res.statusCode).toBe(200);
      expect(cardDetailResponseSchema.parse(res.json()).card.cover).toBeNull();
      expect(r2.deleted).toEqual([objectKey]);
      expect(await db().$count(cardCovers)).toBe(0);

      expect((await removeCover(card.id)).statusCode).toBe(200);
      expect(await activityTypes(card.id)).toEqual([
        'card_created',
        'card_cover_changed',
        'card_cover_removed',
      ]);
    });

    it('R2 fora do ar → 503 e a linha continua', async () => {
      const { todo } = await newBoard();
      const card = await newCard(todo);
      await addCover(card.id);
      r2.setOffline(true);
      expectError(await removeCover(card.id), 503, 'COVER_STORAGE_UNAVAILABLE');
      expect(await db().$count(cardCovers)).toBe(1);
    });
  });

  describe('vazamento e cache da URL', () => {
    it('card bloqueado nunca traz capa nem sinal de que ela existe', async () => {
      const { board, todo } = await newBoard();
      const card = await newCard(todo);
      const { objectKey } = await addCover(card.id);
      await db().update(cards).set({ visibility: 'restricted' }).where(eq(cards.id, card.id));
      await db().insert(cardViewers).values({
        cardId: card.id,
        userId: member.user.id,
        addedBy: member.user.id,
        createdAt: clock.now(),
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/boards/${board.id}`,
        headers: { cookie: outsider.cookie },
      });
      const payload = boardPayloadSchema.strict().parse(res.json());
      expect(payload.cards).toEqual([
        {
          id: card.id,
          listId: todo.id,
          position: card.position,
          title: 'Peça gráfica',
          locked: true,
        },
      ]);
      expect(res.body).not.toContain(objectKey);
      expect(res.body).not.toContain('fake.r2');
    });

    it('duas leituras na mesma janela devolvem a mesma URL; a janela seguinte muda', async () => {
      const { board, todo } = await newBoard();
      const card = await newCard(todo);
      await addCover(card.id);
      const urlAt = async () => {
        const payload = boardPayloadSchema.parse(
          (
            await app.inject({
              method: 'GET',
              url: `/api/boards/${board.id}`,
              headers: { cookie: member.cookie },
            })
          ).json(),
        );
        return unlockedCard(payload.cards[0]).cover?.url;
      };

      const first = await urlAt();
      clock.advance(30_000); // polling do quadro
      expect(await urlAt()).toBe(first);
      clock.advance(COVER_READ_WINDOW_MS);
      expect(await urlAt()).not.toBe(first);
    });
  });

  describe('desempenho e sessão', () => {
    it('features.cardCovers = true com R2 configurado', async () => {
      const me = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: member.cookie },
      });
      expect(me.json()).toMatchObject({ features: { cardCovers: true } });
    });

    it('payload do quadro continua em 6 consultas com capas (assinar é local)', async () => {
      const { board, todo } = await newBoard();
      for (let i = 0; i < 5; i++) {
        const card = await newCard(todo, `Card ${i}`);
        await addCover(card.id);
      }
      const logged: string[] = [];
      const counting = drizzle({
        client: pool(),
        schema,
        logger: { logQuery: (query) => logged.push(query) },
      });
      const payload = await getBoardPayload(counting, board.id, cardActor(member), {
        storage: r2.client,
        now: clock.now(),
      });
      expect(payload.cards).toHaveLength(5);
      const queries = logged.filter((query) => !/^(begin|commit|rollback)/i.test(query.trim()));
      expect(queries).toHaveLength(6);
    });
  });

  describe('ciclo de vida do objeto', () => {
    it('excluir o card (Admin) apaga o objeto', async () => {
      const { todo } = await newBoard();
      const card = await newCard(todo);
      const { objectKey } = await addCover(card.id);
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/cards/${card.id}`,
        headers: admin.headers,
      });
      expect(res.statusCode).toBe(204);
      expect(r2.deleted).toEqual([objectKey]);
    });

    it('excluir o quadro (Admin) apaga os objetos dos cards', async () => {
      const { board, todo } = await newBoard();
      const a = await newCard(todo, 'A');
      const b = await newCard(todo, 'B');
      const first = await addCover(a.id);
      const second = await addCover(b.id, { body: JPEG, contentType: 'image/jpeg' });
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/boards/${board.id}`,
        headers: admin.headers,
        payload: { confirmName: 'Quadro' },
      });
      expect(res.statusCode).toBe(204);
      expect([...r2.deleted].sort()).toEqual([first.objectKey, second.objectKey].sort());
    });

    it('limpeza apaga só órfão com mais de 24 h', async () => {
      const { todo } = await newBoard();
      const card = await newCard(todo);
      const { objectKey } = await addCover(card.id);

      const orfaoNovo = `covers/${card.id}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
      const orfaoVelho = `covers/${card.id}/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`;
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
