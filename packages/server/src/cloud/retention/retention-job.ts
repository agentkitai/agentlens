/**
 * Data Retention Purge Job (S-8.1)
 *
 * Daily cron (03:00 UTC) that purges events beyond each org's retention window.
 * Primary mechanism: DROP entire expired monthly partitions.
 * Partial DELETE for boundary partitions.
 *
 * Also handles: warning notifications before deletion, export-before-delete prompting.
 */

import type { Pool } from '../tenant-pool.js';
import type { TierName } from '../billing/stripe-client.js';
import {
  type OrgRetentionInfo,
  type RetentionPolicy,
  getEffectiveRetention,
  getRetentionCutoff,
} from './retention-policy.js';

// ─── Types ───────────────────────────────────────────────────────

export interface RetentionJobResult {
  orgsProcessed: number;
  totalDropped: number;
  totalDeleted: number;
  warnings: RetentionWarning[];
  errors: RetentionError[];
}

export interface RetentionWarning {
  orgId: string;
  type: 'approaching_expiry';
  message: string;
  daysUntilExpiry: number;
}

export interface RetentionError {
  orgId: string;
  error: string;
}

export interface OrgPurgeResult {
  orgId: string;
  partitionsDropped: string[];
  rowsDeleted: number;
}

export interface RetentionJobDeps {
  pool: Pool;
  now?: Date;
  logger?: RetentionLogger;
  warningDays?: number; // days before expiry to warn (default: 7)
}

export interface RetentionLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

const defaultLogger: RetentionLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// Tables that need retention purging (partition-based)
const EVENT_TABLES = ['events'] as const;
const AUDIT_TABLE = 'audit_log';

const SAFE_IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/;
function assertSafe(name: string): void {
  if (!SAFE_IDENTIFIER_RE.test(name)) throw new Error(`Unsafe identifier: ${name}`);
}

// ─── Core Job ────────────────────────────────────────────────────

/**
 * Run the retention purge job for all organizations.
 */
