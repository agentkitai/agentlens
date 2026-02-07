/**
 * Database initialization — dialect selector.
 *
 * Creates the appropriate Drizzle ORM instance based on DB_DIALECT env var.
 * SQLite (default) uses WAL mode with tuned pragmas.
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.sqlite.js';

export type SqliteDb = BetterSQLite3Database<typeof schema>;

export interface CreateDbOptions {
  /** Database dialect: 'sqlite' (default) or 'postgresql' */
  dialect?: 'sqlite' | 'postgresql';
  /** SQLite file path (default: './agentlens.db'). Use ':memory:' for tests. */
  databasePath?: string;
  /** PostgreSQL connection string */
  databaseUrl?: string;
}

/**
 * Create a database connection with the appropriate dialect.
 *
 * For SQLite, applies performance pragmas:
 * - journal_mode=WAL (concurrent read/write)
 * - synchronous=NORMAL (durability/performance balance)
 * - cache_size=-64000 (64MB page cache)
 * - busy_timeout=5000 (5s wait on locks)
 */
export function createDb(options: CreateDbOptions = {}): SqliteDb {
  const dialect =
    options.dialect ??
    (process.env['DB_DIALECT'] as 'sqlite' | 'postgresql' | undefined) ??
    'sqlite';

  if (dialect === 'postgresql') {
    // PostgreSQL support is deferred — interface defined, implementation later
    throw new Error('PostgreSQL dialect is not yet implemented. Use DB_DIALECT=sqlite (default).');
  }

  const dbPath = options.databasePath ?? process.env['DATABASE_PATH'] ?? './agentlens.db';
  const sqlite = new Database(dbPath);

  // Apply SQLite performance pragmas per Architecture §6.4
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('cache_size = -64000');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');

  return drizzle(sqlite, { schema });
}

/**
 * Create an in-memory SQLite database for testing.
 * Tables are created via push (no migration files needed).
 */
export function createTestDb(): SqliteDb {
  return createDb({ databasePath: ':memory:' });
}
