/**
 * PostgreSQL Storage Adapter (S-4.2, S-4.3, S-4.4)
 *
 * Implements StorageAdapter for the cloud Postgres backend.
 * Uses the tenant pool from B2A for automatic org scoping via
 * SET LOCAL app.current_org within transactions.
 *
 * All queries use org_id composite indexes. RLS provides automatic
 * tenant scoping as defense-in-depth (queries also filter by org_id
 * explicitly for index usage).
 *
 * S-4.3: Analytics queries use date_trunc + window functions for Postgres.
 * S-4.4: Full-text search uses tsvector/to_tsquery with GIN indexes.
 */

import type {
  AgentLensEvent,
  EventQuery,
  EventQueryResult,
  Session,
  SessionQuery,
  Agent,
  HealthSnapshot,
} from '@agentlensai/core';
import type { AnalyticsResult, StorageStats } from '@agentlensai/core';
import type {
  StorageAdapter,
  PaginatedResult,
  AnalyticsQuery,
  CostAnalyticsResult,
  HealthAnalyticsResult,
  TokenUsageResult,
  SearchQuery,
  SearchResult,
} from './adapter.js';
import type { Pool } from '../tenant-pool.js';
import { withTenantTransaction } from '../tenant-pool.js';

// ─── Helpers ────────────────────────────────────────────────

function safeJson<T>(val: unknown, fallback: T): T {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val as T;
  if (typeof val === 'string') {
    try { return JSON.parse(val) as T; } catch { return fallback; }
  }
  return fallback;
}

function mapEventRow(row: Record<string, unknown>): AgentLensEvent {
  return {
    id: row.id as string,
    timestamp: row.timestamp as string,
    sessionId: (row.session_id ?? row.sessionId) as string,
    agentId: (row.agent_id ?? row.agentId) as string,
    eventType: (row.event_type ?? row.eventType) as AgentLensEvent['eventType'],
    severity: row.severity as AgentLensEvent['severity'],
    payload: safeJson(row.payload, {}),
    metadata: safeJson(row.metadata, {}),
    prevHash: (row.prev_hash ?? row.prevHash) as string | null,
    hash: row.hash as string,
    tenantId: (row.tenant_id ?? row.tenantId ?? row.org_id ?? row.orgId) as string,
  };
}

function mapSessionRow(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    agentId: (row.agent_id ?? row.agentId) as string,
    agentName: (row.agent_name ?? row.agentName) as string | undefined,
    startedAt: (row.started_at ?? row.startedAt) as string,
    endedAt: (row.ended_at ?? row.endedAt) as string | undefined,
    status: row.status as Session['status'],
    eventCount: Number(row.event_count ?? row.eventCount ?? 0),
    toolCallCount: Number(row.tool_call_count ?? row.toolCallCount ?? 0),
    errorCount: Number(row.error_count ?? row.errorCount ?? 0),
    totalCostUsd: Number(row.total_cost_usd ?? row.totalCostUsd ?? 0),
    llmCallCount: Number(row.llm_call_count ?? row.llmCallCount ?? 0),
    totalInputTokens: Number(row.total_input_tokens ?? row.totalInputTokens ?? 0),
    totalOutputTokens: Number(row.total_output_tokens ?? row.totalOutputTokens ?? 0),
    tags: safeJson(row.tags, [] as string[]),
    tenantId: (row.tenant_id ?? row.tenantId ?? row.org_id ?? row.orgId) as string,
  };
}

function mapAgentRow(row: Record<string, unknown>): Agent {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | undefined,
    firstSeenAt: (row.first_seen_at ?? row.firstSeenAt) as string,
    lastSeenAt: (row.last_seen_at ?? row.lastSeenAt) as string,
    sessionCount: Number(row.session_count ?? row.sessionCount ?? 0),
    tenantId: (row.tenant_id ?? row.tenantId ?? row.org_id ?? row.orgId) as string,
    modelOverride: (row.model_override ?? row.modelOverride) as string | undefined,
    pausedAt: (row.paused_at ?? row.pausedAt) as string | undefined,
    pauseReason: (row.pause_reason ?? row.pauseReason) as string | undefined,
  };
}

// ─── Event Query Builder ────────────────────────────────────

interface QueryParts {
  where: string[];
  params: unknown[];
  paramIdx: number;
}

