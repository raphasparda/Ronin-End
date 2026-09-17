import { describe, expect, it } from 'vitest';

import { argon2ParamsFor, createPasswordHasher, PRODUCTION_PARAMS, TEST_PARAMS } from './password';

describe('lib/password', () => {
  const hasher = createPasswordHasher(TEST_PARAMS);

  it('parâmetros OWASP fora de teste; leves só com NODE_ENV=test', () => {
    expect(PRODUCTION_PARAMS).toEqual({
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });
    expect(argon2ParamsFor('production')).toBe(PRODUCTION_PARAMS);
    expect(argon2ParamsFor('development')).toBe(PRODUCTION_PARAMS);
    expect(argon2ParamsFor(undefined)).toBe(PRODUCTION_PARAMS);
    expect(argon2ParamsFor('test')).toBe(TEST_PARAMS);
  });

  it('gera Argon2id (PHC) com salt aleatório e verifica', async () => {
    const a = await hasher.hash('senha-muito-segura');
    const b = await hasher.hash('senha-muito-segura');
    expect(a).toMatch(/^\$argon2id\$v=19\$m=1024,t=1,p=1\$/);
    expect(a).not.toBe(b);
    expect(await hasher.verify(a, 'senha-muito-segura')).toBe(true);
    expect(await hasher.verify(a, 'senha-errada-demais')).toBe(false);
  });

  it('produção usa m=19456,t=2,p=1', async () => {
    const hash = await createPasswordHasher(PRODUCTION_PARAMS).hash('senha-muito-segura');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('hash malformado conta como senha errada (não lança)', async () => {
    expect(await hasher.verify('nao-e-um-hash', 'qualquer')).toBe(false);
  });

  it('verifyDummy sempre falha', async () => {
    expect(await hasher.verifyDummy('senha-muito-segura')).toBe(false);
    expect(await hasher.verifyDummy('')).toBe(false);
  });
});
