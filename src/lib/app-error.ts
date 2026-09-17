import { ERROR_HTTP_STATUS, type ErrorCode, type ErrorDetail } from '@raphasparda/ronin-shared';

export interface AppErrorOptions {
  details?: ErrorDetail[];
  /** Headers extras da resposta (ex.: `Retry-After` em 429). */
  headers?: Record<string, string>;
  cause?: unknown;
}

/**
 * Erro de negócio esperado. O status HTTP vem de `ERROR_HTTP_STATUS` (api.md §3),
 * então código e status nunca divergem. `message` vai para o usuário: pt-BR, sem detalhes internos.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: ErrorDetail[] | undefined;
  readonly headers: Record<string, string>;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.statusCode = ERROR_HTTP_STATUS[code];
    this.details = options.details;
    this.headers = options.headers ?? {};
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
