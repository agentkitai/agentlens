/**
 * Analytics repository — aggregation queries and stats.
 * Extracted from SqliteEventStore (Story S-7.4).
 */

import { eq, and, gte, lte, desc, asc, sql, count as drizzleCount } from 'drizzle-orm';
import type { IEventStore, AnalyticsResult, StorageStats } from '@agentkitai/agentlens-core';
import type { SqliteDb } from '../index.js';
import { events, sessions, agents } from '../schema.sqlite.js';
import { createLogger } from '../../lib/logger.js';
import { bucketStartHour } from '../../lib/rollup.js';
import { type AnyDb, dbAll, dbGet } from '../dialect-db.js';

export interface RollupAnalyticsResult {
  buckets: Array<{
    bucket: string;
    eventCount: number;
    toolCallCount: number;
    errorCount: number;
    llmCallCount: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    avgLatencyMs: number;
  }>;
  byAgent: Array<{ verifiedAgentId: string; costUsd: number; eventCount: number; inputTokens: number; outputTokens: number }>;
  totals: { eventCount: number; costUsd: number; inputTokens: number; outputTokens: number; llmCallCount: number };
}

const log = createLogger('AnalyticsRepository');

// ─── Rollup analytics (dialect-agnostic, #220) ────────────
// cost_rollups is plain SQL; aliases are snake_case (lowercased identically on
// both dialects — pg lowercases unquoted aliases) and mapped to camelCase in JS,
// with Number() coercion (pg returns SUM/COUNT as strings).
interface RollupParams {
  tenantId: string;
  from: string;
  to: string;
  granularity?: 'hour' | 'day';
  verifiedAgentId?: string;
}

function rollupQueries(params: RollupParams) {
  const fromHour = bucketStartHour(params.from);
  const bucketExpr =
    (params.granularity ?? 'day') === 'hour' ? sql`bucket_start` : sql`substr(bucket_start, 1, 10) || 'T00:00:00Z'`;
  const agentFilter = params.verifiedAgentId ? sql`AND verified_agent_id = ${params.verifiedAgentId}` : sql``;
  const range = sql`tenant_id = ${params.tenantId} AND granularity = 'hour' AND bucket_start >= ${fromHour} AND bucket_start <= ${params.to}`;
  return {
    buckets: sql`
      SELECT ${bucketExpr} AS bucket,
        COALESCE(SUM(event_count), 0) AS event_count,
        COALESCE(SUM(tool_call_count), 0) AS tool_call_count,
        COALESCE(SUM(error_count), 0) AS error_count,
        COALESCE(SUM(llm_call_count), 0) AS llm_call_count,
        COALESCE(SUM(cost_usd), 0) AS cost_usd,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        CASE WHEN SUM(latency_count) > 0 THEN SUM(latency_sum_ms) / SUM(latency_count) ELSE 0 END AS avg_latency_ms
      FROM cost_rollups WHERE ${range} ${agentFilter}
      GROUP BY bucket ORDER BY bucket ASC`,
    byAgent: sql`
      SELECT verified_agent_id, COALESCE(SUM(cost_usd), 0) AS cost_usd,
        COALESCE(SUM(event_count), 0) AS event_count, COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens
      FROM cost_rollups WHERE ${range}
      GROUP BY verified_agent_id ORDER BY cost_usd DESC`,
    totals: sql`
      SELECT COALESCE(SUM(event_count), 0) AS event_count, COALESCE(SUM(cost_usd), 0) AS cost_usd,
        COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(llm_call_count), 0) AS llm_call_count
      FROM cost_rollups WHERE ${range}`,
  };
}

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v ?? 0);
const mapBucket = (r: Row): RollupAnalyticsResult['buckets'][number] => ({
  bucket: String(r.bucket),
  eventCount: num(r.event_count),
  toolCallCount: num(r.tool_call_count),
  errorCount: num(r.error_count),
  llmCallCount: num(r.llm_call_count),
  costUsd: num(r.cost_usd),
  inputTokens: num(r.input_tokens),
  outputTokens: num(r.output_tokens),
  avgLatencyMs: num(r.avg_latency_ms),
});
const mapAgent = (r: Row): RollupAnalyticsResult['byAgent'][number] => ({
  verifiedAgentId: String(r.verified_agent_id),
  costUsd: num(r.cost_usd),
  eventCount: num(r.event_count),
  inputTokens: num(r.input_tokens),
  outputTokens: num(r.output_tokens),
});
const mapTotals = (r: Row): RollupAnalyticsResult['totals'] => ({
  eventCount: num(r.event_count),
  costUsd: num(r.cost_usd),
  inputTokens: num(r.input_tokens),
  outputTokens: num(r.output_tokens),
  llmCallCount: num(r.llm_call_count),
});
const EMPTY_TOTALS: RollupAnalyticsResult['totals'] = { eventCount: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, llmCallCount: 0 };

