import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EnvValidationError, loadDotEnv, parseEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://kanban:kanban@127.0.0.1:5432/kanban',
  APP_ORIGIN: 'http://localhost:5173',
};

function issuesOf(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (err) {
    if (err instanceof EnvValidationError) return err.issues.map((i) => i.variable);
    throw err;
  }
  return [];
}

describe('parseEnv', () => {
  it('aplica os padrões', () => {
    expect(parseEnv(base)).toEqual({
      ...base,
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      DATABASE_POOL_MAX: 10,
      TRUST_PROXY: false,
      LOG_LEVEL: 'info',
    });
  });

  it('converte PORT e TRUST_PROXY', () => {
    const env = parseEnv({
      ...base,
      APP_ORIGIN: 'https://kanban.example',
      PORT: '4010',
      TRUST_PROXY: 'true',
      NODE_ENV: 'production',
    });
    expect(env.PORT).toBe(4010);
    expect(env.TRUST_PROXY).toBe(true);
    expect(parseEnv({ ...base, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
  });

  it('trata variável vazia como ausente', () => {
    const env = parseEnv({ ...base, PORT: '', TEST_DATABASE_URL: '' });
    expect(env.PORT).toBe(3000);
    expect(env.TEST_DATABASE_URL).toBeUndefined();
  });

  it.each([
    [{ DATABASE_URL: undefined }, 'DATABASE_URL'],
    [{ DATABASE_URL: 'mysql://x@localhost/db' }, 'DATABASE_URL'],
    [{ APP_ORIGIN: 'http://localhost:5173/app' }, 'APP_ORIGIN'],
    [{ APP_ORIGIN: 'http://localhost:5173/' }, 'APP_ORIGIN'],
    [{ PORT: '70000' }, 'PORT'],
    [{ PORT: 'abc' }, 'PORT'],
    [{ DATABASE_POOL_MAX: '0' }, 'DATABASE_POOL_MAX'],
    [{ DATABASE_POOL_MAX: '2.5' }, 'DATABASE_POOL_MAX'],
    [{ TRUST_PROXY: 'yes' }, 'TRUST_PROXY'],
    [{ NODE_ENV: 'staging' }, 'NODE_ENV'],
    [{ LOG_LEVEL: 'verbose' }, 'LOG_LEVEL'],
  ])('rejeita %o', (override, variable) => {
    expect(issuesOf({ ...base, ...override })).toContain(variable);
  });

  describe('NODE_ENV × protocolo de APP_ORIGIN (fail-closed)', () => {
    it('produção exige https', () => {
      expect(issuesOf({ ...base, NODE_ENV: 'production' })).toEqual(['APP_ORIGIN']);
      expect(
        issuesOf({ ...base, NODE_ENV: 'production', APP_ORIGIN: 'http://kanban.example' }),
      ).toEqual(['APP_ORIGIN']);
      expect(
        parseEnv({ ...base, NODE_ENV: 'production', APP_ORIGIN: 'https://kanban.example' }),
      ).toMatchObject({ NODE_ENV: 'production', APP_ORIGIN: 'https://kanban.example' });
    });

    it.each(['development', 'test', undefined])(
      'https com NODE_ENV=%s → erro (produção sem NODE_ENV=production)',
      (nodeEnv) => {
        expect(
          issuesOf({ ...base, NODE_ENV: nodeEnv, APP_ORIGIN: 'https://kanban.example' }),
        ).toEqual(['NODE_ENV']);
      },
    );

    it('desenvolvimento local em http continua válido', () => {
      expect(parseEnv({ ...base, APP_ORIGIN: 'http://127.0.0.1:5310' })).toMatchObject({
        NODE_ENV: 'development',
        APP_ORIGIN: 'http://127.0.0.1:5310',
      });
      expect(parseEnv({ ...base, NODE_ENV: 'test' }).NODE_ENV).toBe('test');
    });
  });

  it('não expõe valores na mensagem de erro', () => {
    const secret = 'postgres-senha-super-secreta';
    expect(() => parseEnv({ ...base, DATABASE_URL: secret })).toThrow(EnvValidationError);
    expect(() => parseEnv({ ...base, DATABASE_URL: secret })).not.toThrow(secret);
  });
});

describe('loadDotEnv', () => {
  const touched: string[] = [];
  afterEach(() => {
    for (const key of touched.splice(0)) Reflect.deleteProperty(process.env, key);
  });

  it('sobe até a raiz do workspace e não sobrescreve variáveis já definidas', () => {
    const root = mkdtempSync(join(tmpdir(), 'kanban-env-'));
    const nested = join(root, 'apps', 'api');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    writeFileSync(join(root, '.env'), 'KANBAN_T_FROM_FILE=file\nKANBAN_T_PRESET=file\n');
    touched.push('KANBAN_T_FROM_FILE', 'KANBAN_T_PRESET');
    process.env.KANBAN_T_PRESET = 'ambiente';

    expect(loadDotEnv(nested)).toBe(join(root, '.env'));
    expect(process.env.KANBAN_T_FROM_FILE).toBe('file');
    expect(process.env.KANBAN_T_PRESET).toBe('ambiente');
  });

  it('não passa da raiz do workspace', () => {
    const outer = mkdtempSync(join(tmpdir(), 'kanban-env-'));
    const root = join(outer, 'repo');
    mkdirSync(root);
    writeFileSync(join(outer, '.env'), 'KANBAN_T_OUTSIDE=1\n');
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    touched.push('KANBAN_T_OUTSIDE');

    expect(loadDotEnv(root)).toBeUndefined();
    expect(process.env.KANBAN_T_OUTSIDE).toBeUndefined();
  });
});
