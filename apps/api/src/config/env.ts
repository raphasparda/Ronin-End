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

/** Variáveis de ambiente da API (overview.md §3). Validadas na inicialização. */
export const envSchema = z.object({
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
 * Procura no diretório atual e sobe até a raiz do monorepo (onde está `pnpm-workspace.yaml`),
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
