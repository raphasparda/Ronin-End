import { createHash, randomBytes } from 'node:crypto';

/** Bytes de entropia dos tokens opacos (sessão, convite, redefinição): 32 bytes (overview.md §6.2). */
export const TOKEN_BYTES = 32;

/** Formato do token em base64url sem padding: 32 bytes → 43 caracteres (api.md §2). */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Token aleatório (CSPRNG) em base64url. Vai só para o cliente; o banco guarda `sha256Hex(token)`. */
export function randomToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** `true` se o valor tem o formato de um token gerado por `randomToken()`. */
export function isTokenFormat(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

/** SHA-256 em hex minúsculo (64 caracteres), formato de `sessions.id` e `auth_tokens.token_hash`. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
