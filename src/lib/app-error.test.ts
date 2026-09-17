import { ERROR_CODES, ERROR_HTTP_STATUS } from '@raphasparda/ronin-shared';
import { describe, expect, it } from 'vitest';

import { AppError, isAppError } from './app-error';

describe('AppError', () => {
  it.each(ERROR_CODES)('%s usa o status de ERROR_HTTP_STATUS', (code) => {
    expect(new AppError(code, 'x').statusCode).toBe(ERROR_HTTP_STATUS[code]);
  });

  it('guarda detalhes, headers e causa', () => {
    const cause = new Error('interno');
    const error = new AppError('TOO_MANY_ATTEMPTS', 'Aguarde.', {
      details: [{ path: 'email', message: 'Bloqueado' }],
      headers: { 'retry-after': '900' },
      cause,
    });
    expect(error).toMatchObject({
      code: 'TOO_MANY_ATTEMPTS',
      statusCode: 429,
      message: 'Aguarde.',
      details: [{ path: 'email', message: 'Bloqueado' }],
      headers: { 'retry-after': '900' },
      cause,
    });
    expect(isAppError(error)).toBe(true);
    expect(isAppError(cause)).toBe(false);
  });
});
