/**
 * Database migration runner.
 *
 * For SQLite, uses Drizzle's push-based approach to create/update tables
 * on first start. For production, Drizzle Kit migrations can be used.
 */

import { sql } from 'drizzle-orm';
import type { SqliteDb } from './index.js';
/**
 * Run migrations: create all tables and indexes if they don't exist.
 *
 * Uses CREATE TABLE IF NOT EXISTS for idempotent startup.
 * This approach is simpler than file-based migrations for an
 * embedded SQLite database that auto-creates on first start.
 */
export function runMigrations(db: SqliteDb): void {
  // Create all tables using raw SQL for CREATE IF NOT EXISTS
  // Drizzle doesn't have a built-in "push" that works at runtime,
  // so we use the schema definitions to generate DDL.
  db.run(sql`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      payload TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      prev_hash TEXT,
      hash TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      agent_name TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      event_count INTEGER NOT NULL DEFAULT 0,
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      total_cost_usd REAL NOT NULL DEFAULT 0,
      llm_call_count INTEGER NOT NULL DEFAULT 0,
      total_input_tokens INTEGER NOT NULL DEFAULT 0,
      total_output_tokens INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]'
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      session_count INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      condition TEXT NOT NULL,
      threshold REAL NOT NULL,
      window_minutes INTEGER NOT NULL,
      scope TEXT NOT NULL DEFAULT '{}',
      notify_channels TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS alert_history (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL REFERENCES alert_rules(id),
      triggered_at TEXT NOT NULL,
      resolved_at TEXT,
      current_value REAL NOT NULL,
      threshold REAL NOT NULL,
      message TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      key_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      scopes TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      revoked_at INTEGER,
      rate_limit INTEGER
    )
  `);

  // Create indexes (IF NOT EXISTS)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_events_agent_id ON events(agent_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_events_session_ts ON events(session_id, timestamp)`);
  db.run(
    sql`CREATE INDEX IF NOT EXISTS idx_events_agent_type_ts ON events(agent_id, event_type, timestamp)`,
  );
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_alert_history_rule_id ON alert_history(rule_id)`);

  // ─── Migrations for existing databases ──────────────────
  // Add LLM tracking columns to sessions (v0.3.0)
  // SQLite doesn't support ADD COLUMN IF NOT EXISTS, so we check first
  const sessionColumns = db.all<{ name: string }>(sql`PRAGMA table_info(sessions)`);
  const columnNames = new Set(sessionColumns.map((c) => c.name));
  if (!columnNames.has('llm_call_count')) {
    db.run(sql`ALTER TABLE sessions ADD COLUMN llm_call_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columnNames.has('total_input_tokens')) {
    db.run(sql`ALTER TABLE sessions ADD COLUMN total_input_tokens INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columnNames.has('total_output_tokens')) {
    db.run(sql`ALTER TABLE sessions ADD COLUMN total_output_tokens INTEGER NOT NULL DEFAULT 0`);
  }
}

/**
 * Verify that WAL mode is enabled.
 */
export function verifyPragmas(db: SqliteDb): {
  journalMode: string;
  synchronous: string;
  cacheSize: number;
  busyTimeout: number;
  foreignKeys: boolean;
} {
  const journalMode =
    db.get<{ journal_mode: string }>(sql`PRAGMA journal_mode`)?.journal_mode ?? '';
  const synchronous = db.get<{ synchronous: number }>(sql`PRAGMA synchronous`)?.synchronous ?? -1;
  const cacheSize = db.get<{ cache_size: number }>(sql`PRAGMA cache_size`)?.cache_size ?? 0;
  // SQLite returns { timeout: N } for PRAGMA busy_timeout
  const busyTimeout = db.get<{ timeout: number }>(sql`PRAGMA busy_timeout`)?.timeout ?? 0;
  const foreignKeys =
    db.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`)?.foreign_keys === 1;

  // synchronous: 0=OFF, 1=NORMAL, 2=FULL, 3=EXTRA
  const syncNames: Record<number, string> = { 0: 'OFF', 1: 'NORMAL', 2: 'FULL', 3: 'EXTRA' };

  return {
    journalMode,
    synchronous: syncNames[synchronous] ?? String(synchronous),
    cacheSize,
    busyTimeout,
    foreignKeys,
  };
}