/** Dialect-agnostic rollup analytics (sqlite or postgres). */
export async function getRollupAnalyticsAsync(db: AnyDb, params: RollupParams): Promise<RollupAnalyticsResult> {
  const q = rollupQueries(params);
  const [buckets, byAgent, totals] = await Promise.all([
    dbAll<Row>(db, q.buckets),
    dbAll<Row>(db, q.byAgent),
    dbGet<Row>(db, q.totals),
  ]);
  return { buckets: buckets.map(mapBucket), byAgent: byAgent.map(mapAgent), totals: totals ? mapTotals(totals) : EMPTY_TOTALS };
}

export class AnalyticsRepository {
  constructor(private db: SqliteDb) {}

  private warnIfNoTenant(method: string, tenantId?: string): void {
    if (tenantId === undefined) {
      log.warn(
        `${method}() called without tenantId — query is unscoped. ` +
          `Ensure tenant isolation is applied upstream (via TenantScopedStore).`,
      );
    }
  }

  async getAnalytics(params: {
    from: string;
    to: string;
    agentId?: string;
    granularity: 'hour' | 'day' | 'week';
    tenantId?: string;
    orgId?: string;
    projectId?: string;
  }): Promise<AnalyticsResult> {
    this.warnIfNoTenant('getAnalytics', params.tenantId);
    const formatStr =
      params.granularity === 'hour'
        ? '%Y-%m-%dT%H:00:00Z'
        : params.granularity === 'day'
          ? '%Y-%m-%dT00:00:00Z'
          : '%Y-%W';

    const bucketRows = this.db
      .all<{
        bucket: string;
        eventCount: number;
        toolCallCount: number;
        errorCount: number;
        uniqueSessions: number;
        avgLatencyMs: number;
        totalCostUsd: number;
      }>(
        sql`
          SELECT
            strftime(${formatStr}, timestamp) as bucket,
            COUNT(*) as eventCount,
            SUM(CASE WHEN event_type = 'tool_call' THEN 1 ELSE 0 END) as toolCallCount,
            SUM(CASE WHEN severity IN ('error', 'critical') OR event_type = 'tool_error' THEN 1 ELSE 0 END) as errorCount,
            COUNT(DISTINCT session_id) as uniqueSessions,
            COALESCE(AVG(CASE WHEN event_type = 'tool_response' THEN json_extract(payload, '$.durationMs') ELSE NULL END), 0) as avgLatencyMs,
            COALESCE(SUM(CASE WHEN event_type = 'cost_tracked' THEN json_extract(payload, '$.costUsd') ELSE 0 END), 0) as totalCostUsd
          FROM events
          WHERE timestamp >= ${params.from}
            AND timestamp <= ${params.to}
            ${params.agentId ? sql`AND agent_id = ${params.agentId}` : sql``}
            ${params.tenantId ? sql`AND tenant_id = ${params.tenantId}` : sql``}
          ${params.orgId ? sql`AND org_id = ${params.orgId}` : sql``}
          ${params.projectId ? sql`AND project_id = ${params.projectId}` : sql``}
          GROUP BY bucket
          ORDER BY bucket ASC
        `,
      );

    const totalsRow = this.db.get<{
      eventCount: number;
      toolCallCount: number;
      errorCount: number;
      uniqueSessions: number;
      uniqueAgents: number;
      avgLatencyMs: number;
      totalCostUsd: number;
    }>(
      sql`
        SELECT
          COUNT(*) as eventCount,
          SUM(CASE WHEN event_type = 'tool_call' THEN 1 ELSE 0 END) as toolCallCount,
          SUM(CASE WHEN severity IN ('error', 'critical') OR event_type = 'tool_error' THEN 1 ELSE 0 END) as errorCount,
          COUNT(DISTINCT session_id) as uniqueSessions,
          COUNT(DISTINCT agent_id) as uniqueAgents,
          COALESCE(AVG(CASE WHEN event_type = 'tool_response' THEN json_extract(payload, '$.durationMs') ELSE NULL END), 0) as avgLatencyMs,
          COALESCE(SUM(CASE WHEN event_type = 'cost_tracked' THEN json_extract(payload, '$.costUsd') ELSE 0 END), 0) as totalCostUsd
        FROM events
        WHERE timestamp >= ${params.from}
          AND timestamp <= ${params.to}
          ${params.agentId ? sql`AND agent_id = ${params.agentId}` : sql``}
          ${params.tenantId ? sql`AND tenant_id = ${params.tenantId}` : sql``}
          ${params.orgId ? sql`AND org_id = ${params.orgId}` : sql``}
          ${params.projectId ? sql`AND project_id = ${params.projectId}` : sql``}
      `,
    );

    return {
      buckets: bucketRows.map((row) => ({
        timestamp: row.bucket,
        eventCount: Number(row.eventCount),
        toolCallCount: Number(row.toolCallCount),
        errorCount: Number(row.errorCount),
        avgLatencyMs: Number(row.avgLatencyMs),
        totalCostUsd: Number(row.totalCostUsd),
        uniqueSessions: Number(row.uniqueSessions),
      })),
      totals: {
        eventCount: Number(totalsRow?.eventCount ?? 0),
        toolCallCount: Number(totalsRow?.toolCallCount ?? 0),
        errorCount: Number(totalsRow?.errorCount ?? 0),
        avgLatencyMs: Number(totalsRow?.avgLatencyMs ?? 0),
        totalCostUsd: Number(totalsRow?.totalCostUsd ?? 0),
        uniqueSessions: Number(totalsRow?.uniqueSessions ?? 0),
        uniqueAgents: Number(totalsRow?.uniqueAgents ?? 0),
      },
    };
  }

