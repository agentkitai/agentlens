/**
 * PostgreSQL migration runner — applies Drizzle Kit generated migrations.
 *
 * Uses the drizzle-orm/postgres-js migrator which reads SQL files from
 * the migrations folder and tracks applied migrations in a
 * `drizzle.__drizzle_migrations` table (idempotent).
 */

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { PostgresDb } from './connection.postgres.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Default migrations folder — co-located under src/db/drizzle (copied to dist/db/drizzle at build). */
const DEFAULT_MIGRATIONS_FOLDER = path.resolve(__dirname, 'drizzle');

/**
 * Run all pending Drizzle Kit migrations against Postgres.
 *
 * Safe to call on every startup — already-applied migrations are skipped
 * via the `__drizzle_migrations` journal table.
 */
export async function runPostgresMigrations(
  db: PostgresDb,
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER,
): Promise<void> {
  await migrate(db, { migrationsFolder });
}
