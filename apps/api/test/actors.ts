import type { ErrorCode } from '@kanban/shared';
import { errorResponseSchema } from '@kanban/shared';
import type { LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';

import type { Database } from '../src/db/client';
import type { UserRow } from '../src/db/schema';

import { csrfHeaders } from './app';
import { seedUser, seedWorkspace, sessionCookieFor } from './auth';

export interface Actor {
  user: UserRow;
  /** Header `cookie` da sessão. */
  cookie: string;
  /** `cookie` + headers de CSRF: prontos para qualquer método. */
  headers: Record<string, string>;
}

let counter = 0;

/**
 * Usuário com sessão válida. E-mail único por chamada, salvo se informado.
 * `now` precisa casar com o relógio do app (sessão criada nesse instante).
 */
export async function seedActor(
  db: Database,
  overrides: Partial<Parameters<typeof seedUser>[1]> = {},
  now = new Date(),
): Promise<Actor> {
  counter += 1;
  const user = await seedUser(db, {
    email: `pessoa${counter}@exemplo.com`,
    name: `Pessoa ${counter}`,
    ...overrides,
  });
  const cookie = await sessionCookieFor(db, user.id, now);
  return { user, cookie, headers: { cookie, ...csrfHeaders() } };
}

/** Workspace + Admin + Member, cenário base das rotas autenticadas. */
export async function seedTeam(
  db: Database,
  now = new Date(),
): Promise<{ admin: Actor; member: Actor }> {
  await seedWorkspace(db);
  const admin = await seedActor(db, { role: 'admin', name: 'Ana Admin' }, now);
  const member = await seedActor(db, { role: 'member', name: 'Beto Membro' }, now);
  return { admin, member };
}

/** Espera o envelope de erro com status e código. Retorna o erro para asserções extras. */
export function expectError(
  res: LightMyRequestResponse,
  status: number,
  code: ErrorCode,
): ReturnType<typeof errorResponseSchema.parse>['error'] {
  expect({ status: res.statusCode, body: res.body }).toMatchObject({ status });
  const { error } = errorResponseSchema.parse(res.json());
  expect(error.code).toBe(code);
  return error;
}

/** UUID válido que não existe no banco. */
export const MISSING_ID = '00000000-0000-4000-8000-000000000000';
