import { defineConfig } from 'drizzle-kit';

import { loadDotEnv } from './src/config/env';

loadDotEnv();

/**
 * `pnpm db:generate` gera o SQL em `drizzle/` a partir de `src/db/schema`. Revise o SQL antes de
 * commitar e nunca edite uma migration já aplicada. Aplicação: `pnpm db:migrate` (src/db/migrate.ts).
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
  // Só usado por comandos que conectam (ex.: `drizzle-kit studio`/`check`); `generate` não conecta.
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
