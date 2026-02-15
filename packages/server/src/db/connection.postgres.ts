/**
 * PostgreSQL connection via postgres.js + Drizzle ORM.
 *
 * Production-grade pool configuration with env-driven tuning.
 */

import postgres, { type Sql } from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.postgres.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('Postgres');

export type PostgresDb = PostgresJsDatabase<typeof schema>;

export interface CreatePostgresDbOptions {
  /** PostgreSQL connection string (defaults to DATABASE_URL env var) */
  databaseUrl?: string;
}

export interface PostgresConnection {
  /** Drizzle ORM instance */
  db: PostgresDb;
  /** Raw postgres.js client — needed for graceful shutdown (sql.end()) */
  sql: Sql;
}

/**
 * Create a Drizzle PostgreSQL instance backed by postgres.js.
 *
 * Returns both the Drizzle wrapper and the raw sql client so callers
 * can drain the pool on shutdown.
 */
export function createPostgresConnection(options: CreatePostgresDbOptions = {}): PostgresConnection {
  const url = options.databaseUrl ?? process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('PostgreSQL requires DATABASE_URL env var or databaseUrl option.');
  }

  // Pool configuration from env vars
  const max = parseInt(process.env['PG_POOL_MAX'] ?? '20', 10);
  const idleTimeout = parseInt(process.env['PG_IDLE_TIMEOUT'] ?? '30', 10);

  // SSL: enabled if DB_SSL=true or connection string contains sslmode=require
  const sslFromEnv = process.env['DB_SSL'] === 'true';
  const sslFromUrl = url.includes('sslmode=require');
  const ssl = sslFromEnv || sslFromUrl ? 'require' as const : undefined;

  const client = postgres(url, {
    max,
    idle_timeout: idleTimeout,
    connect_timeout: 10,
    max_lifetime: 1800,
    connection: {
      application_name: 'agentlens',
    },
    ...(ssl ? { ssl } : {}),
    onnotice: (notice) => {
      log.debug(`PG notice: ${notice.message}`);
    },
  });

  const db = drizzle(client, { schema });
  return { db, sql: client };
}

/**
 * Create a Drizzle PostgreSQL instance (legacy API — returns only the Drizzle wrapper).
 * @deprecated Use createPostgresConnection() instead for shutdown support.
 */
export function createPostgresDb(options: CreatePostgresDbOptions = {}): PostgresDb {
  return createPostgresConnection(options).db;
}

/**
 * Verify Postgres connectivity. Throws with a clear message if unreachable.
 * Called at startup to fail fast.
 */
export async function verifyPostgresConnection(sql: Sql): Promise<void> {
  try {
    await sql`SELECT 1`;
    log.info('PostgreSQL connection verified');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`PostgreSQL unreachable at startup: ${msg}`);
  }
}

/**
 * Run a health-check query. Returns latency in ms.
 */
export async function postgresHealthCheck(sql: Sql): Promise<{ ok: boolean; latencyMs: number }> {
  const start = performance.now();
  try {
    await sql`SELECT 1`;
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch {
    return { ok: false, latencyMs: Math.round(performance.now() - start) };
  }
}
