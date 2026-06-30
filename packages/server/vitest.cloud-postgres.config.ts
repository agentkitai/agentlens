import { defineConfig } from 'vitest/config';

// Cloud-edition tests against a live Postgres (#256 harness). Each cloud test
// file connects via DATABASE_URL, DROPs all tables, and re-runs the cloud
// migrations — so the files MUST run serially (fileParallelism: false) or they
// clobber each other's schema on the shared database. Run by the test-postgres
// CI job as a separate step from postgres-integration so failures are isolated.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/cloud/__tests__/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    passWithNoTests: true,
  },
});
