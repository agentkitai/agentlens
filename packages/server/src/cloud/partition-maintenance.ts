/**
 * Partition Maintenance Job (S-1.4)
 *
 * Auto-creates partitions 3 months ahead and drops expired ones.
 * Designed to be called by a daily cron job.
 */

import type { Pool } from './tenant-pool.js';

export interface PartitionAction {
  action: 'created' | 'dropped';
  partitionName: string;
}

const PARTITIONED_TABLES = [
  { table: 'events', column: 'timestamp' },
  { table: 'audit_log', column: 'created_at' },
  { table: 'usage_records', column: 'hour' },
] as const;

/**
 * Create a monthly partition for a table if it doesn't exist.
 */
export async function createMonthlyPartition(
  pool: Pool,
  table: string,
  year: number,
  month: number,
): Promise<string | null> {
  const partitionName = `${table}_${year}_${String(month).padStart(2, '0')}`;
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  // Check if partition already exists
  const check = await pool.query(
    `SELECT 1 FROM pg_class WHERE relname = $1`,
    [partitionName],
  );

  if (check.rows.length > 0) {
    return null; // Already exists
  }

  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${partitionName} PARTITION OF ${table} FOR VALUES FROM ('${startDate}') TO ('${endDate}')`,
  );

  return partitionName;
}

/**
 * Run partition maintenance:
 * - Create partitions 3 months ahead for all partitioned tables
 * - Drop partitions older than maxRetentionMonths
 */
export async function maintainPartitions(
  pool: Pool,
  maxRetentionMonths: number = 12,
): Promise<PartitionAction[]> {
  const actions: PartitionAction[] = [];
  const now = new Date();

  // Create future partitions (current month + 3 ahead)
  for (const { table } of PARTITIONED_TABLES) {
    for (let offset = 0; offset <= 3; offset++) {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const result = await createMonthlyPartition(
        pool,
        table,
        d.getFullYear(),
        d.getMonth() + 1,
      );
      if (result) {
        actions.push({ action: 'created', partitionName: result });
      }
    }
  }

  // Drop expired partitions
  const cutoff = new Date(now.getFullYear(), now.getMonth() - maxRetentionMonths, 1);

  for (const { table } of PARTITIONED_TABLES) {
    const result = await pool.query(
      `SELECT inhrelid::regclass::text AS child_name,
              pg_get_expr(c.relpartbound, c.oid) AS bound_expr
       FROM pg_inherits
       JOIN pg_class c ON c.oid = inhrelid
       JOIN pg_class parent ON parent.oid = inhparent
       WHERE parent.relname = $1`,
      [table],
    );

    for (const row of result.rows as { child_name: string; bound_expr: string }[]) {
      // Extract start date from bound: "FOR VALUES FROM ('2025-01-01') TO ('2025-02-01')"
      const match = row.bound_expr.match(/'(\d{4}-\d{2}-\d{2})'/);
      if (match) {
        const startDate = new Date(match[1]);
        if (startDate < cutoff) {
          await pool.query(`DROP TABLE IF EXISTS ${row.child_name}`);
          actions.push({ action: 'dropped', partitionName: row.child_name });
        }
      }
    }
  }

  return actions;
}

/**
 * Get partition info for a table.
 */
export async function getPartitions(
  pool: Pool,
  table: string,
): Promise<{ name: string; bounds: string }[]> {
  const result = await pool.query(
    `SELECT inhrelid::regclass::text AS name,
            pg_get_expr(c.relpartbound, c.oid) AS bounds
     FROM pg_inherits
     JOIN pg_class c ON c.oid = inhrelid
     JOIN pg_class parent ON parent.oid = inhparent
     WHERE parent.relname = $1
     ORDER BY name`,
    [table],
  );

  return result.rows as { name: string; bounds: string }[];
}
