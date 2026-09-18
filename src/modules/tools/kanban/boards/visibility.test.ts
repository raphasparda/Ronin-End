import {
  boardResponseSchema,
  boardViewersResponseSchema,
  createBoardResponseSchema,
  type BoardDetail,
} from '@raphasparda/ronin-shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  expectError,
  MISSING_ID,
  seedActor,
  seedTeam,
  type Actor,
} from '../../../../../test/actors';
import { createDbTestApp, createTestClock } from '../../../../../test/auth';
import { describeDb, useTestDatabase } from '../../../../../test/db';
import type { App } from '../../../../app';
import { boardViewers, users } from '../../../../db/schema';

/**
 * Rotas de visibilidade e lista de acesso do quadro (api.md §9, ADR 0015).
 * O efeito do acesso nas outras rotas está em `restricted.test.ts`.
 */
describeDb('visibilidade e lista de acesso do quadro (ronin_test)', () => {
  const { db } = useTestDatabase();
  const clock = createTestClock();
  let app: App;
  let admin: Actor;
  let creator: Actor;
  let other: Actor;

  beforeEach(async () => {
    clock.set(new Date('2026-09-17T09:00:00.000Z'));
    app = await createDbTestApp({ clock: clock.now });
    ({ admin, member: creator } = await seedTeam(db(), clock.now()));
    other = await seedActor(db(), { role: 'member', name: 'Caio Membro' }, clock.now());
  });

  afterEach(async () => {
    await app.close();
  });

  /** Quadro criado por `creator` (é ele quem entra na lista inicial junto com o ator). */
  async function newBoard(name = 'Diretoria') {
    const res = await app.inject({
      method: 'POST',
      url: '/api/boards',
      headers: creator.headers,
      payload: { name },
    });
    expect(res.statusCode).toBe(201);
    return createBoardResponseSchema.parse(res.json()).board;
  }

  const setVisibility = (boardId: string, visibility: string, actor: Actor) =>
    app.inject({
      method: 'PUT',
      url: `/api/boards/${boardId}/visibility`,
      headers: actor.headers,
      payload: { visibility },
    });

  const addViewer = (boardId: string, userId: string, actor: Actor) =>
    app.inject({
      method: 'PUT',
      url: `/api/boards/${boardId}/viewers/${userId}`,
      headers: actor.headers,
    });

  const removeViewer = (boardId: string, userId: string, actor: Actor) =>
    app.inject({
      method: 'DELETE',
      url: `/api/boards/${boardId}/viewers/${userId}`,
      headers: actor.headers,
    });

  const board = (res: { json: () => unknown }): BoardDetail =>
    boardResponseSchema.parse(res.json()).board;

  describe('PUT /visibility', () => {
    it('restringir inclui o ator e o criador do quadro (RN30) e é idempotente', async () => {
      const created = await newBoard();
      // Quem restringe é o Admin: entram Admin (ator) e `creator` (criador).
      const res = await setVisibility(created.id, 'restricted', admin);
      expect(res.statusCode).toBe(200);
      const detail = board(res);
      expect(detail.visibility).toBe('restricted');
      expect(detail.viewerIds).toEqual([admin.user.id, creator.user.id].sort());

      // Chamar de novo não duplica nada.
      const again = board(await setVisibility(created.id, 'restricted', admin));
      expect(again.viewerIds).toEqual(detail.viewerIds);
      expect(await db().$count(boardViewers)).toBe(2);
    });

    it('voltar para team apaga a lista de acesso', async () => {
      const created = await newBoard();
      await setVisibility(created.id, 'restricted', creator);
      await addViewer(created.id, other.user.id, creator);
      expect(await db().$count(boardViewers)).toBe(2);

      const detail = board(await setVisibility(created.id, 'team', creator));
      expect(detail).toMatchObject({ visibility: 'team', viewerIds: [] });
      expect(await db().$count(boardViewers)).toBe(0);
      // E todo mundo volta a abrir o quadro.
      const res = await app.inject({
        method: 'GET',
        url: `/api/boards/${created.id}`,
        headers: { cookie: other.cookie },
      });
      expect(res.statusCode).toBe(200);
    });

    it('criador anonimizado fica de fora da lista inicial (RN38)', async () => {
      const created = await newBoard();
      await db()
        .update(users)
        .set({
          status: 'deactivated',
          anonymizedAt: clock.now(),
          email: null,
          passwordHash: null,
          name: 'Usuário removido',
        })
        .where(eq(users.id, creator.user.id));

      const detail = board(await setVisibility(created.id, 'restricted', admin));
      expect(detail.viewerIds).toEqual([admin.user.id]);
    });

    it('quadro arquivado → 409 BOARD_ARCHIVED; valor inválido → 400', async () => {
      const created = await newBoard();
      expectError(await setVisibility(created.id, 'privado', creator), 400, 'VALIDATION_ERROR');

      await app.inject({
        method: 'POST',
        url: `/api/boards/${created.id}/archive`,
        headers: admin.headers,
      });
      expectError(await setVisibility(created.id, 'restricted', creator), 409, 'BOARD_ARCHIVED');
    });

    it('quadro inexistente → 404; sem sessão → 401; sem CSRF → 403', async () => {
      const created = await newBoard();
      expectError(await setVisibility(MISSING_ID, 'restricted', creator), 404, 'NOT_FOUND');
      expectError(
        await app.inject({
          method: 'PUT',
          url: `/api/boards/${created.id}/visibility`,
          payload: { visibility: 'restricted' },
        }),
        401,
        'UNAUTHENTICATED',
      );
      expectError(
        await app.inject({
          method: 'PUT',
          url: `/api/boards/${created.id}/visibility`,
          headers: { cookie: creator.cookie },
          payload: { visibility: 'restricted' },
        }),
        403,
        'CSRF_REJECTED',
      );
    });
  });

  describe('PUT|DELETE /viewers/:userId', () => {
    it('adiciona e remove, em ordem de inclusão e de forma idempotente', async () => {
      const created = await newBoard();
      await setVisibility(created.id, 'restricted', creator);

      const added = boardViewersResponseSchema.parse(
        (await addViewer(created.id, other.user.id, creator)).json(),
      );
      // Ordem: created_at, depois user_id (relógio parado no teste, então vale o id).
      expect(added.viewerIds).toEqual([creator.user.id, other.user.id].sort());
      const again = boardViewersResponseSchema.parse(
        (await addViewer(created.id, other.user.id, creator)).json(),
      );
      expect(again.viewerIds).toEqual(added.viewerIds);

      const removed = boardViewersResponseSchema.parse(
        (await removeViewer(created.id, other.user.id, creator)).json(),
      );
      expect(removed.viewerIds).toEqual([creator.user.id]);
      // Remover de novo é no-op.
      expect((await removeViewer(created.id, other.user.id, creator)).statusCode).toBe(200);
    });

    it('quadro da equipe → 409 BOARD_NOT_RESTRICTED; usuário inexistente → 404', async () => {
      const created = await newBoard();
      expectError(await addViewer(created.id, other.user.id, creator), 409, 'BOARD_NOT_RESTRICTED');
      expectError(
        await removeViewer(created.id, other.user.id, creator),
        409,
        'BOARD_NOT_RESTRICTED',
      );
      await setVisibility(created.id, 'restricted', creator);
      expectError(await addViewer(created.id, MISSING_ID, creator), 404, 'NOT_FOUND');
    });

    it('usuário desativado ou anonimizado → 409 USER_NOT_ACTIVE (RN37)', async () => {
      const created = await newBoard();
      await setVisibility(created.id, 'restricted', creator);
      await db().update(users).set({ status: 'deactivated' }).where(eq(users.id, other.user.id));
      expectError(await addViewer(created.id, other.user.id, creator), 409, 'USER_NOT_ACTIVE');
    });

    it('quem se remove perde o acesso na hora; Admin devolve', async () => {
      const created = await newBoard();
      await setVisibility(created.id, 'restricted', creator);
      expect((await removeViewer(created.id, creator.user.id, creator)).statusCode).toBe(200);

      expectError(
        await app.inject({
          method: 'GET',
          url: `/api/boards/${created.id}`,
          headers: { cookie: creator.cookie },
        }),
        403,
        'BOARD_RESTRICTED',
      );
      // Admin alcança o quadro mesmo fora da lista e devolve o acesso.
      expect((await addViewer(created.id, creator.user.id, admin)).statusCode).toBe(200);
      const back = await app.inject({
        method: 'GET',
        url: `/api/boards/${created.id}`,
        headers: { cookie: creator.cookie },
      });
      expect(back.statusCode).toBe(200);
    });

    it('anonimizar tira a pessoa de todas as listas de acesso (RN38)', async () => {
      const created = await newBoard();
      await setVisibility(created.id, 'restricted', creator);
      await addViewer(created.id, other.user.id, creator);
      expect(await db().$count(boardViewers)).toBe(2);

      await app.inject({
        method: 'POST',
        url: `/api/admin/users/${other.user.id}/deactivate`,
        headers: admin.headers,
      });
      const anonymized = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${other.user.id}/anonymize`,
        headers: admin.headers,
        payload: { confirm: true },
      });
      expect(anonymized.statusCode).toBe(200);
      const rows = await db().select().from(boardViewers);
      expect(rows.map((row) => row.userId)).toEqual([creator.user.id]);
    });

    it('quadro restrito sem acesso: mexer na lista é 403 (só quem está dentro ou Admin)', async () => {
      const created = await newBoard();
      await setVisibility(created.id, 'restricted', creator);
      expectError(await addViewer(created.id, other.user.id, other), 403, 'BOARD_RESTRICTED');
      expectError(await removeViewer(created.id, creator.user.id, other), 403, 'BOARD_RESTRICTED');
      // Admin pode.
      expect((await addViewer(created.id, other.user.id, admin)).statusCode).toBe(200);
    });
  });
});
