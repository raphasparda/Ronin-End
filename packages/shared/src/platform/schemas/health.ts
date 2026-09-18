import { z } from 'zod';

/** `GET /api/health` → 200 (api.md §4). Banco fora → 503 `SERVICE_UNAVAILABLE`. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  db: z.literal('ok'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