export async function runRetentionJob(deps: RetentionJobDeps): Promise<RetentionJobResult> {
  const { pool, now = new Date(), logger = defaultLogger, warningDays = 7 } = deps;

  const result: RetentionJobResult = {
    orgsProcessed: 0,
    totalDropped: 0,
    totalDeleted: 0,
    warnings: [],
    errors: [],
  };

  // Fetch all active orgs with their plans
  const orgs = await getActiveOrgs(pool);
  logger.info(`Retention job starting for ${orgs.length} orgs`);

  for (const org of orgs) {
    try {
      const retention = getEffectiveRetention(org);

      // Check for approaching expiry warnings
      const warnings = await checkExpiryWarnings(pool, org, retention, now, warningDays);
      result.warnings.push(...warnings);

      // Purge expired events
      const eventResult = await purgeExpiredData(pool, org.orgId, EVENT_TABLES, retention.eventRetentionDays, now, logger);
      result.totalDropped += eventResult.partitionsDropped.length;
      result.totalDeleted += eventResult.rowsDeleted;

      // Purge expired audit logs
      const auditResult = await purgeExpiredData(pool, org.orgId, [AUDIT_TABLE], retention.auditLogRetentionDays, now, logger);
      result.totalDropped += auditResult.partitionsDropped.length;
      result.totalDeleted += auditResult.rowsDeleted;

      result.orgsProcessed++;

      logger.info('Org retention complete', {
        orgId: org.orgId,
        dropped: eventResult.partitionsDropped.length + auditResult.partitionsDropped.length,
        deleted: eventResult.rowsDeleted + auditResult.rowsDeleted,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ orgId: org.orgId, error: message });
      logger.error(`Retention failed for org ${org.orgId}: ${message}`);
    }
  }

  logger.info('Retention job complete', {
    orgsProcessed: result.orgsProcessed,
    totalDropped: result.totalDropped,
    totalDeleted: result.totalDeleted,
    warnings: result.warnings.length,
    errors: result.errors.length,
  });

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────

async function getActiveOrgs(pool: Pool): Promise<OrgRetentionInfo[]> {
  const { rows } = await pool.query(
    `SELECT id AS "orgId", plan, custom_retention_days AS "customRetentionDays"
     FROM orgs
     WHERE deleted_at IS NULL`,
  );
  return (rows as Array<{ orgId: string; plan: string; customRetentionDays: number | null }>).map(
    (r) => ({
      orgId: r.orgId,
      plan: r.plan as TierName,
      customRetentionDays: r.customRetentionDays,
    }),
  );
}

/**
 * Check if any org data is approaching its retention cutoff, and generate warnings.
 */
async function checkExpiryWarnings(
  pool: Pool,
  org: OrgRetentionInfo,
  retention: RetentionPolicy,
  now: Date,
  warningDays: number,
): Promise<RetentionWarning[]> {
  const warnings: RetentionWarning[] = [];

  // Check if org has data that will expire within warningDays
  const warningCutoff = getRetentionCutoff(retention.eventRetentionDays - warningDays, now);
  const actualCutoff = getRetentionCutoff(retention.eventRetentionDays, now);

  const { rows } = await pool.query(
    `SELECT COUNT(*) AS cnt FROM events
     WHERE org_id = $1 AND timestamp >= $2 AND timestamp < $3`,
    [org.orgId, actualCutoff.toISOString(), warningCutoff.toISOString()],
  );

  const count = Number((rows[0] as { cnt: string })?.cnt ?? 0);
  if (count > 0) {
    warnings.push({
      orgId: org.orgId,
      type: 'approaching_expiry',
      message: `${count} events will expire within ${warningDays} days. Consider exporting data.`,
      daysUntilExpiry: warningDays,
    });
  }

  return warnings;
}

/**
 * Purge expired data for one org across given tables.
 *
 * Strategy (per architecture §11.2):
 * 1. Check each partition — if its max_timestamp < cutoff, the whole partition is expired
 *    BUT we can only DROP a partition if ALL orgs' data in it is expired.
 *    Since partitions are shared across orgs, we use DELETE for per-org purging.
 * 2. For per-org purging: DELETE WHERE org_id = :org AND timestamp < :cutoff
 *
 * Partition drops are handled by partition-management.ts which considers
 * the minimum retention across all orgs (global partition lifecycle).
 */
export async function purgeExpiredData(
  pool: Pool,
  orgId: string,
  tables: readonly string[],
  retentionDays: number,
  now: Date,
  logger: RetentionLogger = defaultLogger,
): Promise<OrgPurgeResult> {
  const cutoff = getRetentionCutoff(retentionDays, now);
  const result: OrgPurgeResult = { orgId, partitionsDropped: [], rowsDeleted: 0 };

  for (const table of tables) {
    assertSafe(table);

    const timestampCol = table === 'audit_log' ? 'created_at' : 'timestamp';

    // Per-org batched DELETE (partitions are shared, can't drop per-org)
    const BATCH_SIZE = 10000;
    let totalDeleted = 0;
    let batchDeleted: number;
    do {
      const deleteResult = await pool.query(
        `DELETE FROM ${table} WHERE ctid IN (
          SELECT ctid FROM ${table} WHERE org_id = $1 AND ${timestampCol} < $2 LIMIT ${BATCH_SIZE}
        )`,
        [orgId, cutoff.toISOString()],
      );
      batchDeleted = (deleteResult as { rowCount: number }).rowCount ?? 0;
      totalDeleted += batchDeleted;
    } while (batchDeleted >= BATCH_SIZE);

    result.rowsDeleted += totalDeleted;

    if (totalDeleted > 0) {
      logger.info(`Deleted ${totalDeleted} rows from ${table} for org ${orgId}`);
    }
  }

  return result;
}

/**
 * Check if an org has exportable data that will be deleted.
 * Used to prompt export-before-delete in the UI.
 */
export async function getExpiringDataSummary(
  pool: Pool,
  orgId: string,
  retentionDays: number,
  now: Date = new Date(),
): Promise<{ eventCount: number; oldestEvent: string | null; cutoffDate: string }> {
  const cutoff = getRetentionCutoff(retentionDays, now);

  const { rows } = await pool.query(
    `SELECT COUNT(*) AS cnt, MIN(timestamp) AS oldest
     FROM events
     WHERE org_id = $1 AND timestamp < $2`,
    [orgId, cutoff.toISOString()],
  );

  const row = rows[0] as { cnt: string; oldest: string | null } | undefined;
  return {
    eventCount: Number(row?.cnt ?? 0),
    oldestEvent: row?.oldest ?? null,
    cutoffDate: cutoff.toISOString(),
  };
}
