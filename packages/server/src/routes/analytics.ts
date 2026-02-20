/**
 * Analytics Endpoints (Story 11.2)
 *
 * GET /api/analytics         — bucketed metrics over time
 * GET /api/analytics/costs   — cost breakdown by agent and time period
 * GET /api/analytics/agents  — per-agent metrics (session count, error rate, avg duration, total cost)
 * GET /api/analytics/tools   — tool usage statistics (frequency, avg duration, error rate per tool)
 */

import { Hono } from 'hono';
import { getTenantId } from './tenant-helper.js';
import { sql, type SQL } from 'drizzle-orm';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import type { SqliteDb } from '../db/index.js';
import type { PostgresDb } from '../db/connection.postgres.js';
import { getTenantStore } from './tenant-helper.js';

// ─── SQL dialect helpers ─────────────────────────────────
// These return sql.raw() fragments for structural SQL differences.
// User values are always passed via parameterized ${value} in the tagged template.

/** JSON field extraction (returns text) */
function jf(isPg: boolean, field: string): SQL {
  const path = field.replace(/^\$\./, '');
  if (!isPg) return sql.raw(`json_extract(payload, '$.${path}')`);
  const parts = path.split('.');
  if (parts.length === 1) return sql.raw(`(payload->>'${parts[0]}')`);
  const inner = parts.slice(0, -1).map(p => `'${p}'`).join('->');
  return sql.raw(`(payload->${inner}->>'${parts[parts.length - 1]}')`);
}

/** JSON field extraction with numeric cast */
function jn(isPg: boolean, field: string): SQL {
  const path = field.replace(/^\$\./, '');
  if (!isPg) return sql.raw(`json_extract(payload, '$.${path}')`);
  const parts = path.split('.');
  if (parts.length === 1) return sql.raw(`(payload->>'${parts[0]}')::numeric`);
  const inner = parts.slice(0, -1).map(p => `'${p}'`).join('->');
  return sql.raw(`(payload->${inner}->>'${parts[parts.length - 1]}')::numeric`);
}

/** Time bucket expression */
function tb(isPg: boolean, fmt: string): SQL {
  if (!isPg) return sql.raw(`strftime('${fmt}', timestamp)`);
  const pgFmt = fmt
    .replace('%Y', 'YYYY').replace('%m', 'MM').replace('%d', 'DD')
    .replace('%H', 'HH24').replace('%W', 'IW');
  return sql.raw(`to_char(timestamp::timestamptz, '${pgFmt}')`);
}

/** Duration calc for sessions */
function durExpr(isPg: boolean): SQL {
  if (!isPg) return sql.raw(`(julianday(s.ended_at) - julianday(s.started_at)) * 86400000`);
  return sql.raw(`EXTRACT(EPOCH FROM (s.ended_at::timestamptz - s.started_at::timestamptz)) * 1000`);
}

// ─── Async query helpers ─────────────────────────────────

async function dbGet<T>(db: SqliteDb | null, pgDb: PostgresDb | null, query: SQL): Promise<T | undefined> {
  if (pgDb) {
    const result = await pgDb.execute(query);
    return (result as unknown as T[])[0];
  }
  return db!.get<T>(query);
}

async function dbAll<T>(db: SqliteDb | null, pgDb: PostgresDb | null, query: SQL): Promise<T[]> {
  if (pgDb) {
    const result = await pgDb.execute(query);
    return result as unknown as T[];
  }
  return db!.all<T>(query);
}

