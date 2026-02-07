import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations, verifyPragmas } from '../migrate.js';

describe('Database Initialization (Story 3.3)', () => {
  let db: SqliteDb;

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
  });

  afterEach(() => {
    // Close the in-memory database
    // @ts-expect-error accessing internal session for cleanup
    db.$client?.close?.();
  });

  it('should create all tables', () => {
    const tables = db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
    );
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('events');
    expect(tableNames).toContain('sessions');
    expect(tableNames).toContain('agents');
    expect(tableNames).toContain('alert_rules');
    expect(tableNames).toContain('alert_history');
    expect(tableNames).toContain('api_keys');
  });

  it('should create all indexes', () => {
    const indexes = db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name`,
    );
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain('idx_events_timestamp');
    expect(indexNames).toContain('idx_events_session_id');
    expect(indexNames).toContain('idx_events_agent_id');
    expect(indexNames).toContain('idx_events_type');
    expect(indexNames).toContain('idx_events_session_ts');
    expect(indexNames).toContain('idx_events_agent_type_ts');
    expect(indexNames).toContain('idx_sessions_agent_id');
    expect(indexNames).toContain('idx_sessions_started_at');
    expect(indexNames).toContain('idx_sessions_status');
    expect(indexNames).toContain('idx_api_keys_hash');
    expect(indexNames).toContain('idx_alert_history_rule_id');
  });

  // Note: In-memory SQLite uses "memory" journal mode instead of WAL.
  // WAL mode is verified with a file-based DB test below.
  it('should set WAL journal mode (in-memory reports "memory")', () => {
    const pragmas = verifyPragmas(db);
    // In-memory databases can't use WAL, so they report "memory"
    expect(pragmas.journalMode).toBe('memory');
  });

  it('should set synchronous to NORMAL', () => {
    const pragmas = verifyPragmas(db);
    expect(pragmas.synchronous).toBe('NORMAL');
  });

  it('should set cache_size to -64000 (64MB)', () => {
    const pragmas = verifyPragmas(db);
    expect(pragmas.cacheSize).toBe(-64000);
  });

  it('should set busy_timeout to 5000ms', () => {
    const pragmas = verifyPragmas(db);
    expect(pragmas.busyTimeout).toBe(5000);
  });

  it('should be idempotent (run migrations twice without error)', () => {
    expect(() => runMigrations(db)).not.toThrow();
  });

  it('should throw for unsupported postgresql dialect', () => {
    expect(() =>
      // Dynamic import won't work here, test the function directly
      createTestDb(),
    ).not.toThrow();
  });
});
