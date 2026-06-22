/**
 * Internal service-to-service endpoints (#13).
 *
 * POST /api/internal/spend — aggregate per-agent LLM spend over a window, for
 * AgentGate's per-agent budget enforcement. Authenticated by the shared
 * AGENTGATE_SERVICE_TOKEN bearer (NOT a user API key / JWT), so it is on the
 * self-auth allowlist (see public-paths.ts) and verifies the token itself.
 *
 * Tenant is taken from the request body (the service token is org-scoped), not
 * from a user auth context — AgentGate holds no end-user credential.
 */

import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { IEventStore } from '@agentlensai/core';
import type { SqliteDb } from '../db/index.js';
import type { PostgresDb } from '../db/connection.postgres.js';
import { getConfig } from '../config.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('InternalSpend');

/** Numeric JSON field extraction, dialect-aware (mirrors analytics.ts). */
function jn(isPg: boolean, field: string): SQL {
  if (!isPg) return sql.raw(`json_extract(payload, '$.${field}')`);
  return sql.raw(`(payload->>'${field}')::numeric`);
}

async function dbAll<T>(db: SqliteDb | null, pgDb: PostgresDb | null, query: SQL): Promise<T[]> {
  if (pgDb) return (await pgDb.execute(query)) as unknown as T[];
  return db!.all<T>(query);
}

/** Constant-time bearer-token check against AGENTGATE_SERVICE_TOKEN. */
function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function internalRoutes(_store: IEventStore, db: SqliteDb, pgDb?: PostgresDb) {
  const app = new Hono();
  const isPg = !!pgDb;
  const qdb = pgDb ?? null;

  // ── Service-token auth (applies to every /api/internal route) ──
  app.use('*', async (c, next) => {
    const expected = getConfig().agentgateServiceToken;
    if (!expected) {
      return c.json({ error: 'Internal endpoints disabled (AGENTGATE_SERVICE_TOKEN unset)' }, 503);
    }
    const authHeader = c.req.header('Authorization');
    const presented = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!presented || !tokenMatches(presented, expected)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return next();
  });

  // POST /api/internal/spend — per-agent spend over [from, to] for a tenant.
  app.post('/spend', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      agentIds?: unknown;
      tenantId?: unknown;
      from?: unknown;
      to?: unknown;
    } | null;

    const agentIds = body?.agentIds;
    const tenantId = body?.tenantId;
    if (!Array.isArray(agentIds) || agentIds.length === 0 || !agentIds.every((a) => typeof a === 'string')) {
      return c.json({ error: 'agentIds must be a non-empty array of strings' }, 400);
    }
    if (typeof tenantId !== 'string' || !tenantId) {
      return c.json({ error: 'tenantId is required' }, 400);
    }
    // Cap fan-out to keep the IN-list bounded.
    if (agentIds.length > 1000) {
      return c.json({ error: 'agentIds may not exceed 1000 entries' }, 400);
    }
    const from = typeof body?.from === 'string' ? body.from : new Date(Date.now() - 30 * 86_400_000).toISOString();
    const to = typeof body?.to === 'string' ? body.to : new Date().toISOString();

    const idList = sql.join((agentIds as string[]).map((id) => sql`${id}`), sql`, `);

    const rows = await dbAll<{ agentId: string; totalCostUsd: number; lastEventAt: string }>(
      isPg ? null : db,
      qdb,
      sql`
        SELECT
          agent_id as ${sql.raw(isPg ? '"agentId"' : 'agentId')},
          COALESCE(SUM(${jn(isPg, 'costUsd')}), 0) as ${sql.raw(isPg ? '"totalCostUsd"' : 'totalCostUsd')},
          MAX(timestamp) as ${sql.raw(isPg ? '"lastEventAt"' : 'lastEventAt')}
        FROM events
        WHERE event_type IN ('cost_tracked', 'llm_response')
          AND tenant_id = ${tenantId}
          AND agent_id IN (${idList})
          AND timestamp >= ${from}
          AND timestamp <= ${to}
        GROUP BY agent_id
      `,
    );

    // Agents with no spend in the window simply don't appear — the caller
    // treats a missing agent as $0.
    log.debug(`spend read: ${rows.length}/${agentIds.length} agents have spend (tenant ${tenantId})`);
    return c.json({
      tenantId,
      from,
      to,
      spend: rows.map((r) => ({
        agentId: r.agentId,
        totalCostUsd: Number(r.totalCostUsd) || 0,
        lastEventAt: r.lastEventAt ?? null,
      })),
    });
  });

  return app;
}
