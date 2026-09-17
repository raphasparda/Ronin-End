import { errorResponseSchema, healthResponseSchema } from '@raphasparda/ronin-shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import type { DatabaseCheck } from '../../db/client';
import { AppError } from '../../lib/app-error';

export interface HealthRoutesOptions {
  checkDatabase: DatabaseCheck;
}

/** `GET /api/health` · Pública (api.md §4). */
export const healthRoutes: FastifyPluginCallbackZod<HealthRoutesOptions> = (app, opts, done) => {
  app.get(
    '/api/health',
    {
      config: { public: true },
      schema: {
        tags: ['saúde'],
        summary: 'Saúde da API e do banco',
        response: { 200: healthResponseSchema, 503: errorResponseSchema },
      },
    },
    async (request) => {
      try {
        await opts.checkDatabase();
      } catch (err) {
        request.log.warn({ err }, 'health check: banco indisponível');
        throw new AppError(
          'SERVICE_UNAVAILABLE',
          'Serviço indisponível: banco de dados fora do ar.',
        );
      }
      return { status: 'ok', db: 'ok' } as const;
    },
  );
  done();
};
