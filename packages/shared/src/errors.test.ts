import { describe, expect, it } from 'vitest';

import { ERROR_CODES, ERROR_HTTP_STATUS, errorResponseSchema, isErrorCode } from './errors';

describe('ErrorCode', () => {
  it('tem os 30 códigos de api.md §3, sem duplicatas, todos com status', () => {
    expect(ERROR_CODES).toHaveLength(30);
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(Object.keys(ERROR_HTTP_STATUS).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('status HTTP de alguns códigos-chave', () => {
    expect(ERROR_HTTP_STATUS.VALIDATION_ERROR).toBe(400);
    expect(ERROR_HTTP_STATUS.UNAUTHENTICATED).toBe(401);
    expect(ERROR_HTTP_STATUS.CSRF_REJECTED).toBe(403);
    expect(ERROR_HTTP_STATUS.SETUP_REQUIRED).toBe(404);
    expect(ERROR_HTTP_STATUS.INVALID_PLACEMENT).toBe(409);
    expect(ERROR_HTTP_STATUS.TOKEN_INVALID).toBe(410);
    expect(ERROR_HTTP_STATUS.PAYLOAD_TOO_LARGE).toBe(413);
    expect(ERROR_HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE).toBe(415);
    expect(ERROR_HTTP_STATUS.TOO_MANY_ATTEMPTS).toBe(429);
    expect(ERROR_HTTP_STATUS.SERVICE_UNAVAILABLE).toBe(503);
  });

  it('isErrorCode', () => {
    expect(isErrorCode('NOT_FOUND')).toBe(true);
    expect(isErrorCode('NOPE')).toBe(false);
    expect(isErrorCode(404)).toBe(false);
  });
});

describe('errorResponseSchema', () => {
  it('aceita envelope com e sem details', () => {
    expect(
      errorResponseSchema.safeParse({ error: { code: 'NOT_FOUND', message: 'Não encontrado.' } })
        .success,
    ).toBe(true);
    expect(
      errorResponseSchema.safeParse({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Dados inválidos.',
          details: [{ path: 'title', message: 'Obrigatório' }],
        },
      }).success,
    ).toBe(true);
  });

  it('rejeita código desconhecido e envelope malformado', () => {
    expect(errorResponseSchema.safeParse({ error: { code: 'BOOM', message: 'x' } }).success).toBe(
      false,
    );
    expect(errorResponseSchema.safeParse({ code: 'NOT_FOUND', message: 'x' }).success).toBe(false);
    expect(
      errorResponseSchema.safeParse({
        error: { code: 'VALIDATION_ERROR', message: 'x', details: [{ path: 'a' }] },
      }).success,
    ).toBe(false);
  });

  it('descarta campos não declarados (ex.: stack)', () => {
    const parsed = errorResponseSchema.parse({
      error: { code: 'INTERNAL_ERROR', message: 'Algo deu errado.', stack: 'at x' },
    });
    expect(parsed).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Algo deu errado.' } });
  });
});
