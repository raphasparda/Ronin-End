import { describe, expect, it } from 'vitest';

import { ID, T0, TOKEN, adminUser, invite, issuePaths, userSummary } from '../test-fixtures';
import {
  adminUserResponseSchema,
  adminUsersResponseSchema,
  anonymizeUserRequestSchema,
  createInviteRequestSchema,
  createInviteResponseSchema,
  invitesResponseSchema,
  passwordResetLinkResponseSchema,
  updateAdminUserRequestSchema,
  updateWorkspaceRequestSchema,
  workspaceResponseSchema,
} from './admin';
import {
  acceptInviteRequestSchema,
  acceptInviteResponseSchema,
  authSessionResponseSchema,
  completePasswordResetRequestSchema,
  inviteLookupRequestSchema,
  inviteLookupResponseSchema,
  passwordResetLookupRequestSchema,
  passwordResetLookupResponseSchema,
} from './auth';
import { isPasswordSameAsEmail, tokenSchema } from './common';
import {
  changePasswordRequestSchema,
  myCardsResponseSchema,
  updateMeRequestSchema,
  updateMeResponseSchema,
} from './me';
import { userIdParamsSchema, userSummarySchema, usersResponseSchema } from './users';

describe('userSummarySchema', () => {
  it('não tem e-mail e descarta e-mail vindo do banco', () => {
    expect(Object.keys(userSummarySchema.shape)).not.toContain('email');
    const parsed = usersResponseSchema.parse({
      users: [{ ...userSummary, email: 'ana@exemplo.com', passwordHash: 'x' }],
    });
    expect(parsed.users[0]).toEqual(userSummary);
    expect(JSON.stringify(parsed)).not.toContain('@');
  });

  it('exige status e anonymized', () => {
    expect(userSummarySchema.safeParse({ ...userSummary, status: 'deleted' }).success).toBe(false);
    const { anonymized: _omit, ...withoutFlag } = userSummary;
    expect(issuePaths(userSummarySchema.safeParse(withoutFlag))).toEqual(['anonymized']);
  });

  it('userIdParamsSchema recusa id inválido', () => {
    expect(userIdParamsSchema.safeParse({ userId: ID.user }).success).toBe(true);
    expect(issuePaths(userIdParamsSchema.safeParse({ userId: '42' }))).toEqual(['userId']);
  });
});

describe('administração de membros', () => {
  it('usuário admin tem e-mail (nulo se anonimizado) e createdAt', () => {
    expect(adminUsersResponseSchema.parse({ users: [adminUser] })).toEqual({ users: [adminUser] });
    const anonymized = {
      ...adminUser,
      name: 'Usuário removido',
      email: null,
      status: 'deactivated',
      anonymized: true,
    };
    expect(adminUserResponseSchema.parse({ user: anonymized })).toEqual({ user: anonymized });
    expect(adminUserResponseSchema.safeParse({ user: userSummary }).success).toBe(false);
  });

  it('PATCH de papel aceita só admin/member', () => {
    expect(updateAdminUserRequestSchema.parse({ role: 'member' })).toEqual({ role: 'member' });
    expect(issuePaths(updateAdminUserRequestSchema.safeParse({ role: 'owner' }))).toEqual(['role']);
  });

  it('anonimizar exige confirm: true literal', () => {
    expect(anonymizeUserRequestSchema.parse({ confirm: true })).toEqual({ confirm: true });
    const result = anonymizeUserRequestSchema.safeParse({ confirm: 'true' });
    expect(result.error?.issues[0]?.message).toBe('Confirme a anonimização');
    expect(anonymizeUserRequestSchema.safeParse({ confirm: false }).success).toBe(false);
    expect(anonymizeUserRequestSchema.safeParse({}).success).toBe(false);
  });

  it('link de redefinição', () => {
    const body = { url: `http://127.0.0.1:5310/redefinir-senha#token=${TOKEN}`, expiresAt: T0 };
    expect(passwordResetLinkResponseSchema.parse(body)).toEqual(body);
    expect(
      passwordResetLinkResponseSchema.safeParse({ ...body, expiresAt: 'amanhã' }).success,
    ).toBe(false);
  });
});

