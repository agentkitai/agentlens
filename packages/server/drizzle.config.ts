import { defineConfig } from 'drizzle-kit';

const dialect = process.env.DRIZZLE_DIALECT ?? 'postgresql';

export default defineConfig(
  dialect === 'sqlite'
    ? {
        schema: './src/db/schema.sqlite.ts',
        out: './drizzle',
        dialect: 'sqlite',
      }
    : {
        schema: './src/db/schema.postgres.ts',
        out: './src/db/drizzle',
        dialect: 'postgresql',
        dbCredentials: {
          url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/agentlens',
        },
      },
);
