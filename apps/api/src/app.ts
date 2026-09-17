import { randomUUID } from 'node:crypto';

import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import type { Env } from './config/env';
import {
  createDb,
  createPool,
  createPoolCheck,
  type Database,
  type DatabaseCheck,
} from './db/client';
import { argon2ParamsFor, createPasswordHasher, type PasswordHasher } from './lib/password';
import { buildLoggerOptions } from './logger';
import { adminRoutes } from './modules/admin/routes';
import { authRoutes } from './modules/auth/routes';
import { boardRoutes } from './modules/boards/routes';
import { cardRoutes } from './modules/cards/routes';
import { checklistRoutes } from './modules/checklists/routes';
import { commentRoutes } from './modules/comments/routes';
import { healthRoutes } from './modules/health/routes';
import { inviteRoutes } from './modules/invites/routes';
import { labelRoutes } from './modules/labels/routes';
import { listRoutes } from './modules/lists/routes';
import { meRoutes } from './modules/me/routes';
import { passwordResetRoutes } from './modules/password-resets/routes';
import { setupRoutes } from './modules/setup/routes';
import { userRoutes } from './modules/users/routes';
import { registerCsrf } from './plugins/csrf';
import { registerErrorHandlers } from './plugins/errors';
import { registerOpenApi } from './plugins/openapi';
import { registerRateLimit } from './plugins/rate-limit';
import { registerSecurityHeaders } from './plugins/security-headers';
import { registerSession } from './plugins/session';

/** Limite de corpo (api.md §3: `413 PAYLOAD_TOO_LARGE` acima de 256 KB). */
export const BODY_LIMIT_BYTES = 256 * 1024;

export type Clock = () => Date;

declare module 'fastify' {
  interface FastifyInstance {
    /** Relógio da aplicação. Serviços usam `request.server.clock()` em vez de `new Date()`. */
    clock: Clock;
    /** Drizzle sobre o pool da API. Serviços recebem `app.db` (ou uma transação dele). */
    db: Database;
    /** Hash/verificação de senha (Argon2id; parâmetros leves só com NODE_ENV=test). */
    passwords: PasswordHasher;
  }
  interface FastifyContextConfig {
    /** Rota acessível sem sessão (overview.md §6.2). */
    public?: boolean;
  }
}

export interface BuildAppOptions {
  env: Env;
  /** Substitui a checagem do banco (testes). Padrão: `SELECT 1` num pool `pg` de `DATABASE_URL`. */
  checkDatabase?: DatabaseCheck;
  /** Substitui o relógio (testes). Padrão: `() => new Date()`. */
  clock?: Clock;
  /** Substitui o hasher de senha. Padrão: Argon2id com os parâmetros de `NODE_ENV`. */
  passwords?: PasswordHasher;
}

export type App = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  ZodTypeProvider
>;

export async function buildApp(opts: BuildAppOptions): Promise<App> {
  const { env } = opts;

  const app = Fastify({
    logger: buildLoggerOptions(env),
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: env.TRUST_PROXY,
    genReqId: () => randomUUID(),
    // Não confiar em id de requisição vindo do cliente.
    requestIdHeader: false,
  }).withTypeProvider<ZodTypeProvider>();

  // Só JSON (overview.md §6.3): sem o parser padrão de text/plain, qualquer outro Content-Type
  // com corpo vira 415 UNSUPPORTED_MEDIA_TYPE.
  app.removeContentTypeParser('text/plain');

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('clock', opts.clock ?? (() => new Date()));

  registerErrorHandlers(app);
  await registerSecurityHeaders(app);

  // Criar o pool não abre conexão: apps de teste sem banco só falham se consultarem.
  const pool = createPool(env.DATABASE_URL, app.log, { max: env.DATABASE_POOL_MAX });
  app.addHook('onClose', async () => {
    await pool.end();
  });
  const checkDatabase = opts.checkDatabase ?? createPoolCheck(pool);
  app.decorate('db', createDb(pool));
  app.decorate('passwords', opts.passwords ?? createPasswordHasher(argon2ParamsFor(env.NODE_ENV)));

  if (env.NODE_ENV !== 'production') {
    await registerOpenApi(app);
  }

  // Ordem dos hooks por request: sessão (onRequest) → rate limit (onRequest de rota) →
  // exige sessão (preParsing) → CSRF (preParsing) → parser/validação → handler.
  await registerSession(app, env);
  registerCsrf(app, { appOrigin: env.APP_ORIGIN });
  await registerRateLimit(app);

  await app.register(healthRoutes, { checkDatabase });
  await app.register(setupRoutes);
  await app.register(authRoutes);
  await app.register(inviteRoutes);
  await app.register(passwordResetRoutes);
  await app.register(meRoutes);
  await app.register(userRoutes);
  await app.register(adminRoutes, { appOrigin: env.APP_ORIGIN });
  await app.register(boardRoutes);
  await app.register(listRoutes);
  await app.register(cardRoutes);
  await app.register(labelRoutes);
  await app.register(checklistRoutes);
  await app.register(commentRoutes);

  return app;
}
