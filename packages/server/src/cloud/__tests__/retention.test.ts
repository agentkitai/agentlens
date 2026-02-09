/**
 * Data Retention & Partition Management Tests (S-8.1, S-8.2)
 *
 * Unit tests with mock pool. Integration tests run with DATABASE_URL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TIER_RETENTION,
  getEffectiveRetention,
  getRetentionCutoff,
  type OrgRetentionInfo,
} from '../retention/retention-policy.js';
import {
  runRetentionJob,
  purgeExpiredData,
  getExpiringDataSummary,
  type RetentionLogger,
} from '../retention/retention-job.js';
import {
  managePartitions,
  getGlobalMinRetentionMonths,
  checkPartitionHealth,
  checkAllPartitionHealth,
} from '../retention/partition-management.js';
import type { Pool } from '../tenant-pool.js';

// ═══════════════════════════════════════════
// Mock Pool
// ═══════════════════════════════════════════

function createMockPool(queryResponses: Array<{ rows: unknown[]; rowCount?: number }> = []) {
  let callIndex = 0;
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const defaultResponse = { rows: [], rowCount: 0 };

  const pool: Pool = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      const resp = queryResponses[callIndex] ?? defaultResponse;
      callIndex++;
      return { rows: resp.rows, rowCount: resp.rowCount ?? resp.rows.length };
    }),
    connect: vi.fn(async () => ({
      query: pool.query,
      release: vi.fn(),
    })),
    end: vi.fn(async () => {}),
  };

  return { pool, queries };
}

function mockLogger(): RetentionLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// ═══════════════════════════════════════════
// S-8.1: Retention Policy (4 tests)
// ═══════════════════════════════════════════

describe('S-8.1: Retention Policy', () => {
  it('returns correct tier defaults', () => {
    expect(TIER_RETENTION.free.eventRetentionDays).toBe(7);
    expect(TIER_RETENTION.pro.eventRetentionDays).toBe(30);
    expect(TIER_RETENTION.team.eventRetentionDays).toBe(90);
    expect(TIER_RETENTION.enterprise.eventRetentionDays).toBe(365);
  });

  it('uses tier default for non-enterprise orgs', () => {
    const org: OrgRetentionInfo = { orgId: 'org1', plan: 'pro', customRetentionDays: 999 };
    const result = getEffectiveRetention(org);
    expect(result.eventRetentionDays).toBe(30); // ignores custom for non-enterprise
  });

  it('uses custom retention for enterprise orgs', () => {
    const org: OrgRetentionInfo = { orgId: 'org1', plan: 'enterprise', customRetentionDays: 730 };
    const result = getEffectiveRetention(org);
    expect(result.eventRetentionDays).toBe(730);
    expect(result.auditLogRetentionDays).toBe(730); // max of custom and tier default
  });

  it('computes correct retention cutoff', () => {
    const now = new Date('2026-02-09T12:00:00Z');
    const cutoff = getRetentionCutoff(30, now);
    expect(cutoff.toISOString()).toBe('2026-01-10T00:00:00.000Z');
  });
});

// ═══════════════════════════════════════════
// S-8.1: Retention Purge Job (6 tests)
// ═══════════════════════════════════════════

describe('S-8.1: Retention Purge Job', () => {
  const now = new Date('2026-02-09T03:00:00Z');

  it('purges expired data for each org', async () => {
    const { pool } = createMockPool([
      // getActiveOrgs
      { rows: [{ orgId: 'org1', plan: 'free', customRetentionDays: null }] },
      // checkExpiryWarnings - count
      { rows: [{ cnt: '0' }] },
      // purgeExpiredData events - DELETE
      { rows: [], rowCount: 5 },
      // purgeExpiredData audit_log - DELETE
      { rows: [], rowCount: 2 },
    ]);

    const result = await runRetentionJob({ pool, now });
    expect(result.orgsProcessed).toBe(1);
    expect(result.totalDeleted).toBe(7);
    expect(result.errors).toHaveLength(0);
  });

  it('generates warnings for approaching expiry', async () => {
    const { pool } = createMockPool([
      // getActiveOrgs
      { rows: [{ orgId: 'org1', plan: 'free', customRetentionDays: null }] },
      // checkExpiryWarnings - count of soon-expiring events
      { rows: [{ cnt: '150' }] },
      // purgeExpiredData events
      { rows: [], rowCount: 0 },
      // purgeExpiredData audit_log
      { rows: [], rowCount: 0 },
    ]);

    const result = await runRetentionJob({ pool, now, warningDays: 7 });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].orgId).toBe('org1');
    expect(result.warnings[0].type).toBe('approaching_expiry');
    expect(result.warnings[0].message).toContain('150 events');
  });

  it('handles errors gracefully per org', async () => {
    const { pool } = createMockPool([
      // getActiveOrgs - two orgs
      { rows: [
        { orgId: 'org1', plan: 'pro', customRetentionDays: null },
        { orgId: 'org2', plan: 'free', customRetentionDays: null },
      ]},
    ]);

    // Make subsequent queries fail for org1, succeed for org2
    let callCount = 0;
    (pool.query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
      callCount++;
      if (callCount === 1) return { rows: [
        { orgId: 'org1', plan: 'pro', customRetentionDays: null },
        { orgId: 'org2', plan: 'free', customRetentionDays: null },
      ], rowCount: 2 };
      if (callCount === 2) throw new Error('DB connection lost');
      // org2 queries
      if (callCount === 3) return { rows: [{ cnt: '0' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const result = await runRetentionJob({ pool, now });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].orgId).toBe('org1');
    expect(result.orgsProcessed).toBe(1); // org2 succeeded
  });

  it('purgeExpiredData deletes rows before cutoff', async () => {
    const { pool, queries } = createMockPool([
      { rows: [], rowCount: 42 },
    ]);

    const result = await purgeExpiredData(pool, 'org1', ['events'], 30, now);
    expect(result.rowsDeleted).toBe(42);
    expect(queries[0].sql).toContain('DELETE FROM events');
    expect(queries[0].sql).toContain('org_id');
    expect(queries[0].params?.[0]).toBe('org1');
  });

  it('uses created_at column for audit_log', async () => {
    const { pool, queries } = createMockPool([
      { rows: [], rowCount: 10 },
    ]);

    await purgeExpiredData(pool, 'org1', ['audit_log'], 90, now);
    expect(queries[0].sql).toContain('created_at');
  });

  it('getExpiringDataSummary returns correct counts', async () => {
    const { pool } = createMockPool([
      { rows: [{ cnt: '250', oldest: '2025-12-01T00:00:00Z' }] },
    ]);

    const summary = await getExpiringDataSummary(pool, 'org1', 30, now);
    expect(summary.eventCount).toBe(250);
    expect(summary.oldestEvent).toBe('2025-12-01T00:00:00Z');
    expect(summary.cutoffDate).toBeDefined();
  });
});

// ═══════════════════════════════════════════
// S-8.2: Partition Management (8 tests)
// ═══════════════════════════════════════════

describe('S-8.2: Partition Management', () => {
  const now = new Date('2026-02-09T03:00:00Z');

  it('creates future partitions for all tables', async () => {
    const { pool } = createMockPool([]);

    // Mock: all pg_class checks return empty (no existing partitions), CREATE succeeds
    let callIdx = 0;
    (pool.query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
      callIdx++;
      if (sql.includes('pg_class')) return { rows: [], rowCount: 0 };
      if (sql.includes('CREATE TABLE')) return { rows: [], rowCount: 0 };
      if (sql.includes('DISTINCT plan')) return { rows: [{ plan: 'free' }], rowCount: 1 };
      if (sql.includes('pg_inherits')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const result = await managePartitions({ pool, now, futureMonths: 3 });
    // 3 tables × 4 months (current + 3 ahead) = 12 created
    expect(result.created.length).toBe(12);
    expect(result.errors).toHaveLength(0);
  });

  it('skips existing partitions', async () => {
    (vi.fn as unknown); // just for clarity
    const { pool } = createMockPool([]);

    (pool.query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
      if (sql.includes('pg_class')) return { rows: [{ '1': 1 }], rowCount: 1 }; // exists
      if (sql.includes('DISTINCT plan')) return { rows: [{ plan: 'free' }], rowCount: 1 };
      if (sql.includes('pg_inherits')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const result = await managePartitions({ pool, now });
    expect(result.created.length).toBe(0); // all skipped
  });

  it('drops partitions older than global min retention', async () => {
    const { pool } = createMockPool([]);

    (pool.query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
      if (sql.includes('pg_class') && !sql.includes('pg_inherits')) return { rows: [{ '1': 1 }], rowCount: 1 };
      if (sql.includes('DISTINCT plan')) return { rows: [{ plan: 'free' }], rowCount: 1 }; // 7 days → ~1 month
      if (sql.includes('pg_inherits')) return {
        rows: [
          { name: 'events_2024_01', bounds: "FOR VALUES FROM ('2024-01-01') TO ('2024-02-01')" },
          { name: 'events_2026_01', bounds: "FOR VALUES FROM ('2026-01-01') TO ('2026-02-01')" },
        ],
        rowCount: 2,
      };
      if (sql.includes('DROP TABLE')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const result = await managePartitions({ pool, now });
    expect(result.dropped).toContain('events_2024_01');
    expect(result.dropped).not.toContain('events_2026_01');
  });

  it('getGlobalMinRetentionMonths returns max retention in months', async () => {
    const { pool } = createMockPool([
      { rows: [{ plan: 'free' }, { plan: 'team' }] },
    ]);

    const months = await getGlobalMinRetentionMonths(pool);
    // team has 365 days audit log → ceil(365/30) = 13
    expect(months).toBe(13);
  });

  it('getGlobalMinRetentionMonths defaults to 12 with no orgs', async () => {
    const { pool } = createMockPool([{ rows: [] }]);
    const months = await getGlobalMinRetentionMonths(pool);
    expect(months).toBe(12);
  });

  it('checkPartitionHealth detects missing future partitions', async () => {
    const { pool } = createMockPool([
      // getPartitions
      { rows: [] },
    ]);

    const report = await checkPartitionHealth(pool, 'events', now);
    expect(report.healthy).toBe(false);
    expect(report.issues.some((i) => i.type === 'missing_future')).toBe(true);
  });

  it('checkPartitionHealth detects gaps', async () => {
    const { pool } = createMockPool([
      {
        rows: [
          { name: 'events_2026_01', bounds: "FOR VALUES FROM ('2026-01-01') TO ('2026-02-01')" },
          // gap: missing 2026_02
          { name: 'events_2026_03', bounds: "FOR VALUES FROM ('2026-03-01') TO ('2026-04-01')" },
        ],
      },
    ]);

    const report = await checkPartitionHealth(pool, 'events', now);
    expect(report.issues.some((i) => i.type === 'gap')).toBe(true);
  });

  it('checkAllPartitionHealth returns reports for all tables', async () => {
    const { pool } = createMockPool([]);

    (pool.query as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      rows: [
        { name: 'x_2026_02', bounds: "FOR VALUES FROM ('2026-02-01') TO ('2026-03-01')" },
        { name: 'x_2026_03', bounds: "FOR VALUES FROM ('2026-03-01') TO ('2026-04-01')" },
        { name: 'x_2026_04', bounds: "FOR VALUES FROM ('2026-04-01') TO ('2026-05-01')" },
        { name: 'x_2026_05', bounds: "FOR VALUES FROM ('2026-05-01') TO ('2026-06-01')" },
      ],
      rowCount: 4,
    }));

    const reports = await checkAllPartitionHealth(pool, now);
    expect(reports).toHaveLength(3); // events, audit_log, usage_records
  });
});
