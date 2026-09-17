import { z } from 'zod';

/**
 * Códigos de erro da API (api.md §3). Front e back usam esta mesma lista.
 * Mudança aqui = atualizar api.md §3 no mesmo PR.
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'CONFIRMATION_MISMATCH',
  'PASSWORD_INCORRECT',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'FORBIDDEN',
  'CSRF_REJECTED',
  'BOARD_RESTRICTED',
  'SETUP_TOKEN_INVALID',
  'NOT_FOUND',
  'SETUP_REQUIRED',
  'SETUP_ALREADY_DONE',
  'EMAIL_TAKEN',
  'INVITE_EMAIL_MISMATCH',
  'LAST_ADMIN',
  'CANNOT_TARGET_SELF',
  'USER_NOT_DEACTIVATED',
  'USER_ANONYMIZED',
  'USER_NOT_ACTIVE',
  'BOARD_ARCHIVED',
  'LIST_ARCHIVED',
  'LIST_IS_DONE_LIST',
  'INVALID_PLACEMENT',
  'LABEL_BOARD_MISMATCH',
  'BOARD_NOT_RESTRICTED',
  'COVER_UPLOAD_INVALID',
  'CONFLICT',
  'TOKEN_INVALID',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'TOO_MANY_ATTEMPTS',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
  'COVER_STORAGE_UNAVAILABLE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Status HTTP de cada código (api.md §3). */
export const ERROR_HTTP_STATUS = {
  VALIDATION_ERROR: 400,
  CONFIRMATION_MISMATCH: 400,
  PASSWORD_INCORRECT: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  CSRF_REJECTED: 403,
  BOARD_RESTRICTED: 403,
  SETUP_TOKEN_INVALID: 403,
  NOT_FOUND: 404,
  SETUP_REQUIRED: 404,
  SETUP_ALREADY_DONE: 409,
  EMAIL_TAKEN: 409,
  INVITE_EMAIL_MISMATCH: 409,
  LAST_ADMIN: 409,
  CANNOT_TARGET_SELF: 409,
  USER_NOT_DEACTIVATED: 409,
  USER_ANONYMIZED: 409,
  USER_NOT_ACTIVE: 409,
  BOARD_ARCHIVED: 409,
  LIST_ARCHIVED: 409,
  LIST_IS_DONE_LIST: 409,
  INVALID_PLACEMENT: 409,
  LABEL_BOARD_MISMATCH: 409,
  BOARD_NOT_RESTRICTED: 409,
  COVER_UPLOAD_INVALID: 409,
  CONFLICT: 409,
  TOKEN_INVALID: 410,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  TOO_MANY_ATTEMPTS: 429,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  COVER_STORAGE_UNAVAILABLE: 503,
} as const satisfies Record<ErrorCode, number>;

export const errorCodeSchema = z.enum(ERROR_CODES);

export const errorDetailSchema = z.object({
  path: z.string(),
  message: z.string(),
});

/** Envelope único de erro: `{ error: { code, message, details? } }`. */
export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.array(errorDetailSchema).optional(),
  }),
});

export type ErrorDetail = z.infer<typeof errorDetailSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}
