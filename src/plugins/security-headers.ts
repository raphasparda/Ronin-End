import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';

/**
 * CSP da API. A API só responde JSON (a SPA é servida pelo Caddy com a própria CSP), então nada
 * pode ser carregado, embutido ou submetido a partir de uma resposta dela. A Swagger UI (fora de
 * produção) define a própria CSP nas rotas de `/api/docs` (`staticCSP` em `plugins/openapi.ts`).
 */
export const API_CONTENT_SECURITY_POLICY = {
  'default-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-ancestors': ["'none'"],
} as const;

/**
 * Headers de segurança (overview.md §6.7): `@fastify/helmet` com os defaults, exceto a CSP (mais
 * restrita), e `Cache-Control: no-store` em toda resposta, inclusive erros e 404. O processo da
 * API só atende `/api/*`, então isso cobre exatamente `/api/*`.
 * Deve ser chamado antes de registrar OpenAPI e módulos.
 */
export async function registerSecurityHeaders(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: API_CONTENT_SECURITY_POLICY,
    },
  });

  app.addHook('onSend', (request, reply, payload, done) => {
    // Só rotas que declaram `config.cacheControl` escapam do `no-store` (hoje: a foto de perfil,
    // cuja URL já carrega a versão), e mesmo assim só em respostas de sucesso: erro guardado por
    // um dia esconderia a foto que acabou de chegar.
    const cacheControl = request.routeOptions.config.cacheControl;
    const cacheable = cacheControl !== undefined && reply.statusCode < 400;
    void reply.header('cache-control', cacheable ? cacheControl : 'no-store');
    done(null, payload);
  });
}
