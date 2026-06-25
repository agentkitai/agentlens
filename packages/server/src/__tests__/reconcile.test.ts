/**
 * Spend reconciliation & pricing drift (Slice C, #89).
 *
 * `costUsd` is frozen at ingest-time pricing; the pricing table is refreshed in
 * place with no retroactive recompute. Reconciliation recomputes each event's
 * cost at CURRENT pricing and reports per-agent stored-vs-recomputed drift +
 * a threshold alert. Provenance (events.pricing_version) is stamped at ingest so
 * stale-priced events are identifiable.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { setModelCosts, getModelCosts, pricingVersion, costUsdDetailed, type ModelCostTable } from '@agentlensai/core';
import { reconcile, type ReconcileEventRow } from '../lib/reconcile.js';
import { createTestApp, authHeaders } from './test-helpers.js';
import type { Hono } from 'hono';
import type { SqliteDb } from '../db/index.js';

const WINDOW = { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' };

describe('reconcile() — pure drift aggregation', () => {
  let saved: ModelCostTable;
  beforeEach(() => { saved = { ...getModelCosts() }; });
  afterEach(() => { setModelCosts(saved); });

  const row = (agentId: string, model: string, inTok: number, outTok: number, costUsd: number, pv: string | null = null): ReconcileEventRow =>
    ({ agentId, pricingVersion: pv, payload: { model, usage: { inputTokens: inTok, outputTokens: outTok }, costUsd } });

  it('flags drift when pricing changed since the cost was stored', () => {
    setModelCosts({ m: { input: 1, output: 1 } });
    const storedAtP1 = costUsdDetailed('m', { inputTokens: 1_000_000, outputTokens: 0 }).costUsd; // 1.0
    const v1 = pricingVersion();
    setModelCosts({ m: { input: 2, output: 2 } }); // price doubles
    const v2 = pricingVersion();

    const rep = reconcile([row('agt_a', 'm', 1_000_000, 0, storedAtP1, v1)], { threshold: 0.01, currentPricingVersion: v2 });
    const a = rep.byAgent[0]!;
    expect(a.storedUsd).toBeCloseTo(1.0, 6);
    expect(a.recomputedUsd).toBeCloseTo(2.0, 6); // recompute at current (P2)
    expect(a.driftUsd).toBeCloseTo(1.0, 6);
    expect(a.driftPct).toBeCloseTo(1.0, 6);
    expect(a.alert).toBe(true);
    expect(a.staleVersionCount).toBe(1); // priced under v1, now v2
    expect(rep.totals.agentsAlerting).toBe(1);
  });

  it('does NOT flag drift when pricing is stable', () => {
    setModelCosts({ m: { input: 3, output: 6 } });
    const v = pricingVersion();
    const stored = costUsdDetailed('m', { inputTokens: 1000, outputTokens: 500 }).costUsd;

    const rep = reconcile([row('agt_a', 'm', 1000, 500, stored, v)], { threshold: 0.01, currentPricingVersion: v });
    const a = rep.byAgent[0]!;
    expect(a.driftUsd).toBeCloseTo(0, 9);
    expect(a.alert).toBe(false);
    expect(a.staleVersionCount).toBe(0);
    expect(rep.totals.agentsAlerting).toBe(0);
  });

  it('excludes unpriceable models from drift (no false −100% alert), surfaces them separately', () => {
    setModelCosts({ known: { input: 1, output: 1 } });
    const v = pricingVersion();
    const rep = reconcile(
      [
        row('agt_a', 'known', 1_000_000, 0, 1.0, v),                 // reconcilable, no drift
        row('agt_a', 'totally-unknown-model', 1_000_000, 0, 5.0, v), // can't reprice → must NOT alert
      ],
      { threshold: 0.01, currentPricingVersion: v },
    );
    const a = rep.byAgent[0]!;
    expect(a.eventCount).toBe(2);
    expect(a.storedUsd).toBeCloseTo(1.0, 6);        // priceable only
    expect(a.driftUsd).toBeCloseTo(0, 9);
    expect(a.alert).toBe(false);                    // the $5 unknown-model event does NOT fire a false alert
    expect(a.unpriceableCount).toBe(1);
    expect(a.unpriceableUsd).toBeCloseTo(5.0, 6);
    expect(rep.totals.unpriceableUsd).toBeCloseTo(5.0, 6);
  });

  it('groups per agent and keeps unattributed separate', () => {
    setModelCosts({ m: { input: 1, output: 1 } });
    const v = pricingVersion();
    const rep = reconcile(
      [row('agt_a', 'm', 1_000_000, 0, 1.0, v), row('unattributed', 'm', 1_000_000, 0, 1.0, v)],
      { threshold: 0.01, currentPricingVersion: v },
    );
    expect(rep.byAgent.map((a) => a.agentId).sort()).toEqual(['agt_a', 'unattributed']);
  });
});

describe('POST /api/internal/reconcile', () => {
  const SVC = 'svc-reconcile-token';
  let app: Hono;
  let apiKey: string;
  let db: SqliteDb;
  let saved: ModelCostTable;

  beforeEach(async () => {
    process.env['AGENTGATE_SERVICE_TOKEN'] = SVC;
    delete process.env['AGENTLENS_AUDIT_SIGNING_KEY'];
    delete process.env['BILLING_GRADE_SPEND'];
    saved = { ...getModelCosts() };
    const ctx = await createTestApp();
    app = ctx.app; apiKey = ctx.apiKey; db = ctx.db;
  });
  afterEach(() => {
    delete process.env['AGENTGATE_SERVICE_TOKEN'];
    delete process.env['AGENTLENS_AUDIT_SIGNING_KEY'];
    setModelCosts(saved);
  });

  async function ingestCost(agentId: string, costUsd: number, model = 'gpt-4o', inTok = 1000, outTok = 500) {
    const res = await app.request('/api/events', {
      method: 'POST', headers: authHeaders(apiKey),
      body: JSON.stringify({ events: [{
        sessionId: 's1', agentId, eventType: 'cost_tracked', timestamp: '2026-01-15T10:00:00Z',
        payload: { provider: 'openai', model, inputTokens: inTok, outputTokens: outTok, totalTokens: inTok + outTok, costUsd },
      }] }),
    });
    expect(res.status).toBe(201);
  }
  async function reconcileReq(body: unknown, token: string | null = SVC) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return app.request('/api/internal/reconcile', { method: 'POST', headers, body: JSON.stringify(body) });
  }

  it('stamps pricing_version provenance on cost events at ingest (NULL otherwise)', async () => {
    setModelCosts({ 'gpt-4o': { input: 1, output: 1 } });
    const pvAtIngest = pricingVersion();
    await ingestCost('agt_a', 0.0015);
    // a non-cost event in the same session
    await app.request('/api/events', {
      method: 'POST', headers: authHeaders(apiKey),
      body: JSON.stringify({ events: [{ sessionId: 's1', agentId: 'agt_a', eventType: 'tool_call', payload: { toolName: 't', callId: 'c', arguments: {} } }] }),
    });

    const rows = db.all<{ event_type: string; pricing_version: string | null }>(sql`SELECT event_type, pricing_version FROM events ORDER BY id`);
    const cost = rows.find((r) => r.event_type === 'cost_tracked')!;
    const tool = rows.find((r) => r.event_type === 'tool_call')!;
    expect(cost.pricing_version).toBe(pvAtIngest);
    expect(tool.pricing_version).toBeNull();
  });

  it('stamps pricing_version on OTLP-ingested cost events too (both paths)', async () => {
    setModelCosts({ 'claude-haiku-4-5': { input: 1, output: 1 } });
    const pvAtIngest = pricingVersion();
    const res = await app.request('/v1/traces', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resourceSpans: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'agt_otlp' } }] },
        scopeSpans: [{ spans: [{
          name: 'chat', traceId: 'rcp1', spanId: 'rcp1-s',
          startTimeUnixNano: '1700000000000000000', endTimeUnixNano: '1700000002000000000', status: { code: 1 },
          attributes: [
            { key: 'gen_ai.system', value: { stringValue: 'anthropic' } },
            { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
            { key: 'gen_ai.request.model', value: { stringValue: 'claude-haiku-4-5' } },
            { key: 'gen_ai.usage.input_tokens', value: { intValue: 100 } },
            { key: 'gen_ai.usage.output_tokens', value: { intValue: 50 } },
          ],
        }] }],
      }] }),
    });
    expect(res.status).toBe(200);
    const cost = db.all<{ pricing_version: string | null }>(
      sql`SELECT pricing_version FROM events WHERE event_type = 'llm_response'`,
    );
    expect(cost.length).toBeGreaterThan(0);
    for (const r of cost) expect(r.pricing_version).toBe(pvAtIngest);
  });

  it('flags drift after a price change and signs the report; stable pricing does not', async () => {
    setModelCosts({ 'gpt-4o': { input: 1, output: 1 } });
    const stored = costUsdDetailed('gpt-4o', { inputTokens: 1000, outputTokens: 500 }).costUsd;
    await ingestCost('agt_a', stored);

    // Stable pricing → no drift, no alert.
    const stableRes = await reconcileReq({ tenantId: 'default', ...WINDOW });
    const stable = await stableRes.json() as any;
    expect(stable.byAgent.find((a: any) => a.agentId === 'agt_a').alert).toBe(false);
    expect(stable.totals.agentsAlerting).toBe(0);
    expect(stable.signature).toBeNull(); // no signing key configured

    // Price doubles → recompute exceeds stored → drift + alert.
    setModelCosts({ 'gpt-4o': { input: 2, output: 2 } });
    process.env['AGENTLENS_AUDIT_SIGNING_KEY'] = 'recon-signing-key';
    const driftRes = await reconcileReq({ tenantId: 'default', ...WINDOW });
    expect(driftRes.status).toBe(200);
    const body = await driftRes.json() as any;
    const a = body.byAgent.find((x: any) => x.agentId === 'agt_a');
    expect(a.driftUsd).toBeGreaterThan(0);
    expect(a.driftPct).toBeCloseTo(1.0, 6);
    expect(a.alert).toBe(true);
    expect(a.staleVersionCount).toBe(1);
    expect(body.totals.agentsAlerting).toBe(1);
    expect(body.signature).toMatch(/^hmac-sha256:/);
  });

  it('isolates by tenant', async () => {
    setModelCosts({ 'gpt-4o': { input: 1, output: 1 } });
    await ingestCost('agt_a', 0.5);
    setModelCosts({ 'gpt-4o': { input: 5, output: 5 } });
    const res = await reconcileReq({ tenantId: 'other-tenant', ...WINDOW });
    const body = await res.json() as any;
    expect(body.byAgent).toEqual([]); // no events under other-tenant
    expect(body.totals.eventCount).toBe(0);
  });

  it('rejects missing tenantId (400), bad token (401), and disabled service (503)', async () => {
    expect((await reconcileReq({ ...WINDOW })).status).toBe(400);
    expect((await reconcileReq({ tenantId: 'default' }, 'wrong')).status).toBe(401);
    delete process.env['AGENTGATE_SERVICE_TOKEN'];
    expect((await reconcileReq({ tenantId: 'default' })).status).toBe(503);
  });
});
