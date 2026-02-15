/**
 * Unit tests for audit logger (SH-2)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createAuditLogger, cleanupAuditLogs, maskSensitive } from '../audit.js';
import { createTestDb, type SqliteDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { auditLog } from '../../db/schema.sqlite.js';
import { sql } from 'drizzle-orm';

describe('createAuditLogger', () => {
  let db: SqliteDb;

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
  });

  it('writes an audit log entry', () => {
    const logger = createAuditLogger(db);
    logger.log({
      tenantId: 'tenant-1',
      actorType: 'user',
      actorId: 'user-123',
      action: 'api_key.create',
      resourceType: 'api_key',
      resourceId: 'key-456',
      details: { name: 'My Key' },
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
    });

    const rows = db.select().from(auditLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tenantId).toBe('tenant-1');
    expect(rows[0]!.actorType).toBe('user');
    expect(rows[0]!.actorId).toBe('user-123');
    expect(rows[0]!.action).toBe('api_key.create');
    expect(rows[0]!.resourceType).toBe('api_key');
    expect(rows[0]!.resourceId).toBe('key-456');
    expect(JSON.parse(rows[0]!.details)).toEqual({ name: 'My Key' });
    expect(rows[0]!.ipAddress).toBe('127.0.0.1');
    expect(rows[0]!.userAgent).toBe('test-agent');
  });

  it('does not throw on write failure', () => {
    const logger = createAuditLogger(db);
    // Close the db to simulate failure
    // @ts-expect-error — accessing internals
    const origRun = db.insert;
    // @ts-expect-error — monkey-patching for test
    db.insert = () => ({ values: () => ({ run: () => { throw new Error('DB closed'); } }) });

    expect(() => {
      logger.log({
        tenantId: 't',
        actorType: 'system',
        actorId: 'system',
        action: 'test',
      });
    }).not.toThrow();

    // Restore
    db.insert = origRun;
  });

  it('defaults details to empty object', () => {
    const logger = createAuditLogger(db);
    logger.log({
      tenantId: 'tenant-1',
      actorType: 'api_key',
      actorId: 'key-1',
      action: 'session.view',
    });

    const rows = db.select().from(auditLog).all();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.details)).toEqual({});
    expect(rows[0]!.resourceType).toBeNull();
    expect(rows[0]!.resourceId).toBeNull();
  });
});

describe('cleanupAuditLogs', () => {
  let db: SqliteDb;

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
  });

  it('deletes entries older than retention period', () => {
    const logger = createAuditLogger(db);

    // Insert an old entry directly
    db.insert(auditLog).values({
      id: 'old-1',
      timestamp: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
      tenantId: 'tenant-1',
      actorType: 'system',
      actorId: 'system',
      action: 'old.action',
      details: '{}',
    }).run();

    // Insert a recent entry
    logger.log({
      tenantId: 'tenant-1',
      actorType: 'system',
      actorId: 'system',
      action: 'recent.action',
    });

    const deleted = cleanupAuditLogs(db, 90);
    expect(deleted).toBe(1);

    const remaining = db.select().from(auditLog).all();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.action).toBe('recent.action');
  });
});

describe('maskSensitive', () => {
  it('masks strings longer than 8 chars', () => {
    expect(maskSensitive('als_abc123def456')).toBe('als_abc1…');
  });

  it('returns short strings unchanged', () => {
    expect(maskSensitive('short')).toBe('short');
    expect(maskSensitive('12345678')).toBe('12345678');
  });
});
