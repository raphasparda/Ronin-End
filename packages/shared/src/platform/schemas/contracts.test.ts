import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as shared from '../../index';
import {
  ID,
  T0,
  TOKEN,
  activity,
  adminUser,
  board,
  boardDetail,
  cardDetail,
  cardSummary,
  checklist,
  comment,
  invite,
  label,
  list,
  lockedBoard,
  notification,
  userSummary,
} from '../../test-fixtures';

const session = {
  user: { id: ID.user, name: 'Ana', email: 'ana@exemplo.com', role: 'admin', avatarUpdatedAt: T0 },
  workspace: { name: 'Equipe', timezone: 'America/Sao_Paulo' },
  features: { boardCovers: true },
};
const myCard = { ...cardSummary, boardName: 'Marketing', listName: 'A fazer', listColor: 'blue' };

/** Exemplo válido para cada schema de resposta (nome do export → corpo). */
const responseSamples: Record<string, unknown> = {
  healthResponseSchema: { status: 'ok', db: 'ok' },
  errorResponseSchema: { error: { code: 'NOT_FOUND', message: 'Não encontrado.' } },
  setupStatusResponseSchema: { needsSetup: false, requiresSetupToken: true },
  authSessionResponseSchema: session,
  inviteLookupResponseSchema: { email: 'bia@exemplo.com', role: 'member', expiresAt: T0 },
  passwordResetLookupResponseSchema: { userName: 'Bia', expiresAt: T0 },
  usersResponseSchema: { users: [userSummary] },
  adminUsersResponseSchema: { users: [adminUser] },
  adminUserResponseSchema: { user: adminUser },
  passwordResetLinkResponseSchema: { url: 'https://x/redefinir-senha#token=t', expiresAt: T0 },
  invitesResponseSchema: { invites: [invite] },
  createInviteResponseSchema: { invite, url: 'https://x/convite#token=t' },
  workspaceResponseSchema: { workspace: session.workspace },
  updateMeResponseSchema: { user: session.user },
  myCardsResponseSchema: { cards: [myCard] },
  boardsResponseSchema: { boards: [board, lockedBoard] },
  createBoardResponseSchema: { board: boardDetail, lists: [list] },
  boardPayloadSchema: { board: boardDetail, lists: [list], cards: [cardSummary], labels: [label] },
  boardResponseSchema: { board: boardDetail },
  boardViewersResponseSchema: { viewerIds: [ID.user] },
  boardCoverUploadUrlResponseSchema: {
    uploadUrl: 'https://bucket.exemplo/covers/x?X-Amz-Signature=abc',
    objectKey: `covers/${ID.board}/abcdefghijklmnopqrstuvwxyz012345`,
    expiresAt: T0,
    headers: { 'content-type': 'image/png' },
  },
  boardArchivedResponseSchema: {
    lists: [{ ...list, archivedAt: T0 }],
    cards: [{ ...cardSummary, archivedAt: T0, listName: 'A fazer', listArchived: false }],
  },
  listResponseSchema: { list },
  updateListResponseSchema: { lists: [list], completedCardIds: [] },
  cardSummaryResponseSchema: { card: cardSummary },
  cardDetailResponseSchema: { card: cardDetail },
  cardMutationResultSchema: {
    card: cardSummary,
    completionChange: 'completed',
    removedLabelIds: [],
  },
  cardAssigneesResponseSchema: { assigneeIds: [ID.user] },
  cardLabelsResponseSchema: { labelIds: [ID.label] },
  activitiesResponseSchema: { activities: [activity] },
  labelResponseSchema: { label },
  checklistResponseSchema: { checklist },
  checklistItemResponseSchema: { item: checklist.items[0] },
  commentResponseSchema: { comment },
  notificationsResponseSchema: { notifications: [notification], unreadCount: 1, nextBefore: null },
  unreadCountResponseSchema: { unreadCount: 3 },
};

const exported = shared as unknown as Record<string, unknown>;
const schemaNames = Object.keys(exported).filter(
  (name) => name.endsWith('Schema') && exported[name] instanceof z.ZodType,
);
const isRequestSide = (name: string) => /(Request|Query|Params)Schema$/.test(name);

