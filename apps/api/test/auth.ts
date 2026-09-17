import type { LightMyRequestResponse } from 'fastify';

import { buildApp, type App, type BuildAppOptions } from '../src/app';
import type { Database } from '../src/db/client';
import { users, workspace, type UserRow } from '../src/db/schema';
import { argon2ParamsFor, createPasswordHasher } from '../src/lib/password';
import { createSession } from '../src/modules/sessions/service';

import { csrfHeaders, testEnv } from './app';
import { testDatabaseUrl } from './db';

/** Relógio controlável para testes de expiração. */
export function createTestClock(start = new Date('2026-09-16T12:00:00.000Z')): {
  now: () => Date;
  set: (date: Date) => void;
  advance: (ms: number) => void;
} {
  let current = start;
  return {
    now: () => current,
    set: (date) => {
      current = date;
    },
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

/** App ligado ao banco de testes (`TEST_DATABASE_URL`). Feche com `app.close()`. */
export function createDbTestApp(
  options: Partial<BuildAppOptions> & { envOverrides?: Record<string, string> } = {},
): Promise<App> {
  const { envOverrides, ...rest } = options;
  return buildApp({
    env: testEnv({ DATABASE_URL: testDatabaseUrl ?? '', ...envOverrides }),
    ...rest,
  });
}

export const testPasswords = createPasswordHasher(argon2ParamsFor('test'));

export const DEFAULT_PASSWORD = 'senha-muito-segura';

export async function seedWorkspace(db: Database, name = 'Ronin'): Promise<void> {
  await db.insert(workspace).values({ name, timezone: 'America/Sao_Paulo' });
}

export async function seedUser(
  db: Database,
  overrides: Partial<typeof users.$inferInsert> & { password?: string } = {},
): Promise<UserRow> {
  const { password = DEFAULT_PASSWORD, ...values } = overrides;
  const [row] = await db
    .insert(users)
    .values({
      email: 'ana@exemplo.com',
      name: 'Ana',
      role: 'admin',
      passwordHash: await testPasswords.hash(password),
      ...values,
    })
    .returning();
  if (!row) throw new Error('seedUser falhou');
  return row;
}

/** Cria uma sessão direto no banco e devolve o header `cookie` para o `inject`. */
export async function sessionCookieFor(
  db: Database,
  userId: string,
  now: Date,
  cookieName = 'kanban_sid',
): Promise<string> {
  const { token } = await createSession(db, userId, now);
  return `${cookieName}=${token}`;
}

/** Cookie de sessão gravado pela resposta (`Set-Cookie`), se houver. */
export function sessionCookieOf(
  res: LightMyRequestResponse,
  cookieName = 'kanban_sid',
): { name: string; value: string; maxAge?: number } | undefined {
  return res.cookies.find((c) => c.name === cookieName);
}

/** Header `cookie` a partir do `Set-Cookie` da resposta. */
export function cookieHeaderOf(res: LightMyRequestResponse, cookieName = 'kanban_sid'): string {
  const cookie = sessionCookieOf(res, cookieName);
  if (!cookie) throw new Error(`resposta sem cookie ${cookieName}`);
  return `${cookie.name}=${cookie.value}`;
}

export function jsonMutationHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'content-type': 'application/json', ...csrfHeaders(), ...extra };
}
