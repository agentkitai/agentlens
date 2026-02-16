import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/__tests__/postgres-integration.test.ts',
      'src/cloud/**/*.test.ts',
    ],
    exclude: ['dist/**', 'node_modules/**'],
    passWithNoTests: true,
  },
});
