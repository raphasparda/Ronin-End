import { describe, expect, it } from 'vitest';

import {
  authSessionResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  meResponseSchema,
  sessionUserSchema,
  setupRequestSchema,
  setupResponseSchema,
  setupStatusResponseSchema,
  workspaceSchema,
} from './auth';
import { timezoneSchema, userNameSchema, workspaceNameSchema } from './common';
import { healthResponseSchema } from './health';

const UUID = '3f1c2b1e-8a4d-4c3b-9f2e-1a2b3c4d5e6f';

const validSetup = {
  workspaceName: 'Equipe Ronin',
  timezone: 'America/Manaus',
  name: 'Ana Souza',
  email: 'ana@exemplo.com',
  password: 'senha-forte-123',
};

function issuePaths(result: { error?: { issues: { path: PropertyKey[] }[] } }): string[] {
  return (result.error?.issues ?? []).map((issue) => issue.path.join('.'));
}

describe('campos comuns', () => {
  it('userNameSchema: trim e 1 a 80 caracteres', () => {
    expect(userNameSchema.parse('  Ana  ')).toBe('Ana');
    expect(userNameSchema.safeParse('   ').success).toBe(false);
    expect(userNameSchema.safeParse('a'.repeat(80)).success).toBe(true);
    expect(userNameSchema.safeParse('a'.repeat(81)).success).toBe(false);
    // Limite vale após o trim.
    expect(userNameSchema.safeParse(` ${'a'.repeat(80)} `).success).toBe(true);
  });

  it('workspaceNameSchema: trim e 1 a 100 caracteres', () => {
    expect(workspaceNameSchema.parse(' Equipe ')).toBe('Equipe');
    expect(workspaceNameSchema.safeParse('').success).toBe(false);
    expect(workspaceNameSchema.safeParse('a'.repeat(100)).success).toBe(true);
    expect(workspaceNameSchema.safeParse('a'.repeat(101)).success).toBe(false);
  });

  it('timezoneSchema: só fusos de Intl.supportedValuesOf', () => {
    expect(timezoneSchema.parse('America/Sao_Paulo')).toBe('America/Sao_Paulo');
    expect(timezoneSchema.parse(' Europe/Lisbon ')).toBe('Europe/Lisbon');
    expect(timezoneSchema.safeParse('Marte/Olympus').success).toBe(false);
    expect(timezoneSchema.safeParse('-03:00').success).toBe(false);
    expect(timezoneSchema.safeParse('').error?.issues[0]?.message).toBe('Fuso horário inválido');
  });
});

