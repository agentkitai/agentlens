/**
 * Analytics repository — aggregation queries and stats.
 * Extracted from SqliteEventStore (Story S-7.4).
 */

import { eq, and, gte, lte, desc, asc, sql, count as drizzleCount } from 'drizzle-orm';
import type { IEventStore, AnalyticsResult, StorageStats } from '@agentlensai/core';
import type { SqliteDb } from '../index.js';
import { events, sessions, agents } from '../schema.sqlite.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('AnalyticsRepository');

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
}
