/**
 * Analytics Endpoints (Story 11.2)
 *
 * GET /api/analytics         — bucketed metrics over time
 * GET /api/analytics/costs   — cost breakdown by agent and time period
 * GET /api/analytics/agents  — per-agent metrics (session count, error rate, avg duration, total cost)
 * GET /api/analytics/tools   — tool usage statistics (frequency, avg duration, error rate per tool)
 */

import { Hono } from 'hono';
import { sql, gte, lte, eq, and } from 'drizzle-orm';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import type { SqliteDb } from '../db/index.js';
import { events, sessions } from '../db/schema.sqlite.js';
import { getTenantStore } from './tenant-helper.js';

export function analyticsRoutes(store: IEventStore, db: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET /api/analytics — bucketed metrics over time
  app.get('/', async (c) => {
    const tenantStore = getTenantStore(store, c);
    const range = c.req.query('range');
    const now = Date.now();
    let from: string;
    let to: string = c.req.query('to') ?? new Date(now).toISOString();

    if (range && !c.req.query('from')) {
      const rangeMs: Record<string, number> = {
        '1h': 3_600_000, '6h': 21_600_000, '24h': 86_400_000,
        '3d': 259_200_000, '7d': 604_800_000, '30d': 2_592_000_000,
      };
      const ms = rangeMs[range];
      from = ms ? new Date(now - ms).toISOString() : new Date(now - 86_400_000).toISOString();
    } else {
      from = c.req.query('from') ?? new Date(now - 86_400_000).toISOString();
    }

    const granularity = (c.req.query('granularity') ?? 'hour') as 'hour' | 'day' | 'week';
    const agentId = c.req.query('agentId');

    if (!['hour', 'day', 'week'].includes(granularity)) {
      return c.json({ error: 'Invalid granularity. Use: hour, day, week', status: 400 }, 400);
    }

    const result = await tenantStore.getAnalytics({ from, to, agentId, granularity });

    return c.json(result);
  });

  // GET /api/analytics/costs — cost breakdown by agent and time
  app.get('/costs', async (c) => {
    const tenantId = c.get('apiKey')?.tenantId ?? 'default';
    const from = c.req.query('from') ?? new Date(Date.now() - 86400_000).toISOString();
    const to = c.req.query('to') ?? new Date().toISOString();
    const granularity = (c.req.query('granularity') ?? 'day') as 'hour' | 'day' | 'week';

    const formatStr =
      granularity === 'hour'
        ? '%Y-%m-%dT%H:00:00Z'
        : granularity === 'day'
          ? '%Y-%m-%dT00:00:00Z'
          : '%Y-%W';

    // Cost by agent
    const byAgent = db
      .all<{
        agentId: string;
        totalCostUsd: number;
        totalInputTokens: number;
        totalOutputTokens: number;
        totalTokens: number;
        eventCount: number;
      }>(
        sql`
          SELECT
            agent_id as agentId,
            COALESCE(SUM(json_extract(payload, '$.costUsd')), 0) as totalCostUsd,
            COALESCE(SUM(COALESCE(json_extract(payload, '$.inputTokens'), json_extract(payload, '$.usage.inputTokens'))), 0) as totalInputTokens,
            COALESCE(SUM(COALESCE(json_extract(payload, '$.outputTokens'), json_extract(payload, '$.usage.outputTokens'))), 0) as totalOutputTokens,
            COALESCE(SUM(COALESCE(json_extract(payload, '$.totalTokens'), json_extract(payload, '$.usage.totalTokens'))), 0) as totalTokens,
            COUNT(*) as eventCount
          FROM events
          WHERE event_type IN ('cost_tracked', 'llm_response')
            AND timestamp >= ${from}
            AND timestamp <= ${to}
            AND tenant_id = ${tenantId}
          GROUP BY agent_id
          ORDER BY totalCostUsd DESC
        `,
      );

    // Cost over time — broken down by agent for stacked chart
    const overTimeByAgent = db
      .all<{
        bucket: string;
        agentId: string;
        totalCostUsd: number;
        eventCount: number;
      }>(
        sql`
          SELECT
            strftime(${formatStr}, timestamp) as bucket,
            agent_id as agentId,
            COALESCE(SUM(json_extract(payload, '$.costUsd')), 0) as totalCostUsd,
            COUNT(*) as eventCount
          FROM events
          WHERE event_type IN ('cost_tracked', 'llm_response')
            AND timestamp >= ${from}
            AND timestamp <= ${to}
            AND tenant_id = ${tenantId}
          GROUP BY bucket, agent_id
          ORDER BY bucket ASC
        `,
      );

    // Pivot: group by bucket, with per-agent cost fields
    const bucketMap = new Map<string, { bucket: string; totalCostUsd: number; eventCount: number; byAgent: Record<string, number> }>();
    for (const row of overTimeByAgent) {
      const existing = bucketMap.get(row.bucket) ?? {
        bucket: row.bucket,
        totalCostUsd: 0,
        eventCount: 0,
        byAgent: {},
      };
      existing.totalCostUsd += Number(row.totalCostUsd);
      existing.eventCount += Number(row.eventCount);
      existing.byAgent[row.agentId] = Number(row.totalCostUsd);
      bucketMap.set(row.bucket, existing);
    }
    const overTime = Array.from(bucketMap.values());

    // Total cost
    const total = db.get<{
      totalCostUsd: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalTokens: number;
    }>(
      sql`
        SELECT
          COALESCE(SUM(json_extract(payload, '$.costUsd')), 0) as totalCostUsd,
          COALESCE(SUM(COALESCE(json_extract(payload, '$.inputTokens'), json_extract(payload, '$.usage.inputTokens'))), 0) as totalInputTokens,
          COALESCE(SUM(COALESCE(json_extract(payload, '$.outputTokens'), json_extract(payload, '$.usage.outputTokens'))), 0) as totalOutputTokens,
          COALESCE(SUM(COALESCE(json_extract(payload, '$.totalTokens'), json_extract(payload, '$.usage.totalTokens'))), 0) as totalTokens
        FROM events
        WHERE event_type IN ('cost_tracked', 'llm_response')
          AND timestamp >= ${from}
          AND timestamp <= ${to}
          AND tenant_id = ${tenantId}
      `,
    );

    return c.json({
      byAgent: byAgent.map((r) => ({
        agentId: r.agentId,
        totalCostUsd: Number(r.totalCostUsd),
        totalInputTokens: Number(r.totalInputTokens),
        totalOutputTokens: Number(r.totalOutputTokens),
        totalTokens: Number(r.totalTokens),
        eventCount: Number(r.eventCount),
      })),
      overTime: overTime.map((r) => ({
        bucket: r.bucket,
        totalCostUsd: Number(r.totalCostUsd),
        eventCount: Number(r.eventCount),
        byAgent: r.byAgent,
      })),
      totals: {
        totalCostUsd: Number(total?.totalCostUsd ?? 0),
        totalInputTokens: Number(total?.totalInputTokens ?? 0),
        totalOutputTokens: Number(total?.totalOutputTokens ?? 0),
        totalTokens: Number(total?.totalTokens ?? 0),
      },
    });
  });

  // GET /api/analytics/agents — per-agent metrics
  app.get('/agents', async (c) => {
    const tenantId = c.get('apiKey')?.tenantId ?? 'default';
    const from = c.req.query('from') ?? new Date(Date.now() - 86400_000).toISOString();
    const to = c.req.query('to') ?? new Date().toISOString();

    const rows = db.all<{
      agentId: string;
      sessionCount: number;
      totalEvents: number;
      totalErrors: number;
      totalCostUsd: number;
      avgDurationMs: number;
    }>(
      sql`
        SELECT
          s.agent_id as agentId,
          COUNT(DISTINCT s.id) as sessionCount,
          COALESCE(SUM(s.event_count), 0) as totalEvents,
          COALESCE(SUM(s.error_count), 0) as totalErrors,
          COALESCE(SUM(s.total_cost_usd), 0) as totalCostUsd,
          COALESCE(AVG(
            CASE
              WHEN s.ended_at IS NOT NULL
              THEN (julianday(s.ended_at) - julianday(s.started_at)) * 86400000
              ELSE NULL
            END
          ), 0) as avgDurationMs
        FROM sessions s
        WHERE s.started_at >= ${from}
          AND s.started_at <= ${to}
          AND s.tenant_id = ${tenantId}
        GROUP BY s.agent_id
        ORDER BY sessionCount DESC
      `,
    );

    return c.json({
      agents: rows.map((r) => ({
        agentId: r.agentId,
        sessionCount: Number(r.sessionCount),
        totalEvents: Number(r.totalEvents),
        totalErrors: Number(r.totalErrors),
        errorRate:
          Number(r.totalEvents) > 0
            ? Number(r.totalErrors) / Number(r.totalEvents)
            : 0,
        totalCostUsd: Number(r.totalCostUsd),
        avgDurationMs: Number(r.avgDurationMs),
      })),
    });
  });

  // GET /api/analytics/llm — LLM call analytics
  app.get('/llm', async (c) => {
    const tenantId = c.get('apiKey')?.tenantId ?? 'default';
    const from = c.req.query('from') ?? new Date(Date.now() - 86400_000).toISOString();
    const to = c.req.query('to') ?? new Date().toISOString();
    const granularity = (c.req.query('granularity') ?? 'hour') as 'hour' | 'day' | 'week';
    const agentId = c.req.query('agentId');
    const model = c.req.query('model');
    const provider = c.req.query('provider');

    if (!['hour', 'day', 'week'].includes(granularity)) {
      return c.json({ error: 'Invalid granularity. Use: hour, day, week', status: 400 }, 400);
    }

    const formatStr =
      granularity === 'hour'
        ? '%Y-%m-%dT%H:00:00Z'
        : granularity === 'day'
          ? '%Y-%m-%dT00:00:00Z'
          : '%Y-%W';

    // Summary totals
    const summary = db.get<{
      totalCalls: number;
      totalCostUsd: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      avgLatencyMs: number;
    }>(
      sql`
        SELECT
          COUNT(*) as totalCalls,
          COALESCE(SUM(json_extract(payload, '$.costUsd')), 0) as totalCostUsd,
          COALESCE(SUM(json_extract(payload, '$.usage.inputTokens')), 0) as totalInputTokens,
          COALESCE(SUM(json_extract(payload, '$.usage.outputTokens')), 0) as totalOutputTokens,
          COALESCE(AVG(json_extract(payload, '$.latencyMs')), 0) as avgLatencyMs
        FROM events
        WHERE event_type = 'llm_response'
          AND timestamp >= ${from}
          AND timestamp <= ${to}
          AND tenant_id = ${tenantId}
          ${agentId ? sql`AND agent_id = ${agentId}` : sql``}
          ${model ? sql`AND json_extract(payload, '$.model') = ${model}` : sql``}
          ${provider ? sql`AND json_extract(payload, '$.provider') = ${provider}` : sql``}
      `,
    );

    const totalCalls = Number(summary?.totalCalls ?? 0);
    const totalCostUsd = Number(summary?.totalCostUsd ?? 0);

    // By model breakdown
    const byModel = db.all<{
      provider: string;
      model: string;
      calls: number;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      avgLatencyMs: number;
    }>(
      sql`
        SELECT
          json_extract(payload, '$.provider') as provider,
          json_extract(payload, '$.model') as model,
          COUNT(*) as calls,
          COALESCE(SUM(json_extract(payload, '$.costUsd')), 0) as costUsd,
          COALESCE(SUM(json_extract(payload, '$.usage.inputTokens')), 0) as inputTokens,
          COALESCE(SUM(json_extract(payload, '$.usage.outputTokens')), 0) as outputTokens,
          COALESCE(AVG(json_extract(payload, '$.latencyMs')), 0) as avgLatencyMs
        FROM events
        WHERE event_type = 'llm_response'
          AND timestamp >= ${from}
          AND timestamp <= ${to}
          AND tenant_id = ${tenantId}
          ${agentId ? sql`AND agent_id = ${agentId}` : sql``}
          ${model ? sql`AND json_extract(payload, '$.model') = ${model}` : sql``}
          ${provider ? sql`AND json_extract(payload, '$.provider') = ${provider}` : sql``}
        GROUP BY provider, model
        ORDER BY costUsd DESC
      `,
    );

    // By time bucket
    const byTime = db.all<{
      bucket: string;
      calls: number;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      avgLatencyMs: number;
    }>(
      sql`
        SELECT
          strftime(${formatStr}, timestamp) as bucket,
          COUNT(*) as calls,
          COALESCE(SUM(json_extract(payload, '$.costUsd')), 0) as costUsd,
          COALESCE(SUM(json_extract(payload, '$.usage.inputTokens')), 0) as inputTokens,
          COALESCE(SUM(json_extract(payload, '$.usage.outputTokens')), 0) as outputTokens,
          COALESCE(AVG(json_extract(payload, '$.latencyMs')), 0) as avgLatencyMs
        FROM events
        WHERE event_type = 'llm_response'
          AND timestamp >= ${from}
          AND timestamp <= ${to}
          AND tenant_id = ${tenantId}
          ${agentId ? sql`AND agent_id = ${agentId}` : sql``}
          ${model ? sql`AND json_extract(payload, '$.model') = ${model}` : sql``}
          ${provider ? sql`AND json_extract(payload, '$.provider') = ${provider}` : sql``}
        GROUP BY bucket
        ORDER BY bucket ASC
      `,
    );

    return c.json({
      summary: {
        totalCalls,
        totalCostUsd,
        totalInputTokens: Number(summary?.totalInputTokens ?? 0),
        totalOutputTokens: Number(summary?.totalOutputTokens ?? 0),
        avgLatencyMs: Number(summary?.avgLatencyMs ?? 0),
        avgCostPerCall: totalCalls > 0 ? totalCostUsd / totalCalls : 0,
      },
      byModel: byModel.map((r) => ({
        provider: r.provider,
        model: r.model,
        calls: Number(r.calls),
        costUsd: Number(r.costUsd),
        inputTokens: Number(r.inputTokens),
        outputTokens: Number(r.outputTokens),
        avgLatencyMs: Number(r.avgLatencyMs),
      })),
      byTime: byTime.map((r) => ({
        bucket: r.bucket,
        calls: Number(r.calls),
        costUsd: Number(r.costUsd),
        inputTokens: Number(r.inputTokens),
        outputTokens: Number(r.outputTokens),
        avgLatencyMs: Number(r.avgLatencyMs),
      })),
    });
  });

  // GET /api/analytics/tools — tool usage statistics
  app.get('/tools', async (c) => {
    const tenantId = c.get('apiKey')?.tenantId ?? 'default';
    const from = c.req.query('from') ?? new Date(Date.now() - 86400_000).toISOString();
    const to = c.req.query('to') ?? new Date().toISOString();

    const rows = db.all<{
      toolName: string;
      callCount: number;
      errorCount: number;
      avgDurationMs: number;
    }>(
      sql`
        SELECT
          json_extract(payload, '$.toolName') as toolName,
          COUNT(*) as callCount,
          SUM(CASE WHEN event_type = 'tool_error' THEN 1 ELSE 0 END) as errorCount,
          COALESCE(AVG(
            CASE WHEN event_type IN ('tool_response', 'tool_error')
            THEN json_extract(payload, '$.durationMs')
            ELSE NULL END
          ), 0) as avgDurationMs
        FROM events
        WHERE event_type IN ('tool_call', 'tool_response', 'tool_error')
          AND timestamp >= ${from}
          AND timestamp <= ${to}
          AND tenant_id = ${tenantId}
          AND json_extract(payload, '$.toolName') IS NOT NULL
        GROUP BY toolName
        ORDER by callCount DESC
      `,
    );

    return c.json({
      tools: rows.map((r) => ({
        toolName: r.toolName,
        callCount: Number(r.callCount),
        errorCount: Number(r.errorCount),
        errorRate:
          Number(r.callCount) > 0
            ? Number(r.errorCount) / Number(r.callCount)
            : 0,
        avgDurationMs: Number(r.avgDurationMs),
      })),
    });
  });

  return app;
}
