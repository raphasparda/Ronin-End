import { Writable } from 'node:stream';

import { DrizzleQueryError } from 'drizzle-orm';
import pg from 'pg';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { describeDb, useTestDatabase } from '../test/db';

import { users } from './db/schema';
import { buildLoggerOptions } from './logger';

function capture(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('logger', () => {
  it('usa o nível do env', () => {
    expect(buildLoggerOptions({ LOG_LEVEL: 'warn' }).level).toBe('warn');
  });

  it('redige cookie, set-cookie, senhas e tokens', () => {
    const { redact } = buildLoggerOptions({ LOG_LEVEL: 'info' });
    const { stream, lines } = capture();
    const log = pino({ level: 'info', redact }, stream);

    log.info({
      req: { headers: { cookie: 'ronin_sid=abc', authorization: 'Bearer x', host: 'h' } },
      res: { headers: { 'set-cookie': 'ronin_sid=abc' } },
      body: {
        password: 'p1',
        currentPassword: 'p2',
        newPassword: 'p3',
        token: 't',
        setupToken: 'st',
        name: 'Ana',
      },
    });

    const [entry] = lines();
    const text = JSON.stringify(entry);
    for (const secret of ['ronin_sid=abc', 'Bearer x', '"p1"', '"p2"', '"p3"', '"t"', '"st"']) {
      expect(text).not.toContain(secret);
    }
    expect(entry).toMatchObject({
      req: { headers: { cookie: '[REDACTED]', authorization: '[REDACTED]', host: 'h' } },
      res: { headers: { 'set-cookie': '[REDACTED]' } },
      body: {
        password: '[REDACTED]',
        currentPassword: '[REDACTED]',
        newPassword: '[REDACTED]',
        token: '[REDACTED]',
        setupToken: '[REDACTED]',
        name: 'Ana',
      },
    });
  });
});

const EMAIL = 'ana.sigilo@exemplo.com';
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo';

/** Loga `err` com as opções reais do logger e devolve a linha JSON (texto e objeto). */
function logError(err: unknown): { text: string; entry: Record<string, unknown> } {
  const { redact, serializers } = buildLoggerOptions({ LOG_LEVEL: 'info' });
  const { stream, lines } = capture();
  const log = pino({ level: 'info', redact, serializers }, stream);
  log.error({ err }, 'erro inesperado');
  const [entry] = lines();
  if (!entry) throw new Error('nenhuma linha de log');
  return { text: JSON.stringify(entry), entry };
}

function pgUniqueViolation(): pg.DatabaseError {
  const err = new pg.DatabaseError(
    'duplicate key value violates unique constraint "users_email_unique"',
    100,
    'error',
  );
  Object.assign(err, {
    severity: 'ERROR',
    code: '23505',
    detail: `Key (email)=(${EMAIL}) already exists.`,
    constraint: 'users_email_unique',
    table: 'users',
  });
  return err;
}

describe('logger: serializer de err (api.md §18.5)', () => {
  const query = 'insert into "users" ("email", "password_hash") values ($1, $2)';

  it('DrizzleQueryError: sem params, message nem detail; mantém query, código e constraint', () => {
    const err = new DrizzleQueryError(query, [EMAIL, HASH], pgUniqueViolation());
    expect(err.message).toContain(EMAIL); // o risco existe no erro original
    const { text, entry } = logError(err);

    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(HASH);
    expect(text).not.toContain('already exists');
    expect(entry.err).toMatchObject({
      type: 'Error',
      query,
      code: '23505',
      constraint: 'users_email_unique',
      cause: { type: 'DatabaseError', code: '23505', constraint: 'users_email_unique' },
    });
    const serialized = entry.err as { stack: string };
    expect(serialized.stack).toMatch(/\n\s+at /);
  });

  it('DatabaseError do pg sozinho: sem message/detail', () => {
    const { text, entry } = logError(pgUniqueViolation());
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain('Key (email)');
    expect(entry.err).toMatchObject({ type: 'DatabaseError', code: '23505', table: 'users' });
  });

  it('erro comum embrulhando erro de banco: a causa também é higienizada', () => {
    const wrapped = new Error('falha ao criar usuário', {
      cause: new DrizzleQueryError(query, [EMAIL, HASH], pgUniqueViolation()),
    });
    const { text, entry } = logError(wrapped);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(HASH);
    expect(entry.err).toMatchObject({
      type: 'Error',
      message: 'falha ao criar usuário',
      cause: { query, code: '23505' },
    });
  });

  it('erros comuns continuam com type, message, stack e propriedades próprias', () => {
    const err = Object.assign(new TypeError('quebrou'), { statusCode: 500, code: 'X_FALHA' });
    const { entry } = logError(err);
    expect(entry.err).toMatchObject({
      type: 'TypeError',
      message: 'quebrou',
      statusCode: 500,
      code: 'X_FALHA',
    });
    expect((entry.err as { stack: string }).stack).toContain('TypeError: quebrou');
  });
});

describeDb('logger: erro real de unicidade do PostgreSQL (ronin_test)', () => {
  const { db } = useTestDatabase();

  it('o log não contém o e-mail nem o hash de senha', async () => {
    const values = { email: EMAIL, name: 'Ana', role: 'admin' as const, passwordHash: HASH };
    await db().insert(users).values(values);
    let caught: unknown;
    try {
      await db().insert(users).values(values);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    // Confirma que o erro original carrega os valores (senão o teste não prova nada).
    const raw = JSON.stringify(caught, Object.getOwnPropertyNames(caught)) + String(caught);
    expect(raw).toContain(EMAIL);

    const { text, entry } = logError(caught);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(HASH);
    expect(entry.err).toMatchObject({ code: '23505' });
    expect(text).toContain('insert into');
  });
});
