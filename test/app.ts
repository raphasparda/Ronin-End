import { buildApp, type App, type BuildAppOptions } from '../src/app';
import { parseEnv, type Env } from '../src/config/env';

/** Env mínimo e válido para testes, sem ler `.env`. */
export function testEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv({
    NODE_ENV: 'test',
    // Porta 1 recusa conexão: qualquer uso acidental do banco real falha rápido.
    DATABASE_URL: 'postgres://kanban:kanban@127.0.0.1:1/kanban',
    APP_ORIGIN: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

/** Headers que passam no CSRF (overview.md §6.3) para o `APP_ORIGIN` de `testEnv()`. */
export function csrfHeaders(env: Pick<Env, 'APP_ORIGIN'> = testEnv()): Record<string, string> {
  return { origin: env.APP_ORIGIN, 'x-kanban-csrf': '1' };
}

export const healthyDatabase = (): Promise<void> => Promise.resolve();

/** `buildApp` com env de teste e banco "saudável" (stub) por padrão. */
export function createTestApp(options: Partial<BuildAppOptions> = {}): Promise<App> {
  return buildApp({ env: testEnv(), checkDatabase: healthyDatabase, ...options });
}
