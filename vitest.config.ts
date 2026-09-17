import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Sobe o PostgreSQL local de dev se TEST_DATABASE_URL não responder (test/global-setup.ts).
    globalSetup: ['./test/global-setup.ts'],
    // Os testes de integração compartilham um banco real (overview.md §11).
    fileParallelism: false,
  },
});