export function analyticsRoutes(store: IEventStore, db: SqliteDb, pgDb?: PostgresDb) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const isPg = !!pgDb;
  const qdb = pgDb ?? null;

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
    const tenantId = getTenantId(c);
    const from = c.req.query('from') ?? new Date(Date.now() - 86400_000).toISOString();
    const to = c.req.query('to') ?? new Date().toISOString();
    const granularity = (c.req.query('granularity') ?? 'day') as 'hour' | 'day' | 'week';

    const formatStr =
      granularity === 'hour'
        ? '%Y-%m-%dT%H:00:00Z'
        : granularity === 'day'
          ? '%Y-%m-%dT00:00:00Z'
          : '%Y-%W';

    const bucket = tb(isPg, formatStr);

    // Cost by agent
    const byAgent = await dbAll<{
      agentId: string;
      totalCostUsd: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalTokens: number;
      eventCount: number;
    }>(db, qdb,
      sql`
        SELECT
          agent_id as ${sql.raw(isPg ? '"agentId"' : 'agentId')},
          COALESCE(SUM(${jn(isPg, 'costUsd')}), 0) as ${sql.raw(isPg ? '"totalCostUsd"' : 'totalCostUsd')},
          COALESCE(SUM(COALESCE(${jn(isPg, 'inputTokens')}, ${jn(isPg, 'usage.inputTokens')})), 0) as ${sql.raw(isPg ? '"totalInputTokens"' : 'totalInputTokens')},
          COALESCE(SUM(COALESCE(${jn(isPg, 'outputTokens')}, ${jn(isPg, 'usage.outputTokens')})), 0) as ${sql.raw(isPg ? '"totalOutputTokens"' : 'totalOutputTokens')},
          COALESCE(SUM(COALESCE(${jn(isPg, 'totalTokens')}, ${jn(isPg, 'usage.totalTokens')})), 0) as ${sql.raw(isPg ? '"totalTokens"' : 'totalTokens')},
          COUNT(*) as ${sql.raw(isPg ? '"eventCount"' : 'eventCount')}
        FROM events
        WHERE event_type IN ('cost_tracked', 'llm_response')
          AND timestamp >= ${from}
          AND timestamp <= ${to}
          AND tenant_id = ${tenantId}
        GROUP BY agent_id
        ORDER BY ${sql.raw(isPg ? '"totalCostUsd"' : 'totalCostUsd')} DESC
      `,
    );

    // Cost over time — broken down by agent for stacked chart
    const overTimeByAgent = await dbAll<{
      bucket: string;
      agentId: string;
      totalCostUsd: number;
      eventCount: number;
    }>(db, qdb,
      sql`
        SELECT
          ${bucket} as bucket,
          agent_id as ${sql.raw(isPg ? '"agentId"' : 'agentId')},
          COALESCE(SUM(${jn(isPg, 'costUsd')}), 0) as ${sql.raw(isPg ? '"totalCostUsd"' : 'totalCostUsd')},
          COUNT(*) as ${sql.raw(isPg ? '"eventCount"' : 'eventCount')}
        FROM events
        WHERE event_type IN ('cost_tracked', 'llm_response')
          AND timestamp >= ${from}
          AND timestamp <= ${to}
          AND tenant_id = ${tenantId}
        GROUP BY bucket, agent_id
        ORDER BY bucket ASC
      `,
    );

    // Pivot: group by bucket
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
    const total = await dbGet<{
      totalCostUsd: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalTokens: number;
    }>(db, qdb,
      sql`
        SELECT
          COALESCE(SUM(${jn(isPg, 'costUsd')}), 0) as ${sql.raw(isPg ? '"totalCostUsd"' : 'totalCostUsd')},
          COALESCE(SUM(COALESCE(${jn(isPg, 'inputTokens')}, ${jn(isPg, 'usage.inputTokens')})), 0) as ${sql.raw(isPg ? '"totalInputTokens"' : 'totalInputTokens')},
          COALESCE(SUM(COALESCE(${jn(isPg, 'outputTokens')}, ${jn(isPg, 'usage.outputTokens')})), 0) as ${sql.raw(isPg ? '"totalOutputTokens"' : 'totalOutputTokens')},
          COALESCE(SUM(COALESCE(${jn(isPg, 'totalTokens')}, ${jn(isPg, 'usage.totalTokens')})), 0) as ${sql.raw(isPg ? '"totalTokens"' : 'totalTokens')}
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
    const tenantId = getTenantId(c);
    const from = c.req.query('from') ?? new Date(Date.now() - 86400_000).toISOString();
    const to = c.req.query('to') ?? new Date().toISOString();

    const rows = await dbAll<{
      agentId: string;
      sessionCount: number;
      totalEvents: number;
      totalErrors: number;
      totalCostUsd: number;
      avgDurationMs: number;
    }>(db, qdb,
      sql`
        SELECT
          s.agent_id as ${sql.raw(isPg ? '"agentId"' : 'agentId')},
          COUNT(DISTINCT s.id) as ${sql.raw(isPg ? '"sessionCount"' : 'sessionCount')},
          COALESCE(SUM(s.event_count), 0) as ${sql.raw(isPg ? '"totalEvents"' : 'totalEvents')},
          COALESCE(SUM(s.error_count), 0) as ${sql.raw(isPg ? '"totalErrors"' : 'totalErrors')},
          COALESCE(SUM(s.total_cost_usd), 0) as ${sql.raw(isPg ? '"totalCostUsd"' : 'totalCostUsd')},
          COALESCE(AVG(
            CASE
              WHEN s.ended_at IS NOT NULL
              THEN ${durExpr(isPg)}
              ELSE NULL
            END
          ), 0) as ${sql.raw(isPg ? '"avgDurationMs"' : 'avgDurationMs')}
        FROM sessions s
        WHERE s.started_at >= ${from}
          AND s.started_at <= ${to}
          AND s.tenant_id = ${tenantId}
        GROUP BY s.agent_id
        ORDER BY ${sql.raw(isPg ? '"sessionCount"' : 'sessionCount')} DESC
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
    const tenantId = getTenantId(c);
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

    const bucket = tb(isPg, formatStr);
    const agentFilter = agentId ? sql`AND agent_id = ${agentId}` : sql``;
    const modelFilter = model ? sql`AND ${jf(isPg, 'model')} = ${model}` : sql``;
    const providerFilter = provider ? sql`AND ${jf(isPg, 'provider')} = ${provider}` : sql``;

    // Summary totals
    const summary = await dbGet<{
      totalCalls: number;
      totalCostUsd: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      avgLatencyMs: number;
    }>(db, qdb,
      sql`
        SELECT
          COUNT(*) as ${sql.raw(isPg ? '"totalCalls"' : 'totalCalls')},
          COALESCE(SUM(${jn(isPg, 'costUsd')}), 0) as ${sql.raw(isPg ? '"totalCostUsd"' : 'totalCostUsd')},
          COALESCE(SUM(${jn(isPg, 'usage.inputTokens')}), 0) as ${sql.raw(isPg ? '"totalInputTokens"' : 'totalInputTokens')},
          COALESCE(SUM(${jn(isPg, 'usage.outputTokens')}), 0) as ${sql.raw(isPg ? '"totalOutputTokens"' : 'totalOutputTokens')},
          COALESCE(AVG(${jn(isPg, 'latencyMs')}), 0) as ${sql.raw(isPg ? '"avgLatencyMs"' : 'avgLatencyMs')}
        FROM events
        WHERE event_type = 'llm_response'
          AND timestamp >= ${from}
          AND timestamp <= ${to}
          AND tenant_id = ${tenantId}
          ${agentFilter}
          ${modelFilter}
          ${providerFilter}
      `,
    );

    const totalCalls = Number(summary?.totalCalls ?? 0);
    const totalCostUsd = Number(summary?.totalCostUsd ?? 0);

    // By model breakdown
    const byModel = await dbAll<{
      provider: string;
      model: string;
      calls: number;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      avgLatencyMs: number;
    }>(db, qdb,
      sql`
        SELECT
          ${jf(isPg, 'provider')} as provider,
          ${jf(isPg, 'model')} as model,
          COUNT(*) as calls,
          COALESCE(SUM(${jn(isPg, 'costUsd')}), 0) as ${sql.raw(isPg ? '"costUsd"' : 'costUsd')},
          COALESCE(SUM(${jn(isPg, 'usage.inputTokens')}), 0) as ${sql.raw(isPg ? '"inputTokens"' : 'inputTokens')},
          COALESCE(SUM(${jn(isPg, 'usage.outputTokens')}), 0) as ${sql.raw(isPg ? '"outputTokens"' : 'outputTokens')},
          COALESCE(AVG(${jn(isPg, 'latencyMs')}), 0) as ${sql.raw(isPg ? '"avgLatencyMs"' : 'avgLatencyMs')}
        FROM events
        WHERE event_type = 'llm_response'
          AND timestamp >= ${from}
          AND timestamp <= ${to}
          AND tenant_id = ${tenantId}
          ${agentFilter}
          ${modelFilter}
          ${providerFilter}
        GROUP BY provider, model
        ORDER BY ${sql.raw(isPg ? '"costUsd"' : 'costUsd')} DESC
      `,
    );

    // By time bucket
    const byTime = await dbAll<{
      bucket: string;
      calls: number;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      avgLatencyMs: number;
    }>(db, qdb,
      sql`
        SELECT
          ${bucket} as bucket,
          COUNT(*) as calls,
          COALESCE(SUM(${jn(isPg, 'costUsd')}), 0) as ${sql.raw(isPg ? '"costUsd"' : 'costUsd')},
          COALESCE(SUM(${jn(isPg, 'usage.inputTokens')}), 0) as ${sql.raw(isPg ? '"inputTokens"' : 'inputTokens')},
          COALESCE(SUM(${jn(isPg, 'usage.outputTokens')}), 0) as ${sql.raw(isPg ? '"outputTokens"' : 'outputTokens')},
          COALESCE(AVG(${jn(isPg, 'latencyMs')}), 0) as ${sql.raw(isPg ? '"avgLatencyMs"' : 'avgLatencyMs')}
        FROM events
        WHERE event_type = 'llm_response'
          AND timestamp >= ${from}
          AND timestamp <= ${to}
          AND tenant_id = ${tenantId}
          ${agentFilter}
          ${modelFilter}
          ${providerFilter}
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
    const tenantId = getTenantId(c);
    const from = c.req.query('from') ?? new Date(Date.now() - 86400_000).toISOString();
    const to = c.req.query('to') ?? new Date().toISOString();

    const rows = await dbAll<{
      toolName: string;
      callCount: number;
      errorCount: number;
      avgDurationMs: number;
    }>(db, qdb,
      sql`
        SELECT
          ${jf(isPg, 'toolName')} as ${sql.raw(isPg ? '"toolName"' : 'toolName')},
          COUNT(*) as ${sql.raw(isPg ? '"callCount"' : 'callCount')},
          SUM(CASE WHEN event_type = 'tool_error' THEN 1 ELSE 0 END) as ${sql.raw(isPg ? '"errorCount"' : 'errorCount')},
          COALESCE(AVG(
            CASE WHEN event_type IN ('tool_response', 'tool_error')
            THEN ${jn(isPg, 'durationMs')}
            ELSE NULL END
          ), 0) as ${sql.raw(isPg ? '"avgDurationMs"' : 'avgDurationMs')}
        FROM events
        WHERE event_type IN ('tool_call', 'tool_response', 'tool_error')
          AND timestamp >= ${from}
          AND timestamp <= ${to}
          AND tenant_id = ${tenantId}
          AND ${jf(isPg, 'toolName')} IS NOT NULL
        GROUP BY ${sql.raw(isPg ? '"toolName"' : 'toolName')}
        ORDER by ${sql.raw(isPg ? '"callCount"' : 'callCount')} DESC
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
