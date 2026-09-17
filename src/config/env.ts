import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const booleanFromString = z
  .enum(['true', 'false'], { error: 'Use "true" ou "false"' })
  .transform((value) => value === 'true');

const postgresUrlSchema = z
  .url({ protocol: /^postgres(ql)?$/, error: 'URL PostgreSQL inválida (postgres://...)' })
  .trim();

/**
 * Variáveis de ambiente da API (overview.md §3). Validadas na inicialização.
 * Fail-closed (api.md §18.5): `NODE_ENV` e o protocolo de `APP_ORIGIN` precisam concordar, porque
 * o cookie `Secure`, o prefixo `__Host-`, o OpenAPI e os parâmetros do Argon2 dependem de
 * `NODE_ENV`. HTTPS fora de produção indica produção sem `NODE_ENV=production` (cookie sem
 * `Secure`, `/docs` exposto); produção em HTTP deixaria a sessão trafegar sem TLS.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().trim().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: postgresUrlSchema,
    TEST_DATABASE_URL: postgresUrlSchema.optional(),
    /** Conexões máximas do pool `pg` da API. */
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    APP_ORIGIN: z
      .url({ protocol: /^https?$/, error: 'Origem inválida (http(s)://host[:porta])' })
      .trim()
      .refine((value) => new URL(value).origin === value, {
        error: 'Informe só a origem, sem caminho nem barra final',
      }),
    TRUST_PROXY: booleanFromString.default(false),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  })
  .superRefine((env, ctx) => {
    const https = env.APP_ORIGIN.startsWith('https://');
    if (env.NODE_ENV === 'production' && !https) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_ORIGIN'],
        message: 'Em produção (NODE_ENV=production) a origem precisa ser https://',
      });
    }
    if (env.NODE_ENV !== 'production' && https) {
      ctx.addIssue({
        code: 'custom',
        path: ['NODE_ENV'],
        message: 'APP_ORIGIN em https:// exige NODE_ENV=production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: readonly { variable: string; message: string }[]) {
    // Só nomes e mensagens: valores podem conter segredos.
    super(
      `Variáveis de ambiente inválidas:\n${issues.map((i) => `  - ${i.variable}: ${i.message}`).join('\n')}`,
    );
    this.name = 'EnvValidationError';
  }
}

/** Valida um objeto de variáveis (por padrão, `process.env`). Não lê arquivos. */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  // Variáveis vazias contam como ausentes (permite usar o default).
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => ({
        variable: issue.path.map(String).join('.') || '(raiz)',
        message: issue.message,
      })),
    );
  }
  return result.data;
}

/**
 * Carrega o `.env` com `process.loadEnvFile` (variáveis já definidas no ambiente prevalecem).
 * Procura no diretório atual e sobe até a raiz do repositório (onde está `pnpm-workspace.yaml`),
 * sem passar dela. Sem arquivo (ex.: produção em container), não faz nada.
 * Retorna o caminho carregado, se houver.
 */
export function loadDotEnv(startDir: string = process.cwd()): string | undefined {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return candidate;
    }
    const parent = dirname(dir);
    if (existsSync(join(dir, 'pnpm-workspace.yaml')) || parent === dir) return undefined;
    dir = parent;
  }
}

/** `.env` (se existir) + validação. Usado pelo `server.ts`. */
export function loadEnv(): Env {
  loadDotEnv();
  return parseEnv(process.env);
}
