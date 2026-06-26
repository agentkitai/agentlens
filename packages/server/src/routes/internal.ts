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
import { timingSafeEqual, createHmac } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { guardrailBreachRequestSchema, evalRunRequestSchema, pricingVersion } from '@agentlensai/core';
import { reconcile, type ReconcileEventRow } from '../lib/reconcile.js';
import type { EvalResultPayload, IEventStore } from '@agentlensai/core';
import type { SqliteDb } from '../db/index.js';
import type { PostgresDb } from '../db/connection.postgres.js';
import { getConfig } from '../config.js';
import { createLogger } from '../lib/logger.js';
import { tenantScopedStore } from './tenant-helper.js';
import { appendEventToSession } from '../lib/append-event.js';
import { buildBreachEvalResult, buildAgentEvalResult } from '../lib/eval/index.js';
import { HashChainError } from '../db/errors.js';

const log = createLogger('Internal');

/** Numeric JSON field extraction, dialect-aware (mirrors analytics.ts). */
function jn(isPg: boolean, field: string): SQL {
  if (!isPg) return sql.raw(`json_extract(payload, '$.${field}')`);
  return sql.raw(`(payload->>'${field}')::numeric`);
}

async function dbAll<T>(db: SqliteDb | null, pgDb: PostgresDb | null, query: SQL): Promise<T[]> {
  if (pgDb) return (await pgDb.execute(query)) as unknown as T[];
  return db!.all<T>(query);
}

