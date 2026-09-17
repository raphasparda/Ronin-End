import { defineConfig } from 'tsup';

/**
 * Build da API (overview.md §2/§3): bundles ESM para Node 24 em `dist/`:
 * - `dist/server.js`: servidor HTTP;
 * - `dist/migrate.js`: aplica as migrations de `drizzle/` (ou `MIGRATIONS_DIR`) sem `tsx`
 *   (`pnpm start:prod` roda os dois em sequência, overview.md §10).
 * `@raphasparda/ronin-shared` é consumido como fonte TS, então entra no bundle; as demais dependências
 * ficam externas e são resolvidas de `node_modules` em runtime.
 */
export default defineConfig({
  entry: { server: 'src/server.ts', migrate: 'src/db/migrate.ts' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  noExternal: ['@raphasparda/ronin-shared'],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  shims: false,
});
