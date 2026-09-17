import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EnvValidationError, loadDotEnv, parseEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://kanban:kanban@127.0.0.1:5432/kanban',
  APP_ORIGIN: 'http://localhost:5173',
};

const SETUP_TOKEN = 'codigo-de-setup-com-32-caracteres';

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
      SETUP_TOKEN,
    });
    expect(env.PORT).toBe(4010);
    expect(env.TRUST_PROXY).toBe(true);
    expect(parseEnv({ ...base, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
  });

  describe('TRUST_PROXY', () => {
    it.each([
      ['true', true],
      ['false', false],
      [' true ', true],
      ['1', 1],
      ['2', 2],
      ['127.0.0.1', ['127.0.0.1']],
      ['10.0.0.0/8', ['10.0.0.0/8']],
      ['10.0.0.0/8, 127.0.0.1 ,::1', ['10.0.0.0/8', '127.0.0.1', '::1']],
      ['fd00::/8,192.168.0.0/16', ['fd00::/8', '192.168.0.0/16']],
      ['loopback,uniquelocal', ['loopback', 'uniquelocal']],
    ])('%j → %j', (value, expected) => {
      expect(parseEnv({ ...base, TRUST_PROXY: value }).TRUST_PROXY).toEqual(expected);
    });

    it.each([
      'yes',
      'TRUE',
      '0',
      '101',
      '1.5',
      '-1',
      '10.0.0.0/33',
      '::1/129',
      '10.0.0.0/8/1',
      '10.0.0.0/',
      '300.1.1.1',
      'proxy.example.com',
      '127.0.0.1,abc',
      ',',
    ])('rejeita %j', (value) => {
      expect(issuesOf({ ...base, TRUST_PROXY: value })).toEqual(['TRUST_PROXY']);
    });
  });

  describe('SETUP_TOKEN', () => {
    it('opcional fora de produção', () => {
      expect(parseEnv(base).SETUP_TOKEN).toBeUndefined();
      expect(parseEnv({ ...base, SETUP_TOKEN }).SETUP_TOKEN).toBe(SETUP_TOKEN);
    });

    it('16 a 200 caracteres (com trim)', () => {
      expect(parseEnv({ ...base, SETUP_TOKEN: 'a'.repeat(16) }).SETUP_TOKEN).toBe('a'.repeat(16));
      expect(parseEnv({ ...base, SETUP_TOKEN: ` ${'a'.repeat(16)} ` }).SETUP_TOKEN).toBe(
        'a'.repeat(16),
      );
      expect(parseEnv({ ...base, SETUP_TOKEN: 'a'.repeat(200) }).SETUP_TOKEN).toHaveLength(200);
      expect(issuesOf({ ...base, SETUP_TOKEN: 'a'.repeat(15) })).toEqual(['SETUP_TOKEN']);
      expect(issuesOf({ ...base, SETUP_TOKEN: 'a'.repeat(201) })).toEqual(['SETUP_TOKEN']);
    });

    it('produção sem SETUP_TOKEN → erro de configuração (fail-closed)', () => {
      const prod = { ...base, NODE_ENV: 'production', APP_ORIGIN: 'https://kanban.example' };
      expect(issuesOf(prod)).toEqual(['SETUP_TOKEN']);
      expect(issuesOf({ ...prod, SETUP_TOKEN: '   ' })).toEqual(['SETUP_TOKEN']);
      expect(() => parseEnv(prod)).toThrow(/SETUP_TOKEN/);
      expect(parseEnv({ ...prod, SETUP_TOKEN }).SETUP_TOKEN).toBe(SETUP_TOKEN);
    });

    it('não expõe o valor na mensagem de erro', () => {
      const short = 'curto-secreto';
      expect(() => parseEnv({ ...base, SETUP_TOKEN: short })).not.toThrow(short);
    });
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
    [{ NODE_ENV: 'staging' }, 'NODE_ENV'],
    [{ LOG_LEVEL: 'verbose' }, 'LOG_LEVEL'],
  ])('rejeita %o', (override, variable) => {
    expect(issuesOf({ ...base, ...override })).toContain(variable);
  });

  describe('NODE_ENV × protocolo de APP_ORIGIN (fail-closed)', () => {
    it('produção exige https', () => {
      const prod = { ...base, NODE_ENV: 'production', SETUP_TOKEN };
      expect(issuesOf(prod)).toEqual(['APP_ORIGIN']);
      expect(issuesOf({ ...prod, APP_ORIGIN: 'http://kanban.example' })).toEqual(['APP_ORIGIN']);
      expect(parseEnv({ ...prod, APP_ORIGIN: 'https://kanban.example' })).toMatchObject({
        NODE_ENV: 'production',
        APP_ORIGIN: 'https://kanban.example',
      });
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
