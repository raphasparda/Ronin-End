import type { IncomingHttpHeaders } from 'node:http';

import type { FastifyInstance } from 'fastify';

import { AppError } from '../lib/app-error';

/** Header obrigatório em métodos mutáveis (o `api-client` do front sempre envia `1`). */
export const CSRF_HEADER = 'x-ronin-csrf';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const CSRF_REJECTED_MESSAGE =
  'Requisição recusada por segurança. Recarregue a página e tente de novo.';

/**
 * Regra de CSRF (overview.md §6.3, ADR 0002) para um método mutável:
 * 1. `Origin` igual a `APP_ORIGIN`; sem `Origin`, só com `Sec-Fetch-Site: same-origin`;
 * 2. `X-Ronin-Csrf: 1`.
 */
export function isCsrfAllowed(headers: IncomingHttpHeaders, appOrigin: string): boolean {
  const origin = headers.origin;
  const originOk =
    origin === undefined ? headers['sec-fetch-site'] === 'same-origin' : origin === appOrigin;
  return originOk && headers[CSRF_HEADER] === '1';
}

/**
 * Checagem de CSRF em todo método diferente de GET/HEAD/OPTIONS. Hook `preParsing` global,
 * registrado depois do de sessão: 401 vem antes de 403, e ambos antes do parser (415/400).
 * Rotas inexistentes seguem para o 404. O corpo só-JSON é garantido em `buildApp()` (415).
 */
export function registerCsrf(app: FastifyInstance, options: { appOrigin: string }): void {
  app.addHook('preParsing', (request, _reply, payload, done) => {
    if (
      SAFE_METHODS.has(request.method) ||
      request.is404 ||
      isCsrfAllowed(request.headers, options.appOrigin)
    ) {
      done(null, payload);
      return;
    }
    done(new AppError('CSRF_REJECTED', CSRF_REJECTED_MESSAGE));
  });
}
