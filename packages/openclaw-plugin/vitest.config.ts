import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'openclaw/plugin-sdk': new URL('./__tests__/__mocks__/openclaw/plugin-sdk.ts', import.meta.url).pathname,
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    passWithNoTests: true,
  },
});
