/**
 * Usage Dashboard Routes (S-7.4)
 *
 * Express-compatible route handlers for usage data.
 * Mounted at /api/cloud/orgs/:orgId/usage
 */

import type { MigrationClient } from '../migrate.js';

export interface UsageRoutesDeps {
  db: MigrationClient;
}

type TimeRange = '7d' | '30d' | '90d';

const RANGE_DAYS: Record<TimeRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

const TIER_QUOTAS: Record<string, { events: number; storage_bytes: number }> = {
  free: { events: 10_000, storage_bytes: 1_073_741_824 }, // 1GB
  pro: { events: 1_000_000, storage_bytes: 107_374_182_400 }, // 100GB
  team: { events: 10_000_000, storage_bytes: 1_099_511_627_776 }, // 1TB
  enterprise: { events: 100_000_000, storage_bytes: 10_995_116_277_760 }, // 10TB
};

export function createUsageRouteHandlers(deps: UsageRoutesDeps) {
  return {
    /** GET /api/cloud/orgs/:orgId/usage?range=30d */
    async getUsage(
      orgId: string,
      range: string = '30d',
    ): Promise<{ status: number; body: unknown }> {
      const validRange = (RANGE_DAYS[range as TimeRange] ? range : '30d') as TimeRange;
      const days = RANGE_DAYS[validRange];

      // Get org plan
      const orgResult = await deps.db.query(`SELECT plan FROM orgs WHERE id = $1`, [orgId]);
      const plan = (orgResult.rows as any[])[0]?.plan ?? 'free';
      const quota = TIER_QUOTAS[plan] ?? TIER_QUOTAS.free;

      // Get aggregated usage for the period
      const now = new Date();
      const periodStart = new Date(now.getTime() - days * 86_400_000);

      // Query usage_records for summary
      const summaryResult = await deps.db.query(
        `SELECT
           COALESCE(SUM(event_count), 0)::int as events_count
         FROM usage_records
         WHERE org_id = $1 AND hour >= $2`,
        [orgId, periodStart.toISOString()],
      );

      const summary = (summaryResult.rows as any[])[0] ?? {
        events_count: 0,
      };

      // Query timeseries (daily buckets)
      const timeseriesResult = await deps.db.query(
        `SELECT
           date_trunc('day', hour) as timestamp,
           COALESCE(SUM(event_count), 0)::int as events
         FROM usage_records
         WHERE org_id = $1 AND hour >= $2
         GROUP BY date_trunc('day', hour)
         ORDER BY timestamp`,
        [orgId, periodStart.toISOString()],
      );

      return {
        status: 200,
        body: {
          summary: {
            events_count: Number(summary.events_count),
            quota_events: quota.events,
            plan,
            period_start: periodStart.toISOString().slice(0, 10),
            period_end: now.toISOString().slice(0, 10),
          },
          timeseries: (timeseriesResult.rows as any[]).map((r) => ({
            timestamp: r.timestamp,
            events: Number(r.events),
          })),
        },
      };
    },
  };
}