/** Parse a JSON payload string (sqlite); returns {} on garbage. */
function safeParse(s: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Constant-time bearer-token check against AGENTGATE_SERVICE_TOKEN. */
function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function internalRoutes(store: IEventStore, db: SqliteDb, pgDb?: PostgresDb) {
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

    // Billing-grade mode (#87, default OFF): attribute by the server-verified
    // agent id (a self-reported / spoofed agent_id can't claim another agent's
    // spend). Guardrail mode groups by the self-reported agent_id, unchanged.
    const billing = getConfig().billingGradeSpend;
    const idCol = sql.raw(billing ? 'verified_agent_id' : 'agent_id');

    const rows = await dbAll<{ agentId: string; totalCostUsd: number; lastEventAt: string }>(
      isPg ? null : db,
      qdb,
      sql`
        SELECT
          ${idCol} as ${sql.raw(isPg ? '"agentId"' : 'agentId')},
          COALESCE(SUM(${jn(isPg, 'costUsd')}), 0) as ${sql.raw(isPg ? '"totalCostUsd"' : 'totalCostUsd')},
          MAX(timestamp) as ${sql.raw(isPg ? '"lastEventAt"' : 'lastEventAt')}
        FROM events
        WHERE event_type IN ('cost_tracked', 'llm_response')
          AND tenant_id = ${tenantId}
          AND ${idCol} IN (${idList})
          AND timestamp >= ${from}
          AND timestamp <= ${to}
        GROUP BY ${idCol}
      `,
    );

    // Agents with no spend in the window simply don't appear — the caller
    // treats a missing agent as $0.
    log.debug(`spend read (${billing ? 'billing' : 'guardrail'}): ${rows.length}/${agentIds.length} agents have spend (tenant ${tenantId})`);
    const response: Record<string, unknown> = {
      tenantId,
      from,
      to,
      spend: rows.map((r) => ({
        agentId: r.agentId,
        totalCostUsd: Number(r.totalCostUsd) || 0,
        lastEventAt: r.lastEventAt ?? null,
      })),
    };

    // In billing mode, surface (but do not trust) cost that carries no verified
    // id — spoofed/unverified spend that must not be billed to any agent.
    // Guardrail mode keeps its response byte-for-byte unchanged.
    if (billing) {
      const [un] = await dbAll<{ totalCostUsd: number; eventCount: number; lastEventAt: string | null }>(
        isPg ? null : db,
        qdb,
        sql`
          SELECT
            COALESCE(SUM(${jn(isPg, 'costUsd')}), 0) as ${sql.raw(isPg ? '"totalCostUsd"' : 'totalCostUsd')},
            COUNT(*) as ${sql.raw(isPg ? '"eventCount"' : 'eventCount')},
            MAX(timestamp) as ${sql.raw(isPg ? '"lastEventAt"' : 'lastEventAt')}
          FROM events
          WHERE event_type IN ('cost_tracked', 'llm_response')
            AND tenant_id = ${tenantId}
            AND verified_agent_id IS NULL
            AND timestamp >= ${from}
            AND timestamp <= ${to}
        `,
      );
      response['mode'] = 'billing';
      response['unattributed'] = {
        totalCostUsd: Number(un?.totalCostUsd) || 0,
        eventCount: Number(un?.eventCount) || 0,
        lastEventAt: un?.lastEventAt ?? null,
      };
    }

    return c.json(response);
  });

  // POST /api/internal/reconcile — per-agent stored-vs-recompute pricing drift
  // over [from, to] for a tenant (#89). Recompute is at CURRENT pricing; events
  // priced under stale rates surface as drift + a staleVersionCount. Reuses the
  // /spend billing-aware grouping and the audit-export HMAC signing. The [from,
  // to] window IS the reconciliation period (the caller picks a billing period).
  app.post('/reconcile', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      tenantId?: unknown; from?: unknown; to?: unknown; agentIds?: unknown; threshold?: unknown;
    } | null;

    const tenantId = body?.tenantId;
    if (typeof tenantId !== 'string' || !tenantId) {
      return c.json({ error: 'tenantId is required' }, 400);
    }
    const agentIds = body?.agentIds;
    if (agentIds !== undefined && (!Array.isArray(agentIds) || !agentIds.every((a) => typeof a === 'string'))) {
      return c.json({ error: 'agentIds must be an array of strings' }, 400);
    }
    if (Array.isArray(agentIds) && agentIds.length > 1000) {
      return c.json({ error: 'agentIds may not exceed 1000 entries' }, 400);
    }
    const from = typeof body?.from === 'string' ? body.from : new Date(Date.now() - 30 * 86_400_000).toISOString();
    const to = typeof body?.to === 'string' ? body.to : new Date().toISOString();
    const cfg = getConfig();
    const threshold = typeof body?.threshold === 'number' && Number.isFinite(body.threshold) && body.threshold >= 0
      ? body.threshold : cfg.reconcileDriftThreshold;

    // Same billing-aware attribution as /spend: by verified id in billing mode.
    const billing = cfg.billingGradeSpend;
    const idCol = sql.raw(billing ? 'verified_agent_id' : 'agent_id');
    const agentFilter = Array.isArray(agentIds) && agentIds.length > 0
      ? sql` AND ${idCol} IN (${sql.join((agentIds as string[]).map((id) => sql`${id}`), sql`, `)})`
      : sql``;

    // Bound the per-event scan; reconciliation is per-row (not a SQL aggregate).
    const MAX_ROWS = 100_000;
    const rawRows = await dbAll<{ agentId: string | null; payload: unknown; pricingVersion: string | null }>(
      isPg ? null : db, qdb,
      sql`
        SELECT
          ${idCol} as ${sql.raw(isPg ? '"agentId"' : 'agentId')},
          payload,
          pricing_version as ${sql.raw(isPg ? '"pricingVersion"' : 'pricingVersion')}
        FROM events
        WHERE event_type IN ('cost_tracked', 'llm_response')
          AND tenant_id = ${tenantId}
          AND timestamp >= ${from}
          AND timestamp <= ${to}${agentFilter}
        ORDER BY timestamp
        LIMIT ${MAX_ROWS}
      `,
    );
    const truncated = rawRows.length >= MAX_ROWS;
    if (truncated) {
      log.warn(`reconcile truncated at ${MAX_ROWS} events (tenant ${tenantId}, ${from}..${to})`);
    }

    const rows: ReconcileEventRow[] = rawRows.map((r) => ({
      agentId: r.agentId ?? 'unattributed',
      payload: typeof r.payload === 'string' ? safeParse(r.payload) : ((r.payload as Record<string, unknown>) ?? {}),
      pricingVersion: r.pricingVersion ?? null,
    }));

    const report = reconcile(rows, { threshold, currentPricingVersion: pricingVersion() });
    log.debug(`reconcile (${billing ? 'billing' : 'guardrail'}): ${rows.length} events, ${report.totals.agentsAlerting} agents alerting (tenant ${tenantId})`);

    const reportBody = { tenantId, from, to, mode: billing ? 'billing' : 'guardrail', truncated, ...report };
    // Sign the report like the audit export when a signing key is configured.
    const signature = cfg.auditSigningKey
      ? 'hmac-sha256:' + createHmac('sha256', cfg.auditSigningKey).update(JSON.stringify(reportBody)).digest('hex')
      : null;

    return c.json({ ...reportBody, signature });
  });

  // POST /api/internal/eval/guardrail-breach — record an AgentGate guardrail
  // breach as a hash-chained compliance eval_result in the session's audit trail
  // (#55 — the gate→lens wedge). The gate calls this fire-and-forget (fail-open),
  // passing the session it observed the breach in. eval_result stays
  // server-authoritative; this is reached only with the service token.
  app.post('/eval/guardrail-breach', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = guardrailBreachRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
      }, 400);
    }
    const { tenantId, sessionId, agentId, breach } = parsed.data;

    const tenantStore = tenantScopedStore(store, tenantId);
    // Append even to an empty/unseen session: the gate is trusted and a breach
    // must never go unrecorded. An empty timeline starts a fresh chain (genesis).
    const timeline = await tenantStore.getSessionTimeline(sessionId);
    const payload: EvalResultPayload = buildBreachEvalResult(timeline, breach);

    let event;
    try {
      event = await appendEventToSession(tenantStore, {
        tenantId,
        sessionId,
        agentId,
        eventType: 'eval_result',
        severity: 'warn',
        payload,
        metadata: { source: 'guardrail_breach', gateSource: breach.source, ruleId: breach.ruleId },
      });
    } catch (err) {
      // Only a chain-continuity race is retryable (409). Surface a generic
      // message — the detail (event ids / hashes) goes to logs, not the caller.
      if (err instanceof HashChainError) {
        log.warn(`guardrail breach append raced on session ${sessionId}: ${err.message}`);
        return c.json({ error: 'Failed to record eval result (chain conflict); retry.' }, 409);
      }
      log.error(`guardrail breach append failed for session ${sessionId}: ${(err as Error).message}`);
      return c.json({ error: 'Failed to record eval result.' }, 500);
    }

    log.debug(`guardrail breach recorded for session ${sessionId} (tenant ${tenantId}, source ${breach.source})`);
    return c.json({
      sessionId,
      recorded: true,
      score: payload.score,
      passed: payload.passed,
      violations: payload.violations,
      rulesEvaluated: payload.rulesEvaluated,
      event: { id: event.id, hash: event.hash, prevHash: event.prevHash },
    }, 201);
  });

  // POST /api/internal/eval/run — record an external agenteval suite run as a
  // hash-chained, server-authoritative eval_result (#55 — the agenteval→lens
  // federation). agenteval holds no AgentLens session, so it passes a synthetic
  // per-run sessionId; an empty timeline starts a fresh chain (genesis). The run
  // already happened externally, so (unlike the guardrail-breach wedge) there's no
  // timeline to score — the emitter's summary IS the evidence. eval_result stays
  // server-authoritative; this is reached only with the service token.
  app.post('/eval/run', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = evalRunRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
      }, 400);
    }
    const { tenantId, sessionId, agentId, run } = parsed.data;
    const payload: EvalResultPayload = buildAgentEvalResult(run);

    const tenantStore = tenantScopedStore(store, tenantId);
    let event;
    try {
      event = await appendEventToSession(tenantStore, {
        tenantId,
        sessionId,
        agentId,
        eventType: 'eval_result',
        severity: payload.passed ? 'info' : 'warn',
        payload,
        metadata: {
          source: 'agenteval',
          suite: run.suite,
          runId: run.id,
          ...(run.createdAt ? { ranAt: run.createdAt } : {}),
        },
      });
    } catch (err) {
      if (err instanceof HashChainError) {
        log.warn(`agenteval run append raced on session ${sessionId}: ${err.message}`);
        return c.json({ error: 'Failed to record eval result (chain conflict); retry.' }, 409);
      }
      log.error(`agenteval run append failed for session ${sessionId}: ${(err as Error).message}`);
      return c.json({ error: 'Failed to record eval result.' }, 500);
    }

    log.debug(`agenteval run recorded for session ${sessionId} (tenant ${tenantId}, suite ${run.suite})`);
    return c.json({
      sessionId,
      recorded: true,
      score: payload.score,
      passed: payload.passed,
      violations: payload.violations,
      rulesEvaluated: payload.rulesEvaluated,
      event: { id: event.id, hash: event.hash, prevHash: event.prevHash },
    }, 201);
  });

  // GET /api/internal/agent-eval-status?agentId&tenantId — the latest COMPLETED
  // eval run's pass-rate for one agent, for AgentGate's per-agent eval gate (#7).
  // Fails to {found:false} (not 500) on any backend/query error so the gate can
  // fail OPEN rather than block on a degraded/absent eval store.
  app.get('/agent-eval-status', async (c) => {
    const agentId = c.req.query('agentId');
    const tenantId = c.req.query('tenantId');
    if (!agentId) return c.json({ error: 'agentId is required' }, 400);
    if (!tenantId) return c.json({ error: 'tenantId is required' }, 400);
    try {
      const rows = await dbAll<{ id: string; status: string; total_cases: number; passed_cases: number; created_at: string }>(
        db,
        qdb,
        sql`SELECT id, status, total_cases, passed_cases, created_at
            FROM eval_runs
            WHERE tenant_id = ${tenantId} AND agent_id = ${agentId} AND status = 'completed'
            ORDER BY created_at DESC
            LIMIT 1`,
      );
      if (rows.length === 0) return c.json({ agentId, found: false });
      const r = rows[0]!;
      const total = Number(r.total_cases) || 0;
      const passed = Number(r.passed_cases) || 0;
      return c.json({
        agentId,
        found: true,
        runId: r.id,
        status: r.status,
        totalCases: total,
        passedCases: passed,
        passRate: total > 0 ? passed / total : null,
        completedAt: r.created_at,
      });
    } catch (err) {
      log.warn(`agent-eval-status read failed for ${agentId} (tenant ${tenantId}); returning found:false`, err);
      return c.json({ agentId, found: false });
    }
  });

  return app;
}
