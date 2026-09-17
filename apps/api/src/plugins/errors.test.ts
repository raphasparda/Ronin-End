import { errorResponseSchema, uuidSchema, type ErrorResponse } from '@kanban/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createTestApp, csrfHeaders } from '../../test/app';
import type { App } from '../app';
import { AppError } from '../lib/app-error';

import { DEFAULT_MESSAGES, findPgErrorCode } from './errors';

/** Erro no formato do `pg` (DatabaseError) embrulhado como o Drizzle faz. */
function uniqueViolation(): Error {
  const pgError = Object.assign(
    new Error('duplicate key value violates unique constraint "users_email_key"'),
    { code: '23505', detail: 'Key (email)=(a@b.c) already exists.' },
  );
  return new Error('Failed query: insert into "users" ...', { cause: pgError });
}

function envelopeOf(body: unknown): ErrorResponse {
  return errorResponseSchema.strict().parse(body);
}

describe('plugins/errors', () => {
  let app: App;

  beforeAll(async () => {
    app = await createTestApp();

    app.post(
      '/api/__test/items/:itemId',
      {
        config: { public: true },
        schema: {
          params: z.object({ itemId: uuidSchema }),
          querystring: z.object({ archived: z.enum(['true', 'false']).optional() }),
          body: z.object({
            title: z.string().trim().min(1, { error: 'Obrigatório' }).max(10),
            tags: z.array(z.string().min(1, { error: 'Etiqueta vazia' })).optional(),
          }),
          response: { 200: z.object({ id: z.string(), title: z.string() }) },
        },
      },
      (request) => ({
        id: request.params.itemId,
        title: request.body.title,
        // Campo não declarado: o serializer precisa descartar.
        passwordHash: 'nunca-deve-sair',
      }),
    );
    app.get('/api/__test/app-error', { config: { public: true } }, () => {
      throw new AppError('TOO_MANY_ATTEMPTS', 'Muitas tentativas.', {
        headers: { 'retry-after': '900' },
      });
    });
    app.get('/api/__test/app-error-details', { config: { public: true } }, () => {
      throw new AppError('CONFIRMATION_MISMATCH', 'O nome não confere.', {
        details: [{ path: 'confirmName', message: 'Diferente do nome do quadro' }],
      });
    });
    app.get('/api/__test/unique', { config: { public: true } }, () => {
      throw uniqueViolation();
    });
    app.get('/api/__test/boom', { config: { public: true } }, () => {
      throw new Error('SELECT * FROM users; senha=123');
    });
    app.get(
      '/api/__test/bad-response',
      {
        config: { public: true },
        schema: { response: { 200: z.object({ createdAt: z.iso.datetime() }) } },
      },
      // Simula esquecer de converter Date para string ISO.
      () => ({ createdAt: new Date() as unknown as string }),
    );

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const validId = '8a4b6f0e-3c2d-4e5f-9a1b-2c3d4e5f6a7b';
  const json = { 'content-type': 'application/json', ...csrfHeaders() };

  it('valida e serializa pelo schema (descarta campos não declarados)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/__test/items/${validId}`,
      headers: json,
      payload: { title: '  Oi  ' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: validId, title: 'Oi' });
  });

  it('erro de validação do corpo volta no envelope com details', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/__test/items/${validId}`,
      headers: json,
      payload: { title: '   ', tags: ['ok', ''] },
    });
    expect(res.statusCode).toBe(400);
    const { error } = envelopeOf(res.json());
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe(DEFAULT_MESSAGES.VALIDATION_ERROR);
    expect(error.details).toEqual(
      expect.arrayContaining([
        { path: 'title', message: 'Obrigatório' },
        { path: 'tags.1', message: 'Etiqueta vazia' },
      ]),
    );
  });

  it('corpo ausente vira VALIDATION_ERROR com path "body"', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/__test/items/${validId}`,
      headers: csrfHeaders(),
    });
    expect(res.statusCode).toBe(400);
    const { error } = envelopeOf(res.json());
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details?.[0]?.path).toBe('body');
  });

  it('UUID inválido no parâmetro → 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/__test/items/nao-e-uuid',
      headers: json,
      payload: { title: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(envelopeOf(res.json()).error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: 'itemId', message: 'Identificador inválido' }],
    });
  });

  it('query inválida → 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/__test/items/${validId}?archived=talvez`,
      headers: json,
      payload: { title: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(envelopeOf(res.json()).error.details?.[0]?.path).toBe('archived');
  });

  it('JSON malformado → 400 VALIDATION_ERROR sem vazar a mensagem do parser', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/__test/items/${validId}`,
      headers: json,
      payload: '{"title":',
    });
    expect(res.statusCode).toBe(400);
    expect(envelopeOf(res.json()).error).toEqual({
      code: 'VALIDATION_ERROR',
      message: DEFAULT_MESSAGES.INVALID_JSON,
    });
  });

  it('Content-Type não suportado → 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/__test/items/${validId}`,
      headers: { 'content-type': 'text/xml', ...csrfHeaders() },
      payload: '<title>x</title>',
    });
    expect(res.statusCode).toBe(415);
    expect(envelopeOf(res.json()).error).toEqual({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: DEFAULT_MESSAGES.UNSUPPORTED_MEDIA_TYPE,
    });
  });

  it('text/plain também é recusado com 415 (só JSON)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/__test/items/${validId}`,
      headers: { 'content-type': 'text/plain', ...csrfHeaders() },
      payload: '{"title":"x"}',
    });
    expect(res.statusCode).toBe(415);
    expect(envelopeOf(res.json()).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('corpo acima de 256 KB → 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/__test/items/${validId}`,
      headers: json,
      payload: JSON.stringify({ title: 'x', pad: 'a'.repeat(256 * 1024) }),
    });
    expect(res.statusCode).toBe(413);
    expect(envelopeOf(res.json()).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('AppError → status do código, envelope e headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/__test/app-error' });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('900');
    expect(envelopeOf(res.json())).toEqual({
      error: { code: 'TOO_MANY_ATTEMPTS', message: 'Muitas tentativas.' },
    });
  });

  it('AppError com details mantém details', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/__test/app-error-details' });
    expect(res.statusCode).toBe(400);
    expect(envelopeOf(res.json()).error.details).toEqual([
      { path: 'confirmName', message: 'Diferente do nome do quadro' },
    ]);
  });

  it('violação de unicidade (23505) embrulhada → 409 CONFLICT sem SQL', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/__test/unique' });
    expect(res.statusCode).toBe(409);
    expect(envelopeOf(res.json())).toEqual({
      error: { code: 'CONFLICT', message: DEFAULT_MESSAGES.CONFLICT },
    });
    expect(res.body).not.toContain('users_email_key');
  });

  it('erro inesperado → 500 INTERNAL_ERROR genérico (sem stack nem SQL)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/__test/boom' });
    expect(res.statusCode).toBe(500);
    expect(envelopeOf(res.json())).toEqual({
      error: { code: 'INTERNAL_ERROR', message: DEFAULT_MESSAGES.INTERNAL_ERROR },
    });
    expect(res.body).not.toMatch(/SELECT|senha|stack/);
  });

  it('resposta fora do schema → 500 INTERNAL_ERROR', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/__test/bad-response' });
    expect(res.statusCode).toBe(500);
    expect(envelopeOf(res.json()).error.code).toBe('INTERNAL_ERROR');
  });

  it('rota inexistente → 404 NOT_FOUND', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nao-existe' });
    expect(res.statusCode).toBe(404);
    expect(envelopeOf(res.json())).toEqual({
      error: { code: 'NOT_FOUND', message: DEFAULT_MESSAGES.NOT_FOUND },
    });
  });

  it('método não registrado → 404 NOT_FOUND', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/health' });
    expect(res.statusCode).toBe(404);
    expect(envelopeOf(res.json()).error.code).toBe('NOT_FOUND');
  });
});

describe('findPgErrorCode', () => {
  it('encontra o SQLSTATE na cadeia de cause', () => {
    expect(findPgErrorCode(uniqueViolation(), '23505')).toBe(true);
    expect(findPgErrorCode(uniqueViolation(), '23503')).toBe(false);
    expect(findPgErrorCode(null, '23505')).toBe(false);
    expect(findPgErrorCode('23505', '23505')).toBe(false);
  });
});