describe('setupRequestSchema', () => {
  it('aceita corpo válido e normaliza e-mail e textos', () => {
    const parsed = setupRequestSchema.parse({
      ...validSetup,
      workspaceName: '  Equipe Ronin ',
      name: ' Ana Souza ',
      email: '  Ana.Souza@Exemplo.COM ',
    });
    expect(parsed).toEqual({
      ...validSetup,
      workspaceName: 'Equipe Ronin',
      name: 'Ana Souza',
      email: 'ana.souza@exemplo.com',
    });
  });

  it('timezone ausente vira America/Sao_Paulo', () => {
    const { timezone: _omit, ...withoutTz } = validSetup;
    expect(setupRequestSchema.parse(withoutTz).timezone).toBe('America/Sao_Paulo');
  });

  it('rejeita fuso inválido', () => {
    const result = setupRequestSchema.safeParse({ ...validSetup, timezone: 'GMT-3' });
    expect(issuePaths(result)).toEqual(['timezone']);
  });

  it('senha: 10 a 256 caracteres, sem trim', () => {
    expect(setupRequestSchema.safeParse({ ...validSetup, password: 'a'.repeat(10) }).success).toBe(
      true,
    );
    expect(setupRequestSchema.safeParse({ ...validSetup, password: 'a'.repeat(256) }).success).toBe(
      true,
    );
    expect(
      issuePaths(setupRequestSchema.safeParse({ ...validSetup, password: 'a'.repeat(9) })),
    ).toEqual(['password']);
    expect(
      issuePaths(setupRequestSchema.safeParse({ ...validSetup, password: 'a'.repeat(257) })),
    ).toEqual(['password']);
    // Espaços contam: 9 caracteres + 1 espaço = 10.
    expect(setupRequestSchema.parse({ ...validSetup, password: ' 123456789' }).password).toBe(
      ' 123456789',
    );
  });

  it('senha igual ao e-mail (ignorando caixa) é recusada', () => {
    const result = setupRequestSchema.safeParse({
      ...validSetup,
      email: 'Ana.Souza@Exemplo.com',
      password: 'ANA.SOUZA@exemplo.com',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ['password'],
      message: 'A senha não pode ser igual ao e-mail',
    });
  });

  it('aponta cada campo obrigatório ausente', () => {
    const result = setupRequestSchema.safeParse({});
    expect(issuePaths(result).sort()).toEqual(['email', 'name', 'password', 'workspaceName']);
  });

  it('setupToken: opcional, até 200 caracteres, sem trim', () => {
    expect(setupRequestSchema.parse(validSetup).setupToken).toBeUndefined();
    expect(setupRequestSchema.parse({ ...validSetup, setupToken: ' abc ' }).setupToken).toBe(
      ' abc ',
    );
    expect(
      setupRequestSchema.safeParse({ ...validSetup, setupToken: 'a'.repeat(200) }).success,
    ).toBe(true);
    expect(
      issuePaths(setupRequestSchema.safeParse({ ...validSetup, setupToken: 'a'.repeat(201) })),
    ).toEqual(['setupToken']);
    expect(issuePaths(setupRequestSchema.safeParse({ ...validSetup, setupToken: 123 }))).toEqual([
      'setupToken',
    ]);
  });

  it('rejeita e-mail inválido e acima de 254 caracteres', () => {
    expect(issuePaths(setupRequestSchema.safeParse({ ...validSetup, email: 'ana@' }))).toEqual([
      'email',
    ]);
    const long = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(58)}.com`;
    expect(issuePaths(setupRequestSchema.safeParse({ ...validSetup, email: long }))).toEqual([
      'email',
    ]);
  });
});

describe('loginRequestSchema', () => {
  it('normaliza o e-mail com trim e minúsculas', () => {
    expect(loginRequestSchema.parse({ email: ' ANA@Exemplo.com\t', password: 'x' })).toEqual({
      email: 'ana@exemplo.com',
      password: 'x',
    });
  });

  it('senha: 1 a 256 caracteres, sem trim e sem a política de cadastro', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: 'curta' }).success).toBe(true);
    expect(loginRequestSchema.parse({ email: 'a@b.co', password: '  x  ' }).password).toBe('  x  ');
    expect(
      loginRequestSchema.safeParse({ email: 'a@b.co', password: 'a'.repeat(256) }).success,
    ).toBe(true);
    expect(issuePaths(loginRequestSchema.safeParse({ email: 'a@b.co', password: '' }))).toEqual([
      'password',
    ]);
    expect(
      issuePaths(loginRequestSchema.safeParse({ email: 'a@b.co', password: 'a'.repeat(257) })),
    ).toEqual(['password']);
  });

  it('rejeita e-mail inválido', () => {
    expect(issuePaths(loginRequestSchema.safeParse({ email: 'nao', password: 'x' }))).toEqual([
      'email',
    ]);
  });
});

describe('respostas', () => {
  const session = {
    user: {
      id: UUID,
      name: 'Ana',
      email: 'ana@exemplo.com',
      role: 'admin',
      avatarUpdatedAt: null,
    },
    workspace: { name: 'Equipe', timezone: 'America/Sao_Paulo' },
    features: { boardCovers: false },
  };

  it('setup, login e me compartilham { user, workspace, features }', () => {
    for (const schema of [setupResponseSchema, loginResponseSchema, meResponseSchema]) {
      expect(schema).toBe(authSessionResponseSchema);
    }
    expect(authSessionResponseSchema.parse(session)).toEqual(session);
  });

  it('descarta campos não declarados (ex.: passwordHash)', () => {
    const parsed = authSessionResponseSchema.parse({
      ...session,
      user: { ...session.user, passwordHash: '$argon2id$...', status: 'active' },
      workspace: { ...session.workspace, id: 1 },
      features: { ...session.features, r2Bucket: 'capas' },
    });
    expect(parsed).toEqual(session);
  });

  it('sessionUserSchema exige id UUID e papel conhecido', () => {
    expect(sessionUserSchema.safeParse({ ...session.user, id: '1' }).success).toBe(false);
    expect(sessionUserSchema.safeParse({ ...session.user, role: 'owner' }).success).toBe(false);
    expect(workspaceSchema.safeParse({ name: 'Equipe' }).success).toBe(false);
  });

  it('setupStatusResponseSchema', () => {
    const status = { needsSetup: true, requiresSetupToken: false };
    expect(setupStatusResponseSchema.parse(status)).toEqual(status);
    expect(setupStatusResponseSchema.safeParse({ ...status, needsSetup: 'true' }).success).toBe(
      false,
    );
    expect(setupStatusResponseSchema.safeParse({ needsSetup: true }).success).toBe(false);
  });

  it('healthResponseSchema', () => {
    expect(healthResponseSchema.parse({ status: 'ok', db: 'ok' })).toEqual({
      status: 'ok',
      db: 'ok',
    });
    expect(healthResponseSchema.safeParse({ status: 'ok', db: 'down' }).success).toBe(false);
  });
});
