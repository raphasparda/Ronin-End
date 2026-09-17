import { defineConfig } from 'tsup';

/**
 * Build publicável de `@raphasparda/ronin-shared` (GitHub Packages): ESM + `.d.ts` em `dist/`.
 * Dentro deste repositório a API consome a fonte TS (`exports` aponta para `src/`); o `pnpm pack`/
 * `pnpm publish` troca `exports`/`types` pelos de `publishConfig` (apontando para `dist/`).
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'test-fixtures': 'src/test-fixtures.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  treeshake: true,
});
