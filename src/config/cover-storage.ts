import { createR2Client, type R2Client } from '../lib/r2';

import type { Env } from './env';

/**
 * Cliente do bucket de capas (ADR 0016) ou `null` quando a instância não tem R2 configurado.
 * As quatro variáveis são tudo ou nada (`config/env.ts`), então basta olhar uma delas para saber
 * se o recurso está ligado. Sem R2: `features.cardCovers: false`, `cover` sempre `null` e as rotas
 * de capa respondem `503 COVER_STORAGE_UNAVAILABLE` — o resto do app não muda.
 */
export function createCoverStorage(env: Env): R2Client | null {
  const { R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
  if (!R2_ACCOUNT_ID || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;
  return createR2Client({
    endpoint: env.R2_ENDPOINT ?? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    bucket: R2_BUCKET,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    publicBaseUrl: env.R2_PUBLIC_BASE_URL,
  });
}
