import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

export const DOCS_PREFIX = '/api/docs';

/**
 * OpenAPI gerado dos schemas Zod. Só fora de produção (overview.md §2):
 * UI em `/api/docs`, documento em `/api/docs/json`.
 * Precisa ser registrado antes das rotas para enxergá-las.
 */
export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  // A documentação (só fora de produção) é pública: não exige sessão.
  app.addHook('onRoute', (route) => {
    if (route.url.startsWith(DOCS_PREFIX)) route.config = { ...route.config, public: true };
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Ronin API',
        description: 'Contrato REST do Ronin (docs/architecture/api.md).',
        version: '0.0.0',
      },
    },
    transform: jsonSchemaTransform,
  });

  // A CSP global da API (`plugins/security-headers.ts`) bloquearia a UI; estas rotas usam a CSP
  // própria do pacote, que libera só os recursos da Swagger UI servidos pela própria API.
  await app.register(swaggerUi, { routePrefix: DOCS_PREFIX, staticCSP: true });
}
