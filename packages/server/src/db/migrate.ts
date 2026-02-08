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
      id TEXT NOT NULL,
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
      tags TEXT NOT NULL DEFAULT '[]',
      tenant_id TEXT NOT NULL DEFAULT 'default',
      PRIMARY KEY (id, tenant_id)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      session_count INTEGER NOT NULL DEFAULT 0,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      PRIMARY KEY (id, tenant_id)
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
  const sessionColumnNames = new Set(sessionColumns.map((c) => c.name));
  if (!sessionColumnNames.has('llm_call_count')) {
    db.run(sql`ALTER TABLE sessions ADD COLUMN llm_call_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!sessionColumnNames.has('total_input_tokens')) {
    db.run(sql`ALTER TABLE sessions ADD COLUMN total_input_tokens INTEGER NOT NULL DEFAULT 0`);
  }
  if (!sessionColumnNames.has('total_output_tokens')) {
    db.run(sql`ALTER TABLE sessions ADD COLUMN total_output_tokens INTEGER NOT NULL DEFAULT 0`);
  }

  // ─── Tenant isolation migration (Epic 1) ──────────────────
  // Add tenant_id to all data tables for multi-tenant support

  // api_keys.tenant_id
  const apiKeyColumns = db.all<{ name: string }>(sql`PRAGMA table_info(api_keys)`);
  const apiKeyColumnNames = new Set(apiKeyColumns.map((c) => c.name));
  if (!apiKeyColumnNames.has('tenant_id')) {
    db.run(sql`ALTER TABLE api_keys ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'`);
  }

  // events.tenant_id
  const eventColumns = db.all<{ name: string }>(sql`PRAGMA table_info(events)`);
  const eventColumnNames = new Set(eventColumns.map((c) => c.name));
  if (!eventColumnNames.has('tenant_id')) {
    db.run(sql`ALTER TABLE events ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'`);
  }

  // sessions.tenant_id
  if (!sessionColumnNames.has('tenant_id')) {
    db.run(sql`ALTER TABLE sessions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'`);
  }

  // agents.tenant_id
  const agentColumns = db.all<{ name: string }>(sql`PRAGMA table_info(agents)`);
  const agentColumnNames = new Set(agentColumns.map((c) => c.name));
  if (!agentColumnNames.has('tenant_id')) {
    db.run(sql`ALTER TABLE agents ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'`);
  }

  // alert_rules.tenant_id
  const alertRuleColumns = db.all<{ name: string }>(sql`PRAGMA table_info(alert_rules)`);
  const alertRuleColumnNames = new Set(alertRuleColumns.map((c) => c.name));
  if (!alertRuleColumnNames.has('tenant_id')) {
    db.run(sql`ALTER TABLE alert_rules ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'`);
  }

  // alert_history.tenant_id
  const alertHistoryColumns = db.all<{ name: string }>(sql`PRAGMA table_info(alert_history)`);
  const alertHistoryColumnNames = new Set(alertHistoryColumns.map((c) => c.name));
  if (!alertHistoryColumnNames.has('tenant_id')) {
    db.run(sql`ALTER TABLE alert_history ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'`);
  }

  // Tenant isolation indexes
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_events_tenant_id ON events(tenant_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_events_tenant_session ON events(tenant_id, session_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_events_tenant_agent_ts ON events(tenant_id, agent_id, timestamp)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_sessions_tenant_id ON sessions(tenant_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_sessions_tenant_agent ON sessions(tenant_id, agent_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_sessions_tenant_started ON sessions(tenant_id, started_at)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_agents_tenant_id ON agents(tenant_id)`);

  // ─── Embeddings table (Epic 2 — Story 2.2) ──────────────────
  db.run(sql`
    CREATE TABLE IF NOT EXISTS embeddings (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      text_content TEXT NOT NULL,
      embedding BLOB NOT NULL,
      embedding_model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_embeddings_tenant ON embeddings(tenant_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_embeddings_source ON embeddings(source_type, source_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_embeddings_content_hash ON embeddings(tenant_id, content_hash)`);

  // ─── Session Summaries table (Epic 2 — Story 2.2) ──────────────────
  db.run(sql`
    CREATE TABLE IF NOT EXISTS session_summaries (
      session_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      topics TEXT NOT NULL DEFAULT '[]',
      tool_sequence TEXT NOT NULL DEFAULT '[]',
      error_summary TEXT,
      outcome TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (session_id, tenant_id)
    )
  `);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_session_summaries_tenant ON session_summaries(tenant_id)`);

  // ─── Composite PK migration (CRITICAL-2) ──────────────────
  // SQLite doesn't support ALTER TABLE to change PKs, so we recreate
  // tables with composite PKs (id, tenant_id) for tenant isolation.

  // Check if sessions table still has single-column PK
  // by looking at the CREATE TABLE statement
  const sessionsSchema = db.get<{ sql: string }>(
    sql`SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'`,
  );
  if (sessionsSchema && sessionsSchema.sql.includes('id TEXT PRIMARY KEY')) {
    // Drop old indexes that reference sessions (they'll be recreated)
    db.run(sql`DROP INDEX IF EXISTS idx_sessions_agent_id`);
    db.run(sql`DROP INDEX IF EXISTS idx_sessions_started_at`);
    db.run(sql`DROP INDEX IF EXISTS idx_sessions_status`);
    db.run(sql`DROP INDEX IF EXISTS idx_sessions_tenant_id`);
    db.run(sql`DROP INDEX IF EXISTS idx_sessions_tenant_agent`);
    db.run(sql`DROP INDEX IF EXISTS idx_sessions_tenant_started`);

    db.run(sql`
      CREATE TABLE sessions_new (
        id TEXT NOT NULL,
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
        tags TEXT NOT NULL DEFAULT '[]',
        tenant_id TEXT NOT NULL DEFAULT 'default',
        PRIMARY KEY (id, tenant_id)
      )
    `);
    db.run(sql`
      INSERT INTO sessions_new
        SELECT id, agent_id, agent_name, started_at, ended_at, status,
               event_count, tool_call_count, error_count, total_cost_usd,
               llm_call_count, total_input_tokens, total_output_tokens,
               tags, tenant_id
        FROM sessions
    `);
    db.run(sql`DROP TABLE sessions`);
    db.run(sql`ALTER TABLE sessions_new RENAME TO sessions`);

    // Recreate indexes
    db.run(sql`CREATE INDEX idx_sessions_agent_id ON sessions(agent_id)`);
    db.run(sql`CREATE INDEX idx_sessions_started_at ON sessions(started_at)`);
    db.run(sql`CREATE INDEX idx_sessions_status ON sessions(status)`);
    db.run(sql`CREATE INDEX idx_sessions_tenant_id ON sessions(tenant_id)`);
    db.run(sql`CREATE INDEX idx_sessions_tenant_agent ON sessions(tenant_id, agent_id)`);
    db.run(sql`CREATE INDEX idx_sessions_tenant_started ON sessions(tenant_id, started_at)`);
  }

  // Check if agents table still has single-column PK
  const agentsSchema = db.get<{ sql: string }>(
    sql`SELECT sql FROM sqlite_master WHERE type='table' AND name='agents'`,
  );
  if (agentsSchema && agentsSchema.sql.includes('id TEXT PRIMARY KEY')) {
    db.run(sql`DROP INDEX IF EXISTS idx_agents_tenant_id`);

    db.run(sql`
      CREATE TABLE agents_new (
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        session_count INTEGER NOT NULL DEFAULT 0,
        tenant_id TEXT NOT NULL DEFAULT 'default',
        PRIMARY KEY (id, tenant_id)
      )
    `);
    db.run(sql`
      INSERT INTO agents_new
        SELECT id, name, description, first_seen_at, last_seen_at,
               session_count, tenant_id
        FROM agents
    `);
    db.run(sql`DROP TABLE agents`);
    db.run(sql`ALTER TABLE agents_new RENAME TO agents`);

    db.run(sql`CREATE INDEX idx_agents_tenant_id ON agents(tenant_id)`);
  }

  // ─── Lessons table (Epic 3) ──────────────────────────────
  db.run(sql`
    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      agent_id TEXT,
      category TEXT NOT NULL DEFAULT 'general',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '{}',
      importance TEXT NOT NULL DEFAULT 'normal',
      source_session_id TEXT,
      source_event_id TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_lessons_tenant ON lessons(tenant_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_lessons_tenant_agent ON lessons(tenant_id, agent_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_lessons_tenant_category ON lessons(tenant_id, category)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_lessons_tenant_importance ON lessons(tenant_id, importance)`);
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
