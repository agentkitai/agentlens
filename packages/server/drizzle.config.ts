import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.sqlite.ts',
  out: './drizzle',
  dialect: 'sqlite',
});