  /**
   * Get per-agent cost breakdown for compliance report.
   */
  getCostByAgent(tenantId: string, from: string, to: string): Record<string, number> {
    const rows = this.db.all<{ agent_id: string; total_cost: number }>(sql`
      SELECT agent_id, COALESCE(SUM(json_extract(payload, '$.costUsd')), 0) as total_cost
      FROM events
      WHERE tenant_id = ${tenantId}
        AND timestamp >= ${from}
        AND timestamp <= ${to}
        AND event_type = 'cost_tracked'
      GROUP BY agent_id
    `);

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.agent_id] = Number(row.total_cost);
    }
    return result;
  }

  async getStats(tenantId?: string): Promise<StorageStats> {
    const eventConditions = tenantId ? [eq(events.tenantId, tenantId)] : [];
    const sessionConditions = tenantId ? [eq(sessions.tenantId, tenantId)] : [];
    const agentConditions = tenantId ? [eq(agents.tenantId, tenantId)] : [];

    const eventCount =
      this.db
        .select({ count: drizzleCount() })
        .from(events)
        .where(eventConditions.length > 0 ? and(...eventConditions) : undefined)
        .get()?.count ?? 0;

    const sessionCount =
      this.db
        .select({ count: drizzleCount() })
        .from(sessions)
        .where(sessionConditions.length > 0 ? and(...sessionConditions) : undefined)
        .get()?.count ?? 0;

    const agentCount =
      this.db
        .select({ count: drizzleCount() })
        .from(agents)
        .where(agentConditions.length > 0 ? and(...agentConditions) : undefined)
        .get()?.count ?? 0;

    const oldest = this.db
      .select({ timestamp: events.timestamp })
      .from(events)
      .where(eventConditions.length > 0 ? and(...eventConditions) : undefined)
      .orderBy(asc(events.timestamp))
      .limit(1)
      .get();

    const newest = this.db
      .select({ timestamp: events.timestamp })
      .from(events)
      .where(eventConditions.length > 0 ? and(...eventConditions) : undefined)
      .orderBy(desc(events.timestamp))
      .limit(1)
      .get();

    const pageCount =
      this.db.get<{ page_count: number }>(sql`PRAGMA page_count`)
        ?.page_count ?? 0;
    const pageSize =
      this.db.get<{ page_size: number }>(sql`PRAGMA page_size`)
        ?.page_size ?? 0;

    return {
      totalEvents: eventCount,
      totalSessions: sessionCount,
      totalAgents: agentCount,
      oldestEvent: oldest?.timestamp,
      newestEvent: newest?.timestamp,
      storageSizeBytes: pageCount * pageSize,
    };
  }

  /**
   * Coarse-grained analytics read from precomputed `cost_rollups` (#124) instead
   * of scanning raw events — for cost/usage/health over long ranges. Keyed on
   * `verified_agent_id` (billing-grade attribution) and re-bucketed from the
   * stored hourly grain to the requested granularity. Survives raw-event purge.
   * Drill-down / sub-bucket / unique-session queries stay on the raw path.
   */
  getRollupAnalytics(params: RollupParams): RollupAnalyticsResult {
    const q = rollupQueries(params);
    const totals = this.db.get<Row>(q.totals);
    return {
      buckets: this.db.all<Row>(q.buckets).map(mapBucket),
      byAgent: this.db.all<Row>(q.byAgent).map(mapAgent),
      totals: totals ? mapTotals(totals) : EMPTY_TOTALS,
    };
  }
}
