/**
 * Dialect-agnostic DB helpers (#172).
 *
 * SQLite (better-sqlite3) is synchronous (`db.run/all/get`); Postgres
 * (postgres-js in prod, node-postgres in the integration tests) is async
 * (`db.execute`). These wrap both behind one async surface so a single feature
 * store works on BOTH dialects without twin classes.
 *
 * The drizzle `sql`...${v}...`` template binds parameters correctly for each
 * driver, so feature stores keep their raw SQL and only route the execution
 * through here. Use ON CONFLICT (valid on sqlite ≥3.24 and pg) for upserts —
 * never `INSERT OR REPLACE` (SQLite-only).
 */
import type { SQL } from 'drizzle-orm';
import type { SqliteDb } from './index.js';
import type { PostgresDb } from './connection.postgres.js';

export type AnyDb = SqliteDb | PostgresDb;

/** better-sqlite3 drizzle exposes a synchronous `.all`; the pg drivers do not. */
export function isSqliteDb(db: AnyDb): db is SqliteDb {
  return typeof (db as { all?: unknown }).all === 'function';
}

/** Execute a write (INSERT/UPDATE/DELETE/DDL). */
export async function dbRun(db: AnyDb, query: SQL): Promise<void> {
  if (isSqliteDb(db)) {
    db.run(query);
  } else {
    await db.execute(query);
  }
}

/** Execute a read, returning all rows (snake_case keys, as stored). */
export async function dbAll<T>(db: AnyDb, query: SQL): Promise<T[]> {
  if (isSqliteDb(db)) {
    return db.all(query) as T[];
  }
  // postgres-js returns an array-like RowList; node-postgres returns { rows }.
  const res: unknown = await db.execute(query);
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: unknown[] }).rows ?? []) as T[];
}

/** Execute a read, returning the first row or undefined. */
export async function dbGet<T>(db: AnyDb, query: SQL): Promise<T | undefined> {
  return (await dbAll<T>(db, query))[0];
}

/** Execute a write, returning the number of affected rows. */
export async function dbRunCount(db: AnyDb, query: SQL): Promise<number> {
  if (isSqliteDb(db)) {
    return db.run(query).changes;
  }
  // postgres-js exposes `.count`; node-postgres exposes `.rowCount`.
  const res = (await db.execute(query)) as { count?: number; rowCount?: number };
  return res.count ?? res.rowCount ?? 0;
}