describe('convites (admin)', () => {
  it('criar: e-mail opcional/nulo vira null, e-mail normalizado', () => {
    expect(createInviteRequestSchema.parse({ role: 'member' })).toEqual({
      email: null,
      role: 'member',
    });
    expect(createInviteRequestSchema.parse({ email: null, role: 'admin' })).toEqual({
      email: null,
      role: 'admin',
    });
    expect(createInviteRequestSchema.parse({ email: ' Bia@Exemplo.com ', role: 'member' })).toEqual(
      { email: 'bia@exemplo.com', role: 'member' },
    );
  });

  it('criar: e-mail em branco é inválido e papel é obrigatório', () => {
    expect([
      ...new Set(issuePaths(createInviteRequestSchema.safeParse({ email: '', role: 'member' }))),
    ]).toEqual(['email']);
    expect(issuePaths(createInviteRequestSchema.safeParse({}))).toEqual(['role']);
  });

  it('item de convite e respostas', () => {
    expect(invitesResponseSchema.parse({ invites: [invite] })).toEqual({ invites: [invite] });
    const used = { ...invite, state: 'used', usedByUserId: ID.user2, email: 'bia@exemplo.com' };
    expect(createInviteResponseSchema.parse({ invite: used, url: 'x' })).toEqual({
      invite: used,
      url: 'x',
    });
    expect(
      invitesResponseSchema.safeParse({ invites: [{ ...invite, state: 'aceito' }] }).success,
    ).toBe(false);
  });
});

describe('workspace (admin)', () => {
  it('aceita nome e/ou fuso, com trim', () => {
    expect(updateWorkspaceRequestSchema.parse({ name: ' Equipe ' })).toEqual({ name: 'Equipe' });
    expect(updateWorkspaceRequestSchema.parse({ timezone: 'America/Manaus' })).toEqual({
      timezone: 'America/Manaus',
    });
  });

  it('exige ao menos um campo e valida fuso', () => {
    const empty = updateWorkspaceRequestSchema.safeParse({});
    expect(empty.success).toBe(false);
    expect(empty.error?.issues[0]?.message).toBe('Informe ao menos um campo para alterar');
    expect(updateWorkspaceRequestSchema.safeParse({ outro: 1 }).success).toBe(false);
    expect(issuePaths(updateWorkspaceRequestSchema.safeParse({ timezone: 'GMT-3' }))).toEqual([
      'timezone',
    ]);
  });

  it('resposta { workspace }', () => {
    const body = { workspace: { name: 'Equipe', timezone: 'America/Sao_Paulo' } };
    expect(workspaceResponseSchema.parse(body)).toEqual(body);
  });
});