describe('contratos serializáveis pela API', () => {
  it.each(Object.entries(responseSamples))(
    '%s: safeEncode (serializer do Fastify) aceita o exemplo e descarta extras',
    (name, sample) => {
      const schema = exported[name];
      expect(schema, name).toBeInstanceOf(z.ZodType);
      const result = z.safeEncode(schema as z.ZodType, sample);
      expect(result.error).toBeUndefined();
      expect(result.data).toEqual(sample);
    },
  );

  it('todo schema de resposta *ResponseSchema tem exemplo aqui', () => {
    const responses = schemaNames.filter((name) => name.endsWith('ResponseSchema'));
    const aliases = new Set([
      'setupResponseSchema',
      'loginResponseSchema',
      'meResponseSchema',
      'acceptInviteResponseSchema',
      // Mesmo corpo de updateMeResponseSchema.
      'updateAvatarResponseSchema',
    ]);
    const missing = responses.filter((name) => !(name in responseSamples) && !aliases.has(name));
    expect(missing).toEqual([]);
  });

  it('respostas com e-mail vazado: só onde o contrato permite', () => {
    const withEmail = { ...userSummary, email: 'vazou@exemplo.com' };
    for (const name of ['usersResponseSchema']) {
      const encoded = z.encode(exported[name] as z.ZodType, { users: [withEmail] });
      expect(JSON.stringify(encoded)).not.toContain('vazou');
    }
    const leakyNotification = { ...notification, actorEmail: 'vazou@exemplo.com' };
    const notificationEncoded = z.encode(shared.notificationsResponseSchema, {
      notifications: [leakyNotification],
      unreadCount: 0,
      nextBefore: null,
    });
    expect(JSON.stringify(notificationEncoded)).not.toContain('vazou');
  });
});

describe('OpenAPI (z.toJSONSchema)', () => {
  it.each(schemaNames)('%s gera JSON Schema', (name) => {
    const schema = exported[name] as z.ZodType;
    const io = isRequestSide(name) ? 'input' : 'output';
    // Schemas de campo com transform (ex.: booleanos de query) só existem no lado de entrada.
    expect(() => z.toJSONSchema(schema, { io, unrepresentable: 'any' })).not.toThrow();
  });

  it('corpo de requisição com padrão aparece como opcional na entrada', () => {
    const json = z.toJSONSchema(shared.createListRequestSchema, { io: 'input' }) as {
      required?: string[];
    };
    expect(json.required).toEqual(['name']);
  });
});

describe('exemplos de requisição válidos (referência para MSW e backend)', () => {
  const requests: [z.ZodType, unknown][] = [
    [
      shared.acceptInviteRequestSchema,
      { token: TOKEN, name: 'Bia', email: 'bia@x.com', password: 'senha-forte-1' },
    ],
    [shared.completePasswordResetRequestSchema, { token: TOKEN, password: 'senha-forte-1' }],
    [shared.createInviteRequestSchema, { email: null, role: 'member' }],
    [shared.changePasswordRequestSchema, { currentPassword: 'x', newPassword: 'senha-forte-1' }],
    [shared.createBoardRequestSchema, { name: 'Quadro' }],
    [shared.createListRequestSchema, { name: 'Lista' }],
    [shared.createCardRequestSchema, { title: 'Card' }],
    [shared.moveCardRequestSchema, { toListId: ID.list, placement: { type: 'start' } }],
    [shared.createLabelRequestSchema, { name: 'Etiqueta', color: 'gray' }],
    [shared.createChecklistRequestSchema, { title: 'Checklist' }],
    [shared.createCommentRequestSchema, { body: 'Oi' }],
    [shared.updateBoardVisibilityRequestSchema, { visibility: 'restricted' }],
    [shared.boardCoverUploadUrlRequestSchema, { contentType: 'image/webp', sizeBytes: 1024 }],
    [
      shared.confirmBoardCoverRequestSchema,
      { objectKey: `covers/${ID.board}/abcdefghijklmnopqrstuvwxyz012345`, width: 800, height: 600 },
    ],
  ];

  it.each(requests.map(([schema, body], index) => [index, schema, body] as const))(
    'exemplo %i é válido',
    (_index, schema, body) => {
      expect(schema.safeParse(body).success).toBe(true);
    },
  );
});