function buildEventWhere(orgId: string, query: EventQuery): QueryParts {
  const where: string[] = [`org_id = $1`];
  const params: unknown[] = [orgId];
  let idx = 2;

  if (query.sessionId) {
    where.push(`session_id = $${idx}`);
    params.push(query.sessionId);
    idx++;
  }
  if (query.agentId) {
    where.push(`agent_id = $${idx}`);
    params.push(query.agentId);
    idx++;
  }
  if (query.eventType) {
    const types = Array.isArray(query.eventType) ? query.eventType : [query.eventType];
    where.push(`event_type = ANY($${idx})`);
    params.push(types);
    idx++;
  }
  if (query.severity) {
    const sevs = Array.isArray(query.severity) ? query.severity : [query.severity];
    where.push(`severity = ANY($${idx})`);
    params.push(sevs);
    idx++;
  }
  if (query.from) {
    where.push(`timestamp >= $${idx}`);
    params.push(query.from);
    idx++;
  }
  if (query.to) {
    where.push(`timestamp <= $${idx}`);
    params.push(query.to);
    idx++;
  }
  if (query.search) {
    where.push(`payload::text ILIKE $${idx}`);
    params.push(`%${query.search}%`);
    idx++;
  }

  return { where, params, paramIdx: idx };
}

function buildSessionWhere(orgId: string, query: SessionQuery): QueryParts {
  const where: string[] = [`org_id = $1`];
  const params: unknown[] = [orgId];
  let idx = 2;

  if (query.agentId) {
    where.push(`agent_id = $${idx}`);
    params.push(query.agentId);
    idx++;
  }
  if (query.status) {
    const statuses = Array.isArray(query.status) ? query.status : [query.status];
    where.push(`status = ANY($${idx})`);
    params.push(statuses);
    idx++;
  }
  if (query.from) {
    where.push(`started_at >= $${idx}`);
    params.push(query.from);
    idx++;
  }
  if (query.to) {
    where.push(`started_at <= $${idx}`);
    params.push(query.to);
    idx++;
  }
  if (query.tags && query.tags.length > 0) {
    where.push(`tags ?| $${idx}`);
    params.push(query.tags);
    idx++;
  }

  return { where, params, paramIdx: idx };
}

// ─── Analytics Helpers (S-4.3) ──────────────────────────────

function pgDateTrunc(granularity: 'hour' | 'day' | 'week'): string {
  return granularity; // Postgres date_trunc accepts 'hour', 'day', 'week' directly
}

// ─── PostgreSQL Storage Adapter ─────────────────────────────

export class PostgresStorageAdapter implements StorageAdapter {
  constructor(private readonly pool: Pool) {}