describe('tokens de convite e redefinição (rotas públicas)', () => {
  it('tokenSchema: exatamente 43 caracteres base64url', () => {
    expect(tokenSchema.safeParse(TOKEN).success).toBe(true);
    expect(tokenSchema.safeParse(TOKEN.slice(1)).success).toBe(false);
    expect(tokenSchema.safeParse(`${TOKEN}a`).success).toBe(false);
    expect(tokenSchema.safeParse(`${TOKEN.slice(1)}=`).success).toBe(false);
    expect(tokenSchema.safeParse(`${TOKEN.slice(1)}+`).success).toBe(false);
    expect(tokenSchema.safeParse(` ${TOKEN.slice(1)}`).error?.issues[0]?.message).toBe(
      'Token inválido',
    );
  });

  it('lookups usam { token }', () => {
    expect(inviteLookupRequestSchema.parse({ token: TOKEN })).toEqual({ token: TOKEN });
    expect(issuePaths(passwordResetLookupRequestSchema.safeParse({}))).toEqual(['token']);
  });

  it('respostas de lookup', () => {
    const inviteBody = { email: null, role: 'member', expiresAt: T0 };
    expect(inviteLookupResponseSchema.parse(inviteBody)).toEqual(inviteBody);
    const resetBody = { userName: 'Ana', expiresAt: T0 };
    expect(passwordResetLookupResponseSchema.parse({ ...resetBody, email: 'ana@x.com' })).toEqual(
      resetBody,
    );
  });

  const accept = {
    token: TOKEN,
    name: ' Bia ',
    email: ' Bia@Exemplo.com',
    password: 'senha-forte-123',
  };

  it('aceitar convite normaliza nome e e-mail', () => {
    expect(acceptInviteRequestSchema.parse(accept)).toEqual({
      token: TOKEN,
      name: 'Bia',
      email: 'bia@exemplo.com',
      password: 'senha-forte-123',
    });
    expect(acceptInviteResponseSchema).toBe(authSessionResponseSchema);
  });

  it('aceitar convite: política de senha e senha ≠ e-mail', () => {
    expect(
      issuePaths(acceptInviteRequestSchema.safeParse({ ...accept, password: 'curta' })),
    ).toEqual(['password']);
    const same = acceptInviteRequestSchema.safeParse({
      ...accept,
      email: 'bia.souza@exemplo.com',
      password: ' BIA.SOUZA@exemplo.com ',
    });
    expect(same.error?.issues[0]).toMatchObject({
      path: ['password'],
      message: 'A senha não pode ser igual ao e-mail',
    });
    expect(issuePaths(acceptInviteRequestSchema.safeParse({})).sort()).toEqual([
      'email',
      'name',
      'password',
      'token',
    ]);
  });

  it('concluir redefinição: token + senha com a política de cadastro', () => {
    expect(
      completePasswordResetRequestSchema.parse({ token: TOKEN, password: ' 123456789' }),
    ).toEqual({ token: TOKEN, password: ' 123456789' });
    expect(
      issuePaths(
        completePasswordResetRequestSchema.safeParse({ token: TOKEN, password: 'a'.repeat(257) }),
      ),
    ).toEqual(['password']);
  });

  it('isPasswordSameAsEmail (para o servidor quando o e-mail não vem no corpo)', () => {
    expect(isPasswordSameAsEmail(' ANA@exemplo.com ', 'ana@exemplo.com')).toBe(true);
    expect(isPasswordSameAsEmail('ana@exemplo.com', ' Ana@Exemplo.com')).toBe(true);
    expect(isPasswordSameAsEmail('ana@exemplo.com1', 'ana@exemplo.com')).toBe(false);
  });
});

describe('me', () => {
  it('PATCH /me: nome com trim e limites', () => {
    expect(updateMeRequestSchema.parse({ name: ' Ana ' })).toEqual({ name: 'Ana' });
    expect(issuePaths(updateMeRequestSchema.safeParse({ name: '  ' }))).toEqual(['name']);
    expect(issuePaths(updateMeRequestSchema.safeParse({ name: 'a'.repeat(81) }))).toEqual(['name']);
    const user = {
      id: ID.user,
      name: 'Ana',
      email: 'ana@exemplo.com',
      role: 'member',
      avatarUpdatedAt: null,
    };
    expect(updateMeResponseSchema.parse({ user })).toEqual({ user });
  });

  it('troca de senha: atual 1–256 (sem política), nova 10–256', () => {
    expect(
      changePasswordRequestSchema.parse({
        currentPassword: 'curta',
        newPassword: 'nova-senha-123',
      }),
    ).toEqual({ currentPassword: 'curta', newPassword: 'nova-senha-123' });
    expect(
      issuePaths(
        changePasswordRequestSchema.safeParse({ currentPassword: '', newPassword: 'curta' }),
      ).sort(),
    ).toEqual(['currentPassword', 'newPassword']);
  });

  it('meus cards: face do card + quadro e lista com cor', () => {
    const response = myCardsResponseSchema.safeParse({ cards: [] });
    expect(response.success).toBe(true);
  });
});
