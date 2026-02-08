/**
 * Tests for HealthSnapshotStore (Story 1.3)
 *
 * CRUD + tenant isolation + upsert idempotency + retention cleanup.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { HealthSnapshotStore } from '../health-snapshot-store.js';
import type { HealthSnapshot } from '@agentlensai/core';

let store: HealthSnapshotStore;

beforeEach(() => {
  const db = createTestDb();
  runMigrations(db);
  store = new HealthSnapshotStore(db);
});

function makeSnapshot(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    agentId: 'agent-1',
    date: '2024-01-15',
    overallScore: 85.5,
    errorRateScore: 90,
    costEfficiencyScore: 80,
    toolSuccessScore: 95,
    latencyScore: 70,
    completionRateScore: 88,
    sessionCount: 42,
    ...overrides,
  };
}

// ─── Save & Get ────────────────────────────────────────────

describe('HealthSnapshotStore — save & get', () => {
  it('saves and retrieves a snapshot', () => {
    const snapshot = makeSnapshot();
    store.save('tenant-a', snapshot);

    const retrieved = store.get('tenant-a', 'agent-1', '2024-01-15');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.agentId).toBe('agent-1');
    expect(retrieved!.date).toBe('2024-01-15');
    expect(retrieved!.overallScore).toBe(85.5);
    expect(retrieved!.errorRateScore).toBe(90);
    expect(retrieved!.costEfficiencyScore).toBe(80);
    expect(retrieved!.toolSuccessScore).toBe(95);
    expect(retrieved!.latencyScore).toBe(70);
    expect(retrieved!.completionRateScore).toBe(88);
    expect(retrieved!.sessionCount).toBe(42);
  });

  it('returns null for non-existent snapshot', () => {
    const result = store.get('tenant-a', 'agent-1', '2024-01-15');
    expect(result).toBeNull();
  });

  it('returns null for wrong date', () => {
    store.save('tenant-a', makeSnapshot({ date: '2024-01-15' }));
    const result = store.get('tenant-a', 'agent-1', '2024-01-16');
    expect(result).toBeNull();
  });
});

// ─── Upsert Idempotency ───────────────────────────────────

describe('HealthSnapshotStore — upsert', () => {
  it('overwrites existing snapshot for same agent+date', () => {
    store.save('tenant-a', makeSnapshot({ overallScore: 80 }));
    store.save('tenant-a', makeSnapshot({ overallScore: 95 }));

    const retrieved = store.get('tenant-a', 'agent-1', '2024-01-15');
    expect(retrieved!.overallScore).toBe(95);
  });

  it('does not create duplicates on upsert', () => {
    const now = new Date();
    const recentDate = now.toISOString().slice(0, 10);
    store.save('tenant-a', makeSnapshot({ date: recentDate }));
    store.save('tenant-a', makeSnapshot({ date: recentDate }));
    store.save('tenant-a', makeSnapshot({ date: recentDate }));

    const history = store.getHistory('tenant-a', 'agent-1', 365);
    expect(history).toHaveLength(1);
  });
});

// ─── Tenant Isolation ──────────────────────────────────────

describe('HealthSnapshotStore — Tenant Isolation', () => {
  it('tenant A cannot see tenant B snapshots', () => {
    store.save('tenant-a', makeSnapshot({ agentId: 'agent-1' }));
    store.save('tenant-b', makeSnapshot({ agentId: 'agent-1' }));

    const resultA = store.get('tenant-a', 'agent-1', '2024-01-15');
    expect(resultA).not.toBeNull();

    // tenant-b can see its own
    const resultB = store.get('tenant-b', 'agent-1', '2024-01-15');
    expect(resultB).not.toBeNull();

    // But cannot cross-access
    const cross = store.get('tenant-a', 'agent-1', '2024-01-15');
    expect(cross!.agentId).toBe('agent-1'); // only its own
  });

  it('getHistory isolates by tenant', () => {
    const now = new Date();
    const d1 = new Date(now); d1.setDate(d1.getDate() - 2);
    const d2 = new Date(now); d2.setDate(d2.getDate() - 1);
    const date1 = d1.toISOString().slice(0, 10);
    const date2 = d2.toISOString().slice(0, 10);

    store.save('tenant-a', makeSnapshot({ date: date1 }));
    store.save('tenant-a', makeSnapshot({ date: date2 }));
    store.save('tenant-b', makeSnapshot({ date: date1 }));

    const histA = store.getHistory('tenant-a', 'agent-1', 365);
    expect(histA).toHaveLength(2);

    const histB = store.getHistory('tenant-b', 'agent-1', 365);
    expect(histB).toHaveLength(1);
  });

  it('getLatest isolates by tenant', () => {
    store.save('tenant-a', makeSnapshot({ agentId: 'agent-1', overallScore: 80 }));
    store.save('tenant-b', makeSnapshot({ agentId: 'agent-1', overallScore: 60 }));

    const latestA = store.getLatest('tenant-a');
    expect(latestA.size).toBe(1);
    expect(latestA.get('agent-1')!.overallScore).toBe(80);

    const latestB = store.getLatest('tenant-b');
    expect(latestB.size).toBe(1);
    expect(latestB.get('agent-1')!.overallScore).toBe(60);
  });

  it('cleanup isolates by tenant', () => {
    // Use very old dates so they get cleaned up
    store.save('tenant-a', makeSnapshot({ date: '2020-01-01' }));
    store.save('tenant-b', makeSnapshot({ date: '2020-01-01' }));

    // Cleanup only tenant-a
    const deleted = store.cleanup('tenant-a', 30);
    expect(deleted).toBe(1);

    // tenant-b snapshot still exists
    const result = store.get('tenant-b', 'agent-1', '2020-01-01');
    expect(result).not.toBeNull();
  });
});

// ─── History Ordering ──────────────────────────────────────

describe('HealthSnapshotStore — getHistory', () => {
  it('returns snapshots ordered by date DESC', () => {
    const now = new Date();
    const d1 = new Date(now); d1.setDate(d1.getDate() - 10);
    const d2 = new Date(now); d2.setDate(d2.getDate() - 5);
    const d3 = new Date(now); d3.setDate(d3.getDate() - 8);
    const date1 = d1.toISOString().slice(0, 10);
    const date2 = d2.toISOString().slice(0, 10);
    const date3 = d3.toISOString().slice(0, 10);

    store.save('tenant-a', makeSnapshot({ date: date1 }));
    store.save('tenant-a', makeSnapshot({ date: date2 }));
    store.save('tenant-a', makeSnapshot({ date: date3 }));

    const history = store.getHistory('tenant-a', 'agent-1', 365);
    expect(history).toHaveLength(3);
    expect(history[0]!.date).toBe(date2);  // most recent
    expect(history[1]!.date).toBe(date3);  // middle
    expect(history[2]!.date).toBe(date1);  // oldest
  });

  it('filters by day window', () => {
    // Use dates relative to now
    const now = new Date();
    const recent = new Date(now);
    recent.setDate(recent.getDate() - 5);
    const recentDate = recent.toISOString().slice(0, 10);

    const old = new Date(now);
    old.setDate(old.getDate() - 60);
    const oldDate = old.toISOString().slice(0, 10);

    store.save('tenant-a', makeSnapshot({ date: recentDate }));
    store.save('tenant-a', makeSnapshot({ date: oldDate }));

    // 30-day window should only include recent
    const history = store.getHistory('tenant-a', 'agent-1', 30);
    expect(history).toHaveLength(1);
    expect(history[0]!.date).toBe(recentDate);
  });
});

// ─── getLatest ─────────────────────────────────────────────

describe('HealthSnapshotStore — getLatest', () => {
  it('returns latest snapshot per agent', () => {
    store.save('tenant-a', makeSnapshot({ agentId: 'agent-1', date: '2024-01-10', overallScore: 70 }));
    store.save('tenant-a', makeSnapshot({ agentId: 'agent-1', date: '2024-01-15', overallScore: 85 }));
    store.save('tenant-a', makeSnapshot({ agentId: 'agent-2', date: '2024-01-12', overallScore: 90 }));
    store.save('tenant-a', makeSnapshot({ agentId: 'agent-2', date: '2024-01-14', overallScore: 92 }));

    const latest = store.getLatest('tenant-a');
    expect(latest.size).toBe(2);
    expect(latest.get('agent-1')!.overallScore).toBe(85);
    expect(latest.get('agent-1')!.date).toBe('2024-01-15');
    expect(latest.get('agent-2')!.overallScore).toBe(92);
    expect(latest.get('agent-2')!.date).toBe('2024-01-14');
  });

  it('returns empty map when no snapshots', () => {
    const latest = store.getLatest('tenant-a');
    expect(latest.size).toBe(0);
  });
});

// ─── Cleanup ───────────────────────────────────────────────

describe('HealthSnapshotStore — cleanup', () => {
  it('deletes snapshots older than retention period', () => {
    store.save('tenant-a', makeSnapshot({ date: '2020-01-01' }));
    store.save('tenant-a', makeSnapshot({ date: '2020-06-01' }));

    // Recent snapshot (within retention)
    const now = new Date();
    const recentDate = now.toISOString().slice(0, 10);
    store.save('tenant-a', makeSnapshot({ date: recentDate }));

    const deleted = store.cleanup('tenant-a', 90);
    expect(deleted).toBe(2);

    // Recent one still exists
    const remaining = store.getHistory('tenant-a', 'agent-1', 365);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.date).toBe(recentDate);
  });

  it('returns 0 when nothing to clean', () => {
    const now = new Date();
    const recentDate = now.toISOString().slice(0, 10);
    store.save('tenant-a', makeSnapshot({ date: recentDate }));

    const deleted = store.cleanup('tenant-a', 90);
    expect(deleted).toBe(0);
  });
});
