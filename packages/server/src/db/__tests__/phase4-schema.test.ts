/**
 * Tests for Phase 4 Tenant-Local Schema (Story 1.3)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import * as schema from '../schema.sqlite.js';

describe('Phase 4 Schema (Story 1.3)', () => {
  let db: SqliteDb;

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
  });

  afterEach(() => {
    // @ts-expect-error accessing internal session for cleanup
    db.$client?.close?.();
  });

  // ─── Table existence ────────────────────────────────────

  const PHASE4_TABLES = [
    'sharing_config',
    'agent_sharing_config',
    'deny_list_rules',
    'sharing_audit_log',
    'sharing_review_queue',
    'anonymous_id_map',
    'capability_registry',
    'delegation_log',
  ];

  it('should create all 8 Phase 4 tables', () => {
    const tables = db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
    );
    const tableNames = tables.map((t) => t.name);

    for (const table of PHASE4_TABLES) {
      expect(tableNames, `Missing table: ${table}`).toContain(table);
    }
  });

  it('should not modify existing tables', () => {
    // Verify existing tables still exist and work
    const existingTables = ['events', 'sessions', 'agents', 'lessons', 'embeddings'];
    const tables = db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
    );
    const tableNames = tables.map((t) => t.name);
    for (const t of existingTables) {
      expect(tableNames).toContain(t);
    }
  });

  // ─── Index existence ───────────────────────────────────

  const PHASE4_INDEXES = [
    'idx_deny_list_rules_tenant',
    'idx_sharing_audit_tenant_ts',
    'idx_sharing_audit_type',
    'idx_review_queue_tenant_status',
    'idx_anon_map_anon_id',
    'idx_capability_tenant_agent',
    'idx_capability_task_type',
    'idx_delegation_tenant_ts',
    'idx_delegation_agent',
    'idx_delegation_status',
  ];

  it('should create all Phase 4 indexes', () => {
    const indexes = db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name`,
    );
    const indexNames = indexes.map((i) => i.name);

    for (const idx of PHASE4_INDEXES) {
      expect(indexNames, `Missing index: ${idx}`).toContain(idx);
    }
  });

  // ─── sharing_config table ───────────────────────────────

  it('should insert and read sharing_config', () => {
    db.insert(schema.sharingConfig).values({
      tenantId: 'tenant-1',
      enabled: false,
      humanReviewEnabled: false,
      rateLimitPerHour: 50,
      volumeAlertThreshold: 100,
      updatedAt: new Date().toISOString(),
    }).run();

    const rows = db.select().from(schema.sharingConfig).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tenantId).toBe('tenant-1');
    expect(rows[0]!.enabled).toBe(false);
  });

  it('should default sharing_config.enabled to false', () => {
    db.insert(schema.sharingConfig).values({
      tenantId: 'tenant-2',
      updatedAt: new Date().toISOString(),
    }).run();

    const row = db.select().from(schema.sharingConfig).get();
    expect(row!.enabled).toBe(false);
    expect(row!.humanReviewEnabled).toBe(false);
    expect(row!.rateLimitPerHour).toBe(50);
  });

  // ─── agent_sharing_config table ────────────────────────

  it('should insert and read agent_sharing_config with composite PK', () => {
    db.insert(schema.agentSharingConfig).values({
      tenantId: 't1',
      agentId: 'a1',
      enabled: true,
      categories: JSON.stringify(['general']),
      updatedAt: new Date().toISOString(),
    }).run();

    const rows = db.select().from(schema.agentSharingConfig).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.enabled).toBe(true);
  });

  // ─── deny_list_rules table ─────────────────────────────

  it('should insert and read deny_list_rules', () => {
    db.insert(schema.denyListRules).values({
      id: 'rule-1',
      tenantId: 't1',
      pattern: 'secret-project',
      isRegex: false,
      reason: 'Confidential project name',
      createdAt: new Date().toISOString(),
    }).run();

    const rows = db.select().from(schema.denyListRules).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pattern).toBe('secret-project');
  });

  // ─── sharing_audit_log table ────────────────────────────

  it('should insert and read sharing_audit_log', () => {
    db.insert(schema.sharingAuditLog).values({
      id: 'audit-1',
      tenantId: 't1',
      eventType: 'share',
      lessonId: 'l1',
      timestamp: new Date().toISOString(),
    }).run();

    const rows = db.select().from(schema.sharingAuditLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.eventType).toBe('share');
  });

  // ─── sharing_review_queue table ────────────────────────

  it('should insert and read sharing_review_queue', () => {
    const now = new Date();
    db.insert(schema.sharingReviewQueue).values({
      id: 'review-1',
      tenantId: 't1',
      lessonId: 'l1',
      originalTitle: 'Original',
      originalContent: 'Content',
      redactedTitle: 'Redacted',
      redactedContent: '[REDACTED]',
      redactionFindings: '[]',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString(),
    }).run();

    const rows = db.select().from(schema.sharingReviewQueue).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('pending');
  });

  // ─── anonymous_id_map table ─────────────────────────────

  it('should insert and read anonymous_id_map with composite PK', () => {
    const now = new Date();
    db.insert(schema.anonymousIdMap).values({
      tenantId: 't1',
      agentId: 'a1',
      anonymousAgentId: 'anon-123',
      validFrom: now.toISOString(),
      validUntil: new Date(now.getTime() + 86400000).toISOString(),
    }).run();

    const rows = db.select().from(schema.anonymousIdMap).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.anonymousAgentId).toBe('anon-123');
  });

  // ─── capability_registry table ──────────────────────────

  it('should insert and read capability_registry', () => {
    const now = new Date().toISOString();
    db.insert(schema.capabilityRegistry).values({
      id: 'cap-1',
      tenantId: 't1',
      agentId: 'a1',
      taskType: 'translation',
      inputSchema: '{}',
      outputSchema: '{}',
      createdAt: now,
      updatedAt: now,
    }).run();

    const rows = db.select().from(schema.capabilityRegistry).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.scope).toBe('internal');
    expect(rows[0]!.enabled).toBe(true);
    expect(rows[0]!.acceptDelegations).toBe(false);
    expect(rows[0]!.inboundRateLimit).toBe(10);
    expect(rows[0]!.outboundRateLimit).toBe(20);
  });

  // ─── delegation_log table ──────────────────────────────

  it('should insert and read delegation_log', () => {
    db.insert(schema.delegationLog).values({
      id: 'del-1',
      tenantId: 't1',
      direction: 'outbound',
      agentId: 'a1',
      anonymousTargetId: 'anon-1',
      taskType: 'translation',
      status: 'completed',
      createdAt: new Date().toISOString(),
    }).run();

    const rows = db.select().from(schema.delegationLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.direction).toBe('outbound');
  });

  // ─── Migration idempotency ─────────────────────────────

  it('should be idempotent — running migrations twice should not error', () => {
    expect(() => runMigrations(db)).not.toThrow();
  });
});