  async queryEvents(orgId: string, query: EventQuery): Promise<EventQueryResult> {
    return withTenantTransaction(this.pool, orgId, async (client) => {
      const { where, params, paramIdx } = buildEventWhere(orgId, query);
      const whereClause = where.join(' AND ');
      const orderDir = query.order === 'asc' ? 'ASC' : 'DESC';
      const limit = Math.min(query.limit ?? 50, 500);
      const offset = query.offset ?? 0;

      const countResult = await client.query(
        `SELECT COUNT(*)::int AS total FROM events WHERE ${whereClause}`,
        params,
      );
      const total = (countResult.rows[0] as { total: number })?.total ?? 0;

      const dataResult = await client.query(
        `SELECT * FROM events WHERE ${whereClause} ORDER BY timestamp ${orderDir} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset],
      );

      const events = (dataResult.rows as Record<string, unknown>[]).map(mapEventRow);
      return { events, total, hasMore: offset + events.length < total };
    });
  }

  async getEventsBySession(orgId: string, sessionId: string): Promise<AgentLensEvent[]> {
    return withTenantTransaction(this.pool, orgId, async (client) => {
      const result = await client.query(
        `SELECT * FROM events WHERE org_id = $1 AND session_id = $2 ORDER BY timestamp ASC`,
        [orgId, sessionId],
      );
      return (result.rows as Record<string, unknown>[]).map(mapEventRow);
    });
  }

  async getSessions(orgId: string, query: SessionQuery): Promise<PaginatedResult<Session>> {
    return withTenantTransaction(this.pool, orgId, async (client) => {
      const { where, params, paramIdx } = buildSessionWhere(orgId, query);
      const whereClause = where.join(' AND ');
      const limit = Math.min(query.limit ?? 50, 500);
      const offset = query.offset ?? 0;

      const countResult = await client.query(
        `SELECT COUNT(*)::int AS total FROM sessions WHERE ${whereClause}`,
        params,
      );
      const total = (countResult.rows[0] as { total: number })?.total ?? 0;

      const dataResult = await client.query(
        `SELECT * FROM sessions WHERE ${whereClause} ORDER BY started_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset],
      );

      const items = (dataResult.rows as Record<string, unknown>[]).map(mapSessionRow);
      return { items, total, hasMore: offset + items.length < total };
    });
  }

  async getSession(orgId: string, sessionId: string): Promise<Session | null> {
    return withTenantTransaction(this.pool, orgId, async (client) => {
      const result = await client.query(
        `SELECT * FROM sessions WHERE org_id = $1 AND id = $2 LIMIT 1`,
        [orgId, sessionId],
      );
      if (result.rows.length === 0) return null;
      return mapSessionRow(result.rows[0] as Record<string, unknown>);
    });
  }

  async getAgents(orgId: string): Promise<Agent[]> {
    return withTenantTransaction(this.pool, orgId, async (client) => {
      const result = await client.query(
        `SELECT * FROM agents WHERE org_id = $1 ORDER BY last_seen_at DESC`,
        [orgId],
      );
      return (result.rows as Record<string, unknown>[]).map(mapAgentRow);
    });
  }

  async getStats(orgId: string): Promise<StorageStats> {
    return withTenantTransaction(this.pool, orgId, async (client) => {
      const eventCount = await client.query(
        `SELECT COUNT(*)::int AS c FROM events WHERE org_id = $1`, [orgId],
      );
      const sessionCount = await client.query(
        `SELECT COUNT(*)::int AS c FROM sessions WHERE org_id = $1`, [orgId],
      );
      const agentCount = await client.query(
        `SELECT COUNT(*)::int AS c FROM agents WHERE org_id = $1`, [orgId],
      );
      const oldest = await client.query(
        `SELECT timestamp FROM events WHERE org_id = $1 ORDER BY timestamp ASC LIMIT 1`, [orgId],
      );
      const newest = await client.query(
        `SELECT timestamp FROM events WHERE org_id = $1 ORDER BY timestamp DESC LIMIT 1`, [orgId],
      );
      const sizeResult = await client.query(
        `SELECT pg_total_relation_size('events') AS size_bytes`,
      );

      return {
        totalEvents: (eventCount.rows[0] as { c: number })?.c ?? 0,
        totalSessions: (sessionCount.rows[0] as { c: number })?.c ?? 0,
        totalAgents: (agentCount.rows[0] as { c: number })?.c ?? 0,
        oldestEvent: (oldest.rows[0] as { timestamp: string } | undefined)?.timestamp,
        newestEvent: (newest.rows[0] as { timestamp: string } | undefined)?.timestamp,
        storageSizeBytes: Number((sizeResult.rows[0] as { size_bytes: number })?.size_bytes ?? 0),
      };
    });
  }

  // ═══════════════════════════════════════════════════════════
  // S-4.3: Analytics Queries (Postgres-optimized)
  // ═══════════════════════════════════════════════════════════

  async getCostAnalytics(orgId: string, query: AnalyticsQuery): Promise<CostAnalyticsResult> {
    return withTenantTransaction(this.pool, orgId, async (client) => {
      const trunc = pgDateTrunc(query.granularity);
      const params: unknown[] = [orgId, query.from, query.to];
      let agentFilter = '';
      if (query.agentId) {
        agentFilter = `AND agent_id = $4`;
        params.push(query.agentId);
      }

      const result = await client.query(
        `SELECT
           date_trunc('${trunc}', timestamp) AS bucket,
           COALESCE(SUM((payload->>'costUsd')::numeric), 0)::float AS total_cost,
           COUNT(*)::int AS event_count
         FROM events
         WHERE org_id = $1
           AND timestamp >= $2
           AND timestamp <= $3
           AND event_type = 'cost_tracked'
           ${agentFilter}
         GROUP BY bucket
         ORDER BY bucket ASC`,
        params,
      );

      const buckets = (result.rows as Record<string, unknown>[]).map((row) => ({
        timestamp: String(row.bucket),
        totalCostUsd: Number(row.total_cost ?? 0),
        eventCount: Number(row.event_count ?? 0),
      }));

      const totalCostUsd = buckets.reduce((sum, b) => sum + b.totalCostUsd, 0);
      const totalEvents = buckets.reduce((sum, b) => sum + b.eventCount, 0);

      return { buckets, totalCostUsd, totalEvents };
    });
  }

  async getHealthAnalytics(orgId: string, query: AnalyticsQuery): Promise<HealthAnalyticsResult> {
    return withTenantTransaction(this.pool, orgId, async (client) => {
      const params: unknown[] = [orgId, query.from, query.to];
      let agentFilter = '';
      if (query.agentId) {
        agentFilter = `AND agent_id = $4`;
        params.push(query.agentId);
      }

      const result = await client.query(
        `SELECT
           agent_id,
           date::text AS date,
           overall_score,
           error_rate_score,
           cost_efficiency_score,
           tool_success_score,
           latency_score,
           completion_rate_score,
           session_count
         FROM health_snapshots
         WHERE org_id = $1
           AND date >= $2::date
           AND date <= $3::date
           ${agentFilter}
         ORDER BY date ASC, agent_id ASC`,
        params,
      );

      const snapshots: HealthSnapshot[] = (result.rows as Record<string, unknown>[]).map((row) => ({
        agentId: row.agent_id as string,
        date: row.date as string,
        overallScore: Number(row.overall_score ?? 0),
        errorRateScore: Number(row.error_rate_score ?? 0),
        costEfficiencyScore: Number(row.cost_efficiency_score ?? 0),
        toolSuccessScore: Number(row.tool_success_score ?? 0),
        latencyScore: Number(row.latency_score ?? 0),
        completionRateScore: Number(row.completion_rate_score ?? 0),
        sessionCount: Number(row.session_count ?? 0),
      }));

      return { snapshots };
    });
  }

  async getTokenUsage(orgId: string, query: AnalyticsQuery): Promise<TokenUsageResult> {
    return withTenantTransaction(this.pool, orgId, async (client) => {
      const trunc = pgDateTrunc(query.granularity);
      const params: unknown[] = [orgId, query.from, query.to];
      let agentFilter = '';
      if (query.agentId) {
        agentFilter = `AND agent_id = $4`;
        params.push(query.agentId);
      }

      const result = await client.query(
        `SELECT
           date_trunc('${trunc}', timestamp) AS bucket,
           COALESCE(SUM((payload->>'inputTokens')::int), 0)::int AS input_tokens,
           COALESCE(SUM((payload->>'outputTokens')::int), 0)::int AS output_tokens,
           COALESCE(SUM((payload->>'inputTokens')::int + (payload->>'outputTokens')::int), 0)::int AS total_tokens,
           COUNT(*)::int AS llm_call_count
         FROM events
         WHERE org_id = $1
           AND timestamp >= $2
           AND timestamp <= $3
           AND event_type = 'llm_response'
           ${agentFilter}
         GROUP BY bucket
         ORDER BY bucket ASC`,
        params,
      );

      const buckets = (result.rows as Record<string, unknown>[]).map((row) => ({
        timestamp: String(row.bucket),
        inputTokens: Number(row.input_tokens ?? 0),
        outputTokens: Number(row.output_tokens ?? 0),
        totalTokens: Number(row.total_tokens ?? 0),
        llmCallCount: Number(row.llm_call_count ?? 0),
      }));

      const totals = buckets.reduce(
        (acc, b) => ({
          inputTokens: acc.inputTokens + b.inputTokens,
          outputTokens: acc.outputTokens + b.outputTokens,
          totalTokens: acc.totalTokens + b.totalTokens,
          llmCallCount: acc.llmCallCount + b.llmCallCount,
        }),
        { inputTokens: 0, outputTokens: 0, totalTokens: 0, llmCallCount: 0 },
      );

      return { buckets, totals };
    });
  }

  async getAnalytics(orgId: string, query: AnalyticsQuery): Promise<AnalyticsResult> {
    return withTenantTransaction(this.pool, orgId, async (client) => {
      const trunc = pgDateTrunc(query.granularity);
      const params: unknown[] = [orgId, query.from, query.to];
      let agentFilter = '';
      if (query.agentId) {
        agentFilter = `AND agent_id = $4`;
        params.push(query.agentId);
      }

      // Bucketed query using date_trunc (Postgres-optimized)
      const bucketResult = await client.query(
        `SELECT
           date_trunc('${trunc}', timestamp) AS bucket,
           COUNT(*)::int AS event_count,
           SUM(CASE WHEN event_type = 'tool_call' THEN 1 ELSE 0 END)::int AS tool_call_count,
           SUM(CASE WHEN severity IN ('error', 'critical') OR event_type = 'tool_error' THEN 1 ELSE 0 END)::int AS error_count,
           COUNT(DISTINCT session_id)::int AS unique_sessions,
           COALESCE(AVG(CASE WHEN event_type = 'tool_response' THEN (payload->>'durationMs')::numeric ELSE NULL END), 0)::float AS avg_latency_ms,
           COALESCE(SUM(CASE WHEN event_type = 'cost_tracked' THEN (payload->>'costUsd')::numeric ELSE 0 END), 0)::float AS total_cost_usd
         FROM events
         WHERE org_id = $1 AND timestamp >= $2 AND timestamp <= $3
           ${agentFilter}
         GROUP BY bucket
         ORDER BY bucket ASC`,
        params,
      );

      // Totals query
      const totalsResult = await client.query(
        `SELECT
           COUNT(*)::int AS event_count,
           SUM(CASE WHEN event_type = 'tool_call' THEN 1 ELSE 0 END)::int AS tool_call_count,
           SUM(CASE WHEN severity IN ('error', 'critical') OR event_type = 'tool_error' THEN 1 ELSE 0 END)::int AS error_count,
           COUNT(DISTINCT session_id)::int AS unique_sessions,
           COUNT(DISTINCT agent_id)::int AS unique_agents,
           COALESCE(AVG(CASE WHEN event_type = 'tool_response' THEN (payload->>'durationMs')::numeric ELSE NULL END), 0)::float AS avg_latency_ms,
           COALESCE(SUM(CASE WHEN event_type = 'cost_tracked' THEN (payload->>'costUsd')::numeric ELSE 0 END), 0)::float AS total_cost_usd
         FROM events
         WHERE org_id = $1 AND timestamp >= $2 AND timestamp <= $3
           ${agentFilter}`,
        params,
      );

      const totalsRow = totalsResult.rows[0] as Record<string, unknown> | undefined;

      return {
        buckets: (bucketResult.rows as Record<string, unknown>[]).map((row) => ({
          timestamp: String(row.bucket),
          eventCount: Number(row.event_count ?? 0),
          toolCallCount: Number(row.tool_call_count ?? 0),
          errorCount: Number(row.error_count ?? 0),
          avgLatencyMs: Number(row.avg_latency_ms ?? 0),
          totalCostUsd: Number(row.total_cost_usd ?? 0),
          uniqueSessions: Number(row.unique_sessions ?? 0),
        })),
        totals: {
          eventCount: Number(totalsRow?.event_count ?? 0),
          toolCallCount: Number(totalsRow?.tool_call_count ?? 0),
          errorCount: Number(totalsRow?.error_count ?? 0),
          avgLatencyMs: Number(totalsRow?.avg_latency_ms ?? 0),
          totalCostUsd: Number(totalsRow?.total_cost_usd ?? 0),
          uniqueSessions: Number(totalsRow?.unique_sessions ?? 0),
          uniqueAgents: Number(totalsRow?.unique_agents ?? 0),
        },
      };
    });
  }

  // ═══════════════════════════════════════════════════════════
  // S-4.4: Full-Text Search (Postgres tsvector/to_tsquery)
  // ═══════════════════════════════════════════════════════════

  async search(orgId: string, query: SearchQuery): Promise<SearchResult> {
    return withTenantTransaction(this.pool, orgId, async (client) => {
      const limit = Math.min(query.limit ?? 20, 100);
      const offset = query.offset ?? 0;
      const scope = query.scope ?? 'all';

      // Sanitize query for to_tsquery: replace spaces with & for AND semantics
      const tsQuery = query.query
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => w.replace(/[^\w]/g, ''))
        .filter(Boolean)
        .join(' & ');

      if (!tsQuery) {
        return { items: [], total: 0, hasMore: false };
      }

      const items: SearchResult['items'] = [];
      let total = 0;

      // Search events
      if (scope === 'events' || scope === 'all') {
        const timeFilters: string[] = [];
        const params: unknown[] = [orgId, tsQuery];
        let idx = 3;

        if (query.from) {
          timeFilters.push(`AND e.timestamp >= $${idx}`);
          params.push(query.from);
          idx++;
        }
        if (query.to) {
          timeFilters.push(`AND e.timestamp <= $${idx}`);
          params.push(query.to);
          idx++;
        }

        const timeFilterStr = timeFilters.join(' ');

        // Use to_tsvector on payload::text + event_type for full-text search
        // ts_rank for scoring, ts_headline for highlighted snippets
        const eventResult = await client.query(
          `WITH matched AS (
             SELECT
               e.id,
               e.session_id,
               e.timestamp,
               ts_rank(
                 to_tsvector('english', COALESCE(e.event_type, '') || ' ' || COALESCE(e.payload::text, '')),
                 to_tsquery('english', $2)
               ) AS score,
               ts_headline('english',
                 COALESCE(e.event_type, '') || ' ' || COALESCE(e.payload::text, ''),
                 to_tsquery('english', $2),
                 'MaxWords=30, MinWords=10, StartSel=<<, StopSel=>>'
               ) AS headline
             FROM events e
             WHERE e.org_id = $1
               AND to_tsvector('english', COALESCE(e.event_type, '') || ' ' || COALESCE(e.payload::text, ''))
                   @@ to_tsquery('english', $2)
               ${timeFilterStr}
           )
           SELECT *, (SELECT COUNT(*)::int FROM matched) AS total_count
           FROM matched
           ORDER BY score DESC
           LIMIT $${idx} OFFSET $${idx + 1}`,
          [...params, limit, offset],
        );

        for (const row of eventResult.rows as Record<string, unknown>[]) {
          items.push({
            type: 'event',
            id: row.id as string,
            score: Number(row.score ?? 0),
            headline: row.headline as string,
            timestamp: row.timestamp as string,
            sessionId: row.session_id as string,
          });
          total = Number(row.total_count ?? 0);
        }
      }

      // Search sessions
      if (scope === 'sessions' || scope === 'all') {
        const timeFilters: string[] = [];
        const params: unknown[] = [orgId, tsQuery];
        let idx = 3;

        if (query.from) {
          timeFilters.push(`AND s.started_at >= $${idx}`);
          params.push(query.from);
          idx++;
        }
        if (query.to) {
          timeFilters.push(`AND s.started_at <= $${idx}`);
          params.push(query.to);
          idx++;
        }

        const timeFilterStr = timeFilters.join(' ');

        const sessionResult = await client.query(
          `WITH matched AS (
             SELECT
               s.id,
               s.started_at AS timestamp,
               ts_rank(
                 to_tsvector('english', COALESCE(s.agent_name, '') || ' ' || COALESCE(s.tags::text, '')),
                 to_tsquery('english', $2)
               ) AS score,
               ts_headline('english',
                 COALESCE(s.agent_name, '') || ' ' || COALESCE(s.tags::text, ''),
                 to_tsquery('english', $2),
                 'MaxWords=30, MinWords=10, StartSel=<<, StopSel=>>'
               ) AS headline
             FROM sessions s
             WHERE s.org_id = $1
               AND to_tsvector('english', COALESCE(s.agent_name, '') || ' ' || COALESCE(s.tags::text, ''))
                   @@ to_tsquery('english', $2)
               ${timeFilterStr}
           )
           SELECT *, (SELECT COUNT(*)::int FROM matched) AS total_count
           FROM matched
           ORDER BY score DESC
           LIMIT $${idx} OFFSET $${idx + 1}`,
          [...params, limit, offset],
        );

        const sessionTotal = Number(
          (sessionResult.rows[0] as Record<string, unknown>)?.total_count ?? 0,
        );

        for (const row of sessionResult.rows as Record<string, unknown>[]) {
          items.push({
            type: 'session',
            id: row.id as string,
            score: Number(row.score ?? 0),
            headline: row.headline as string,
            timestamp: row.timestamp as string,
          });
        }

        if (scope === 'all') {
          total += sessionTotal;
        } else {
          total = sessionTotal;
        }
      }

      // Sort combined results by score descending
      items.sort((a, b) => b.score - a.score);

      return {
        items: items.slice(0, limit),
        total,
        hasMore: offset + items.length < total,
      };
    });
  }
}
