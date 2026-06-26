/**
 * Billing-grade verified attribution (Slice A, #87).
 *
 * The dedicated `verified_agent_id` column is derived server-side from the
 * agent-token verify-stamp. In billing-grade mode spend attributes by it, so a
 * self-reported / spoofed `event.agentId` can't claim another agent's spend —
 * unverified cost lands in an "unattributed" bucket instead. Guardrail mode
 * (default) groups by the raw `agent_id` exactly as before.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { signAccessToken, type AuthConfig } from '@agentkitai/auth';
import { verifyChain } from '@agentkitai/agentlens-core';
import { createTestApp, authHeaders } from './test-helpers.js';
import type { Hono } from 'hono';
import type { SqliteDb } from '../db/index.js';
import { SqliteEventStore } from '../db/sqlite-store.js';

const JWT_SECRET = 'agentgate-shared-secret-at-least-32-chars!';
const SVC_TOKEN = 'svc-test-token-abc123';
const WINDOW = { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' };

function agentCfg(): AuthConfig {
  return { oidc: null, jwt: { secret: JWT_SECRET, accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 604800 }, authDisabled: false };
}
const agentToken = (sub: string) =>
  signAccessToken({ sub, tid: 'default', role: 'viewer', email: '', typ: 'agent' }, agentCfg());

function costEvent(agentId: string, sessionId: string, costUsd: number, ts: string) {
  return {
    sessionId,
    agentId,
    eventType: 'cost_tracked',
    timestamp: ts,
    payload: { provider: 'openai', model: 'gpt-4o', inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd },
  };
}

async function ingest(app: Hono, apiKey: string, events: unknown[], token?: string) {
  const headers = { ...authHeaders(apiKey), ...(token ? { 'X-Agent-Token': token } : {}) };
  const res = await app.request('/api/events', { method: 'POST', headers, body: JSON.stringify({ events }) });
  expect(res.status).toBe(201);
}

async function spend(app: Hono, body: unknown) {
  const res = await app.request('/api/internal/spend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SVC_TOKEN}` },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<{
    spend: Array<{ agentId: string; totalCostUsd: number }>;
    mode?: string;
    unattributed?: { totalCostUsd: number; eventCount: number };
  }>;
}

describe('Slice A — verified attribution (#87)', () => {
  let app: Hono;
  let apiKey: string;
  let db: SqliteDb;

  beforeEach(async () => {
    process.env['AGENTGATE_SERVICE_TOKEN'] = SVC_TOKEN;
    process.env['AGENTGATE_JWT_SECRET'] = JWT_SECRET;
    delete process.env['BILLING_GRADE_SPEND'];
    const ctx = await createTestApp();
    app = ctx.app;
    apiKey = ctx.apiKey;
    db = ctx.db;

    // s1: verified as agt_real, claims agt_real      → verified=agt_real ($0.02)
    // s2: verified as agt_real, claims agt_spoofed    → verified=agt_real ($0.07) (claim ignored)
    // s3: NO token,            claims agt_real        → verified=NULL     ($0.50) (spoof)
    const realTok = await agentToken('agt_real');
    await ingest(app, apiKey, [costEvent('agt_real', 's1', 0.02, '2026-01-15T10:00:00Z')], realTok);
    await ingest(app, apiKey, [costEvent('agt_spoofed', 's2', 0.07, '2026-01-15T11:00:00Z')], realTok);
    await ingest(app, apiKey, [costEvent('agt_real', 's3', 0.5, '2026-01-16T10:00:00Z')]); // no token
  });

  afterEach(() => {
    delete process.env['AGENTGATE_SERVICE_TOKEN'];
    delete process.env['AGENTGATE_JWT_SECRET'];
    delete process.env['BILLING_GRADE_SPEND'];
  });

  it('persists verified_agent_id derived from the verify-stamp (NULL when unverified)', async () => {
    const store = new SqliteEventStore(db);
    const s1 = await store.getSessionTimeline('s1');
    const s3 = await store.getSessionTimeline('s3');
    expect(s1[0]!.metadata['verifiedAgentId']).toBe('agt_real');
    // chain still verifies — the column is derived from already-hashed metadata
    expect(verifyChain(s1 as any).valid).toBe(true);

    const rows = db.all<{ agent_id: string; verified_agent_id: string | null }>(
      sql`SELECT agent_id, verified_agent_id FROM events ORDER BY timestamp`,
    );
    const byClaim = rows.map((r) => [r.agent_id, r.verified_agent_id]);
    expect(byClaim).toContainEqual(['agt_real', 'agt_real']); // s1: verified
    expect(byClaim).toContainEqual(['agt_spoofed', 'agt_real']); // s2: claim ignored, verified wins
    expect(byClaim).toContainEqual(['agt_real', null]); // s3: spoof, unverified
    expect(s3[0]!.metadata['verifiedAgentId']).toBeUndefined();
  });

  it('billing mode: attributes by verified id; spoofed agentId is NOT attributed', async () => {
    process.env['BILLING_GRADE_SPEND'] = 'true';
    const body = await spend(app, { agentIds: ['agt_real', 'agt_spoofed'], tenantId: 'default', ...WINDOW });
    const byAgent = Object.fromEntries(body.spend.map((s) => [s.agentId, s.totalCostUsd]));

    // agt_real gets BOTH verified events (0.02 + 0.07) — even the one that *claimed* agt_spoofed.
    expect(byAgent['agt_real']).toBeCloseTo(0.09, 6);
    // agt_spoofed earns nothing: no event was *verified* as agt_spoofed.
    expect(byAgent['agt_spoofed']).toBeUndefined();
    // The unverified spoof ($0.50) is surfaced as unattributed, not billed to agt_real.
    expect(body.mode).toBe('billing');
    expect(body.unattributed!.totalCostUsd).toBeCloseTo(0.5, 6);
    expect(body.unattributed!.eventCount).toBe(1);
  });

  it('guardrail mode (default): groups by raw agent_id, byte-for-byte unchanged', async () => {
    const body = await spend(app, { agentIds: ['agt_real', 'agt_spoofed'], tenantId: 'default', ...WINDOW });
    const byAgent = Object.fromEntries(body.spend.map((s) => [s.agentId, s.totalCostUsd]));

    // Raw agent_id grouping: the spoof counts toward agt_real.
    expect(byAgent['agt_real']).toBeCloseTo(0.52, 6); // 0.02 + 0.50
    expect(byAgent['agt_spoofed']).toBeCloseTo(0.07, 6);
    // No billing-only fields leak into the guardrail response.
    expect(body.mode).toBeUndefined();
    expect(body.unattributed).toBeUndefined();
  });

  it('billing mode: /api/analytics/costs groups by verified id, labels unverified "unattributed"', async () => {
    process.env['BILLING_GRADE_SPEND'] = 'true';
    const res = await app.request(
      '/api/analytics/costs?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z',
      { headers: authHeaders(apiKey) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { byAgent: Array<{ agentId: string; totalCostUsd: number }> };
    const byAgent = Object.fromEntries(body.byAgent.map((r) => [r.agentId, r.totalCostUsd]));
    expect(byAgent['agt_real']).toBeCloseTo(0.09, 6); // both verified events
    expect(byAgent['agt_spoofed']).toBeUndefined(); // claim ignored — nothing verified as agt_spoofed
    expect(byAgent['unattributed']).toBeCloseTo(0.5, 6); // unverified spoof, surfaced not trusted
  });

  it('guardrail mode: /api/analytics/costs groups by raw agent_id (no unattributed bucket)', async () => {
    const res = await app.request(
      '/api/analytics/costs?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z',
      { headers: authHeaders(apiKey) },
    );
    const body = (await res.json()) as { byAgent: Array<{ agentId: string; totalCostUsd: number }> };
    const byAgent = Object.fromEntries(body.byAgent.map((r) => [r.agentId, r.totalCostUsd]));
    expect(byAgent['agt_real']).toBeCloseTo(0.52, 6); // 0.02 + 0.50
    expect(byAgent['agt_spoofed']).toBeCloseTo(0.07, 6);
    expect(byAgent['unattributed']).toBeUndefined();
  });

  it('migration adds an indexed verified_agent_id column (sqlite)', () => {
    const cols = db.all<{ name: string }>(sql`PRAGMA table_info(events)`).map((c) => c.name);
    expect(cols).toContain('verified_agent_id');
    const idx = db.all<{ name: string }>(sql`PRAGMA index_list(events)`).map((i) => i.name);
    expect(idx).toContain('idx_events_tenant_verified_ts');
  });
});
