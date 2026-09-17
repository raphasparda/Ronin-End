import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/test-fixtures.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        // DoD da tarefa 0.3: regras de domínio com cobertura >= 95%.
        'src/domain/**': { statements: 95, branches: 95, functions: 95, lines: 95 },
      },
    },
  },
});
