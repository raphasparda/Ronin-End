import type { ErrorCode, ErrorDetail, ErrorResponse } from '@kanban/shared';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  ResponseSerializationError,
} from 'fastify-type-provider-zod';

import { isAppError } from '../lib/app-error';

/** Mensagens padrão (pt-BR) para erros que não vêm de `AppError`. */
export const DEFAULT_MESSAGES = {
  VALIDATION_ERROR: 'Dados inválidos.',
  INVALID_JSON: 'O corpo da requisição não é um JSON válido.',
  UNSUPPORTED_MEDIA_TYPE: 'Tipo de conteúdo não suportado. Envie application/json.',
  NOT_FOUND: 'Recurso não encontrado.',
  CONFLICT: 'Conflito com dados existentes.',
  PAYLOAD_TOO_LARGE: 'O corpo da requisição é grande demais.',
  RATE_LIMITED: 'Muitas requisições. Tente de novo em instantes.',
  INTERNAL_ERROR: 'Algo deu errado. Tente de novo.',
} as const;

const PG_UNIQUE_VIOLATION = '23505';

interface MappedError {
  status: number;
  code: ErrorCode;
  message: string;
  details?: ErrorDetail[];
  headers?: Record<string, string>;
}

function envelope(mapped: MappedError): ErrorResponse {
  return {
    error: {
      code: mapped.code,
      message: mapped.message,
      ...(mapped.details ? { details: mapped.details } : {}),
    },
  };
}

/** Procura um erro do Postgres com o SQLSTATE informado na cadeia de `cause` (o Drizzle embrulha o erro do `pg`). */
export function findPgErrorCode(error: unknown, sqlState: string, maxDepth = 5): boolean {
  let current: unknown = error;
  for (
    let depth = 0;
    depth <= maxDepth && typeof current === 'object' && current !== null;
    depth++
  ) {
    if ('code' in current && current.code === sqlState) return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

function mapError(error: unknown, request: FastifyRequest): MappedError {
  if (isAppError(error)) {
    return {
      status: error.statusCode,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      headers: error.headers,
    };
  }

  if (hasZodFastifySchemaValidationErrors(error)) {
    const context = error.validationContext ?? 'body';
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: DEFAULT_MESSAGES.VALIDATION_ERROR,
      details: error.validation.map((issue) => ({
        // `instancePath` vem como `/a/0/b`; o front espera `a.0.b`. Vazio = o objeto inteiro.
        path: issue.instancePath.split('/').filter(Boolean).join('.') || context,
        message: issue.message ?? DEFAULT_MESSAGES.VALIDATION_ERROR,
      })),
    };
  }

  if (error instanceof ResponseSerializationError) {
    request.log.error({ err: error }, 'resposta fora do schema declarado');
    return { status: 500, code: 'INTERNAL_ERROR', message: DEFAULT_MESSAGES.INTERNAL_ERROR };
  }

  if (findPgErrorCode(error, PG_UNIQUE_VIOLATION)) {
    request.log.warn({ err: error }, 'violação de unicidade não tratada');
    return { status: 409, code: 'CONFLICT', message: DEFAULT_MESSAGES.CONFLICT };
  }

  const fastifyError = error as Partial<FastifyError>;
  const status = fastifyError.statusCode;

  // Erros 4xx do próprio Fastify (parser de corpo, limites). A mensagem original é em inglês e
  // pode conter detalhes internos, então usamos as nossas.
  if (typeof status === 'number' && status >= 400 && status < 500) {
    switch (status) {
      case 404:
        return { status, code: 'NOT_FOUND', message: DEFAULT_MESSAGES.NOT_FOUND };
      case 413:
        return { status, code: 'PAYLOAD_TOO_LARGE', message: DEFAULT_MESSAGES.PAYLOAD_TOO_LARGE };
      case 415:
        return {
          status,
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: DEFAULT_MESSAGES.UNSUPPORTED_MEDIA_TYPE,
        };
      case 429:
        return { status, code: 'RATE_LIMITED', message: DEFAULT_MESSAGES.RATE_LIMITED };
      default:
        return {
          status: 400,
          code: 'VALIDATION_ERROR',
          message:
            fastifyError.code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
            fastifyError.name === 'SyntaxError'
              ? DEFAULT_MESSAGES.INVALID_JSON
              : DEFAULT_MESSAGES.VALIDATION_ERROR,
        };
    }
  }

  request.log.error({ err: error }, 'erro inesperado');
  return { status: 500, code: 'INTERNAL_ERROR', message: DEFAULT_MESSAGES.INTERNAL_ERROR };
}

/**
 * Handlers globais de erro e 404 (overview.md §8). Deve ser chamado antes de registrar módulos,
 * para que os contextos filhos herdem o handler.
 */
export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const mapped = mapError(error, request);
    if (mapped.headers) void reply.headers(mapped.headers);
    return reply.status(mapped.status).send(envelope(mapped));
  });

  app.setNotFoundHandler((_request: FastifyRequest, reply: FastifyReply) =>
    reply
      .status(404)
      .send(envelope({ status: 404, code: 'NOT_FOUND', message: DEFAULT_MESSAGES.NOT_FOUND })),
  );
}
