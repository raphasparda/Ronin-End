import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, join } from 'node:path';

import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Tamanho mínimo e máximo do `SETUP_TOKEN` (o corpo do setup aceita até 200 caracteres). */
export const SETUP_TOKEN_MIN_LENGTH = 16;
export const SETUP_TOKEN_MAX_LENGTH = 200;

/** Nomes de faixas aceitos pelo `proxy-addr` (usado pelo `trustProxy` do Fastify). */
const TRUST_PROXY_PRESETS = new Set(['loopback', 'linklocal', 'uniquelocal']);

/** `true` se `value` é um IP (v4/v6), um CIDR válido ou um nome de faixa do `proxy-addr`. */
export function isTrustedProxyEntry(value: string): boolean {
  if (TRUST_PROXY_PRESETS.has(value)) return true;
  const [address = '', prefix, ...rest] = value.split('/');
  if (rest.length > 0) return false;
  const version = isIP(address);
  if (version === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (version === 4 ? 32 : 128);
}

/**
 * `TRUST_PROXY` → valor do `trustProxy` do Fastify:
 * - `true` / `false`: confia em qualquer proxy / em nenhum;
 * - inteiro positivo (ex.: `1`): confia nesse número de saltos a partir do socket;
 * - lista de IPs/CIDRs separados por vírgula (ex.: `10.0.0.0/8,127.0.0.1`): confia só neles.
 */
const trustProxySchema = z
  .string()
  .trim()
  .transform((value, ctx): boolean | number | string[] => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (/^\d+$/.test(value)) {
      const hops = Number(value);
      if (hops >= 1 && hops <= 100) return hops;
      ctx.addIssue({ code: 'custom', message: 'Número de saltos deve ser de 1 a 100' });
      return z.NEVER;
    }
    const entries = value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    if (entries.length > 0 && entries.every(isTrustedProxyEntry)) return entries;
    ctx.addIssue({
      code: 'custom',
      message: 'Use "true", "false", um número de saltos ou IPs/CIDRs separados por vírgula',
    });
    return z.NEVER;
  });

const postgresUrlSchema = z
  .url({ protocol: /^postgres(ql)?$/, error: 'URL PostgreSQL inválida (postgres://...)' })
  .trim();

/**
 * Variáveis de ambiente da API (overview.md §3). Validadas na inicialização.
 * Fail-closed (api.md §18.5): `NODE_ENV` e o protocolo de `APP_ORIGIN` precisam concordar, porque
 * o cookie `Secure`, o prefixo `__Host-`, o OpenAPI e os parâmetros do Argon2 dependem de
 * `NODE_ENV`. HTTPS fora de produção indica produção sem `NODE_ENV=production` (cookie sem
 * `Secure`, `/docs` exposto); produção em HTTP deixaria a sessão trafegar sem TLS.
 * Produção também exige `SETUP_TOKEN` (overview.md §6.8): o setup inicial não fica aberto.
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
    TRUST_PROXY: trustProxySchema.default(false),
    /**
     * Código exigido no `POST /api/setup` (api.md §4). Obrigatório em produção: sem ele, quem
     * chegar primeiro à instância vazia vira Admin.
     */
    SETUP_TOKEN: z
      .string()
      .trim()
      .min(SETUP_TOKEN_MIN_LENGTH, {
        error: `Use pelo menos ${SETUP_TOKEN_MIN_LENGTH} caracteres`,
      })
      .max(SETUP_TOKEN_MAX_LENGTH, {
        error: `Use no máximo ${SETUP_TOKEN_MAX_LENGTH} caracteres`,
      })
      .optional(),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    /**
     * Capa do card no Cloudflare R2 (Fatia 11, ADR 0016). As quatro primeiras são **tudo ou
     * nada**: sem elas o recurso fica desligado (`features.cardCovers: false`); com parte delas a
     * API não sobe (fail-closed, overview.md §6.9).
     */
    R2_ACCOUNT_ID: z.string().trim().min(1).optional(),
    R2_BUCKET: z.string().trim().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().trim().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().trim().min(1).optional(),
    /** Padrão: `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`. */
    R2_ENDPOINT: z
      .url({ protocol: /^https?$/, error: 'Endpoint inválido (https://host)' })
      .trim()
      .optional(),
    /** Base das URLs **assinadas** de leitura (domínio próprio). O bucket continua privado. */
    R2_PUBLIC_BASE_URL: z
      .url({ protocol: /^https?$/, error: 'Base inválida (https://host)' })
      .trim()
      .optional(),
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
    const r2 = {
      R2_ACCOUNT_ID: env.R2_ACCOUNT_ID,
      R2_BUCKET: env.R2_BUCKET,
      R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
    };
    const missing = Object.entries(r2).filter(([, value]) => value === undefined);
    if (missing.length > 0 && missing.length < Object.keys(r2).length) {
      for (const [variable] of missing) {
        ctx.addIssue({
          code: 'custom',
          path: [variable],
          message:
            'As variáveis do R2 são tudo ou nada: defina R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID e R2_SECRET_ACCESS_KEY, ou nenhuma delas',
        });
      }
    }
    if (env.NODE_ENV === 'production' && env.SETUP_TOKEN === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['SETUP_TOKEN'],
        message: 'Em produção (NODE_ENV=production) defina SETUP_TOKEN (código do setup inicial)',
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
