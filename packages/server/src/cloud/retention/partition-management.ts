/**
 * Production Partition Management (S-8.2)
 *
 * Extends the base partition-maintenance with:
 * - Integration with retention policies (drop partitions based on min retention across orgs)
 * - Partition health monitoring
 * - Future partition pre-creation (3 months ahead)
 */

import type { Pool } from '../tenant-pool.js';
import type { TierName } from '../billing/stripe-client.js';
import { TIER_RETENTION } from './retention-policy.js';
import {
  createMonthlyPartition,
  getPartitions,
  type PartitionAction,
} from '../partition-maintenance.js';

// ─── Types ───────────────────────────────────────────────────────

export interface PartitionHealthReport {
  table: string;
  totalPartitions: number;
  partitions: PartitionInfo[];
  issues: PartitionIssue[];
  healthy: boolean;
}

export interface PartitionInfo {
  name: string;
  bounds: string;
  startDate: string;
  endDate: string;
  estimatedRows?: number;
}

export interface PartitionIssue {
  type: 'missing_future' | 'gap' | 'too_many' | 'stale';
  message: string;
  partition?: string;
}

export interface PartitionManagementResult {
  created: string[];
  dropped: string[];
  errors: string[];
}

export interface PartitionManagementDeps {
  pool: Pool;
  now?: Date;
  futureMonths?: number; // default 3
}

const PARTITIONED_TABLES = ['events', 'audit_log', 'usage_records'] as const;
const SAFE_IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/;

function assertSafe(name: string): void {
  if (!SAFE_IDENTIFIER_RE.test(name)) throw new Error(`Unsafe identifier: ${name}`);
}

// ─── Core ────────────────────────────────────────────────────────

/**
 * Run full partition lifecycle management.
 *
 * 1. Pre-create future partitions (3 months ahead by default)
 * 2. Drop fully expired partitions based on global minimum retention
 */
export async function managePartitions(
  deps: PartitionManagementDeps,
): Promise<PartitionManagementResult> {
  const { pool, now = new Date(), futureMonths = 3 } = deps;
  const result: PartitionManagementResult = { created: [], dropped: [], errors: [] };

  // Step 1: Create future partitions
  for (const table of PARTITIONED_TABLES) {
    for (let offset = 0; offset <= futureMonths; offset++) {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      try {
        const name = await createMonthlyPartition(pool, table, d.getFullYear(), d.getMonth() + 1);
        if (name) result.created.push(name);
      } catch (err) {
        result.errors.push(`Failed to create partition for ${table} ${d.toISOString()}: ${err}`);
      }
    }
  }

  // Step 2: Determine global minimum retention to decide which partitions can be dropped
  const minRetentionMonths = await getGlobalMinRetentionMonths(pool);

  // Step 3: Drop expired partitions
  const cutoff = new Date(now.getFullYear(), now.getMonth() - minRetentionMonths, 1);

  for (const table of PARTITIONED_TABLES) {
    try {
      const dropped = await dropExpiredPartitions(pool, table, cutoff);
      result.dropped.push(...dropped);
    } catch (err) {
      result.errors.push(`Failed to drop partitions for ${table}: ${err}`);
    }
  }

  return result;
}

/**
 * Get the minimum retention across all active orgs (in months).
 * This determines when a shared partition can safely be dropped —
 * only when ALL orgs' retention has expired for that time range.
 */
export async function getGlobalMinRetentionMonths(pool: Pool): Promise<number> {
  const { rows } = await pool.query(
    `SELECT DISTINCT plan FROM orgs WHERE deleted_at IS NULL`,
  );

  if (rows.length === 0) return 12; // default safe value

  let maxRetentionDays = 0;
  for (const row of rows as { plan: string }[]) {
    const tier = row.plan as TierName;
    const retention = TIER_RETENTION[tier] ?? TIER_RETENTION.free;
    // We need the MAXIMUM retention across all orgs to know when a partition is safe to drop
    // (a partition can only be dropped when ALL orgs' data in it has expired)
    maxRetentionDays = Math.max(maxRetentionDays, retention.eventRetentionDays, retention.auditLogRetentionDays);
  }

  // Convert days to months (round up)
  return Math.ceil(maxRetentionDays / 30);
}

/**
 * Drop partitions whose entire time range is before the cutoff.
 */
async function dropExpiredPartitions(
  pool: Pool,
  table: string,
  cutoff: Date,
): Promise<string[]> {
  assertSafe(table);
  const partitions = await getPartitions(pool, table);
  const dropped: string[] = [];

  for (const p of partitions) {
    // Extract end date from bounds: "FOR VALUES FROM ('2025-01-01') TO ('2025-02-01')"
    const matches = p.bounds.match(/'(\d{4}-\d{2}-\d{2})'/g);
    if (!matches || matches.length < 2) continue;

    const endDate = new Date(matches[1].replace(/'/g, ''));
    if (endDate <= cutoff) {
      assertSafe(p.name);
      await pool.query(`DROP TABLE IF EXISTS ${p.name}`);
      dropped.push(p.name);
    }
  }

  return dropped;
}

// ─── Health Monitoring ───────────────────────────────────────────

/**
 * Check partition health for a table.
 * Reports issues like missing future partitions, gaps, excessive partitions.
 */
export async function checkPartitionHealth(
  pool: Pool,
  table: string,
  now: Date = new Date(),
  futureMonths: number = 3,
): Promise<PartitionHealthReport> {
  assertSafe(table);
  const partitions = await getPartitions(pool, table);
  const issues: PartitionIssue[] = [];
  const parsedPartitions: PartitionInfo[] = [];

  for (const p of partitions) {
    const matches = p.bounds.match(/'(\d{4}-\d{2}-\d{2})'/g);
    if (matches && matches.length >= 2) {
      parsedPartitions.push({
        name: p.name,
        bounds: p.bounds,
        startDate: matches[0].replace(/'/g, ''),
        endDate: matches[1].replace(/'/g, ''),
      });
    }
  }

  // Check future partitions exist
  for (let offset = 0; offset <= futureMonths; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const expectedName = `${table}_${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, '0')}`;
    const exists = parsedPartitions.some((p) => p.name === expectedName);
    if (!exists) {
      issues.push({
        type: 'missing_future',
        message: `Missing future partition: ${expectedName}`,
        partition: expectedName,
      });
    }
  }

  // Check for gaps between partitions
  const sorted = [...parsedPartitions].sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startDate !== sorted[i - 1].endDate) {
      issues.push({
        type: 'gap',
        message: `Gap between ${sorted[i - 1].name} and ${sorted[i].name}`,
        partition: sorted[i].name,
      });
    }
  }

  // Check for excessive partitions (> 24 is unusual)
  if (parsedPartitions.length > 24) {
    issues.push({
      type: 'too_many',
      message: `Table ${table} has ${parsedPartitions.length} partitions (>24)`,
    });
  }

  return {
    table,
    totalPartitions: parsedPartitions.length,
    partitions: parsedPartitions,
    issues,
    healthy: issues.length === 0,
  };
}

/**
 * Get health reports for all partitioned tables.
 */
export async function checkAllPartitionHealth(
  pool: Pool,
  now: Date = new Date(),
): Promise<PartitionHealthReport[]> {
  const reports: PartitionHealthReport[] = [];
  for (const table of PARTITIONED_TABLES) {
    reports.push(await checkPartitionHealth(pool, table, now));
  }
  return reports;
}
