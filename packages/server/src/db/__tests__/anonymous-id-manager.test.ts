/**
 * Tests for Anonymous ID Manager (Phase 4 — Story 1.4)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { AnonymousIdManager } from '../anonymous-id-manager.js';

describe('Anonymous ID Manager (Story 1.4)', () => {
  let db: SqliteDb;
  let currentTime: Date;

  function createManager() {
    return new AnonymousIdManager(db, { now: () => currentTime });
  }

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    currentTime = new Date('2026-02-09T10:00:00Z');
  });

  afterEach(() => {
    // @ts-expect-error accessing internal session for cleanup
    db.$client?.close?.();
  });

  // ─── Lazy creation ─────────────────────────────────────

  it('should generate a new anonymous ID on first call', () => {
    const manager = createManager();
    const id = manager.getOrRotateAnonymousId('tenant-1', 'agent-1');
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
    // UUID format
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('should return the same ID on subsequent calls within 24h', () => {
    const manager = createManager();
    const id1 = manager.getOrRotateAnonymousId('tenant-1', 'agent-1');
    const id2 = manager.getOrRotateAnonymousId('tenant-1', 'agent-1');
    expect(id1).toBe(id2);
  });

  it('should return the same ID 23 hours later', () => {
    const manager = createManager();
    const id1 = manager.getOrRotateAnonymousId('tenant-1', 'agent-1');

    // Advance 23 hours
    currentTime = new Date(currentTime.getTime() + 23 * 60 * 60 * 1000);
    const id2 = manager.getOrRotateAnonymousId('tenant-1', 'agent-1');
    expect(id1).toBe(id2);
  });

  // ─── 24h rotation ──────────────────────────────────────

  it('should generate a new ID after 24h expiry', () => {
    const manager = createManager();
    const id1 = manager.getOrRotateAnonymousId('tenant-1', 'agent-1');

    // Advance 25 hours (past expiry)
    currentTime = new Date(currentTime.getTime() + 25 * 60 * 60 * 1000);
    const id2 = manager.getOrRotateAnonymousId('tenant-1', 'agent-1');
    expect(id2).not.toBe(id1);
  });

  it('should generate a new ID exactly at expiry boundary', () => {
    const manager = createManager();
    const id1 = manager.getOrRotateAnonymousId('tenant-1', 'agent-1');

    // Advance exactly 24 hours + 1ms
    currentTime = new Date(currentTime.getTime() + 24 * 60 * 60 * 1000 + 1);
    const id2 = manager.getOrRotateAnonymousId('tenant-1', 'agent-1');
    expect(id2).not.toBe(id1);
  });

  // ─── Tenant/Agent isolation ────────────────────────────

  it('should generate different IDs for different agents', () => {
    const manager = createManager();
    const id1 = manager.getOrRotateAnonymousId('tenant-1', 'agent-1');
    const id2 = manager.getOrRotateAnonymousId('tenant-1', 'agent-2');
    expect(id1).not.toBe(id2);
  });

  it('should generate different IDs for different tenants', () => {
    const manager = createManager();
    const id1 = manager.getOrRotateAnonymousId('tenant-1', 'agent-1');
    const id2 = manager.getOrRotateAnonymousId('tenant-2', 'agent-1');
    expect(id1).not.toBe(id2);
  });

  // ─── Audit trail ───────────────────────────────────────

  it('should keep old IDs for audit trail', () => {
    const manager = createManager();
    const id1 = manager.getOrRotateAnonymousId('tenant-1', 'agent-1');

    // Rotate
    currentTime = new Date(currentTime.getTime() + 25 * 60 * 60 * 1000);
    const id2 = manager.getOrRotateAnonymousId('tenant-1', 'agent-1');

    const trail = manager.getAuditTrail('tenant-1', 'agent-1');
    expect(trail).toHaveLength(2);
    expect(trail.map(t => t.anonymousAgentId)).toContain(id1);
    expect(trail.map(t => t.anonymousAgentId)).toContain(id2);
  });

  it('should return empty audit trail for unknown agent', () => {
    const manager = createManager();
    const trail = manager.getAuditTrail('tenant-1', 'unknown');
    expect(trail).toHaveLength(0);
  });

  it('should track multiple rotations in audit trail', () => {
    const manager = createManager();

    // Create 3 rotations
    manager.getOrRotateAnonymousId('t1', 'a1');
    currentTime = new Date(currentTime.getTime() + 25 * 60 * 60 * 1000);
    manager.getOrRotateAnonymousId('t1', 'a1');
    currentTime = new Date(currentTime.getTime() + 25 * 60 * 60 * 1000);
    manager.getOrRotateAnonymousId('t1', 'a1');

    const trail = manager.getAuditTrail('t1', 'a1');
    expect(trail).toHaveLength(3);
  });

  // ─── Contributor ID ────────────────────────────────────

  it('should generate contributor ID for tenant', () => {
    const manager = createManager();
    const id = manager.getOrRotateContributorId('tenant-1');
    expect(id).toBeTruthy();
    expect(id).toMatch(/^[0-9a-f]{8}-/);
  });

  it('should return same contributor ID within 24h', () => {
    const manager = createManager();
    const id1 = manager.getOrRotateContributorId('tenant-1');
    const id2 = manager.getOrRotateContributorId('tenant-1');
    expect(id1).toBe(id2);
  });

  it('should rotate contributor ID after 24h', () => {
    const manager = createManager();
    const id1 = manager.getOrRotateContributorId('tenant-1');

    currentTime = new Date(currentTime.getTime() + 25 * 60 * 60 * 1000);
    const id2 = manager.getOrRotateContributorId('tenant-1');
    expect(id2).not.toBe(id1);
  });
});
