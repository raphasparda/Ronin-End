import { defineConfig } from 'tsup';

/**
 * Build da API (overview.md §2/§3): um bundle ESM para Node 24 em `dist/`.
 * `@kanban/shared` é consumido como fonte TS, então entra no bundle; as demais dependências
 * ficam externas e são resolvidas de `node_modules` em runtime.
 */
export default defineConfig({
  entry: { server: 'src/server.ts' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  noExternal: ['@kanban/shared'],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  shims: false,
});
