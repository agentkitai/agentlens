/**
 * Database migration dispatcher.
 *
 * Re-exports the SQLite migration runner (default path) and provides
 * a Postgres migration runner for the Drizzle Kit managed migration flow.
 */

// Re-export SQLite migrations — keeps every existing import working unchanged.
export { runMigrations, verifyPragmas } from './migrate.sqlite.js';

// Postgres programmatic migration (Drizzle Kit managed folder)
export { runPostgresMigrations } from './migrate.postgres.js';
