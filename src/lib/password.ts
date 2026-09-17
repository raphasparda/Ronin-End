import { randomBytes } from 'node:crypto';

import { hash, verify, type Algorithm } from '@node-rs/argon2';

/** `Algorithm.Argon2id` (const enum ambiente: não acessível com `verbatimModuleSyntax`). */
const ARGON2ID = 2 as Algorithm.Argon2id;

export interface Argon2Params {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  outputLen: number;
}

/** Parâmetros OWASP para Argon2id (ADR 0003, overview.md §6.1). */
export const PRODUCTION_PARAMS: Argon2Params = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

/** Parâmetros leves, só com `NODE_ENV=test` (ADR 0003). Nunca usar fora dos testes. */
export const TEST_PARAMS: Argon2Params = {
  memoryCost: 1_024,
  timeCost: 1,
  parallelism: 1,
  outputLen: 32,
};

export function argon2ParamsFor(nodeEnv: string | undefined): Argon2Params {
  return nodeEnv === 'test' ? TEST_PARAMS : PRODUCTION_PARAMS;
}

export interface PasswordHasher {
  readonly params: Argon2Params;
  /** Hash Argon2id (PHC string com salt aleatório). */
  hash(password: string): Promise<string>;
  /** `true` se a senha confere. Hash malformado conta como senha errada (nunca lança). */
  verify(passwordHash: string, password: string): Promise<boolean>;
  /**
   * Verifica contra um hash fictício com os mesmos parâmetros (resultado sempre `false`).
   * Usado quando o usuário não existe ou não pode entrar, para o login levar o mesmo tempo.
   */
  verifyDummy(password: string): Promise<false>;
}

export function createPasswordHasher(params: Argon2Params): PasswordHasher {
  const options = { algorithm: ARGON2ID, ...params };
  let dummyHash: Promise<string> | undefined;

  const verifySafe = async (passwordHash: string, password: string): Promise<boolean> => {
    try {
      return await verify(passwordHash, password, options);
    } catch {
      return false;
    }
  };

  return {
    params,
    hash: (password) => hash(password, options),
    verify: verifySafe,
    async verifyDummy(password) {
      // Gerado uma vez por processo, com os mesmos parâmetros dos hashes reais (tempo equivalente).
      dummyHash ??= hash(randomBytes(32).toString('base64url'), options);
      await verifySafe(await dummyHash, password);
      return false;
    },
  };
}
