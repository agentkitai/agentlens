/**
 * OTLP verification gate (Slice B, #88).
 *
 * The OTLP ingest path reads the agent id straight from untrusted span/resource
 * attributes, so it is spoofable. This slice reuses the AgentGate agent token
 * (X-Agent-Token, e.g. via OTEL_EXPORTER_OTLP_HEADERS) — verified exactly like
 * POST /api/events — to stamp a server-authoritative verified id into the
 * Slice-A `verified_agent_id` column. A spoofed agent id without a valid token
 * stays unverified (→ "unattributed" in billing-grade mode); the chain still
 * verifies because the stamp lives in the already-hashed metadata.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { signAccessToken, type AuthConfig } from 'agentkit-auth';
import { verifyChain } from '@agentlensai/core';
import { otlpRoutes, resetRateLimiter } from '../otlp.js';
import { createTestDb, type SqliteDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SqliteEventStore } from '../../db/sqlite-store.js';
import { createTestApp } from '../../__tests__/test-helpers.js';

const JWT_SECRET = 'agentgate-shared-secret-at-least-32-chars!';

function agentCfg(): AuthConfig {
  return { oidc: null, jwt: { secret: JWT_SECRET, accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 604800 }, authDisabled: false };
}
const agentToken = (sub: string) =>
  signAccessToken({ sub, tid: 'default', role: 'viewer', email: '', typ: 'agent' }, agentCfg());

/** A gen_ai chat span (cost-bearing) whose self-reported agent id is `service.name`. */
function genaiTrace(serviceName: string, traceId: string) {
  return {
    resourceSpans: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: serviceName } }] },
      scopeSpans: [{
        spans: [{
          name: 'chat', traceId, spanId: `${traceId}-s`,
          startTimeUnixNano: '1700000000000000000', endTimeUnixNano: '1700000002000000000',
          status: { code: 1 },
          attributes: [
            { key: 'gen_ai.system', value: { stringValue: 'anthropic' } },
            { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
            { key: 'gen_ai.request.model', value: { stringValue: 'claude-haiku-4-5' } },
            { key: 'gen_ai.usage.input_tokens', value: { intValue: 100 } },
            { key: 'gen_ai.usage.output_tokens', value: { intValue: 50 } },
          ],
        }],
      }],
    }],
  };
}

describe('OTLP verification gate (#88)', () => {
  let db: SqliteDb;
  let store: SqliteEventStore;
  let app: Hono;

  beforeEach(() => {
    resetRateLimiter();
    process.env['AGENTGATE_JWT_SECRET'] = JWT_SECRET;
    db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    app = new Hono();
    app.route('/v1', otlpRoutes(store));
  });
  afterEach(() => { delete process.env['AGENTGATE_JWT_SECRET']; });

  async function postTrace(payload: unknown, token?: string) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers['X-Agent-Token'] = token;
    const res = await app.request('/v1/traces', { method: 'POST', headers, body: JSON.stringify(payload) });
    expect(res.status).toBe(200);
  }

  function verifiedCol(): Array<{ agent_id: string; verified_agent_id: string | null }> {
    return db.all(sql`SELECT agent_id, verified_agent_id FROM events ORDER BY id`);
  }

  it('valid token → server-verified id stamped; chain still verifies', async () => {
    await postTrace(genaiTrace('agt_real', 't1'), await agentToken('agt_real'));

    const timeline = await store.getSessionTimeline('trace-t1');
    expect(timeline.length).toBeGreaterThan(0);
    for (const e of timeline) {
      expect(e.metadata['verifiedAgentId']).toBe('agt_real');
      expect(e.metadata['verifiedAgentMethod']).toBe('agentgate_token');
      expect(e.metadata['source']).toBe('otlp_genai'); // metadata stays server-built
    }
    expect(verifyChain(timeline as any).valid).toBe(true);
    for (const r of verifiedCol()) expect(r.verified_agent_id).toBe('agt_real');
  });

  it('spoofed agent id without a token → NOT verified (unattributed)', async () => {
    await postTrace(genaiTrace('agt_victim', 't2')); // no token

    const timeline = await store.getSessionTimeline('trace-t2');
    expect(timeline.length).toBeGreaterThan(0);
    for (const e of timeline) {
      expect(e.agentId).toBe('agt_victim'); // self-reported claim is preserved...
      expect(e.metadata['verifiedAgentId']).toBeUndefined(); // ...but never verified
    }
    for (const r of verifiedCol()) {
      expect(r.agent_id).toBe('agt_victim');
      expect(r.verified_agent_id).toBeNull();
    }
    // chain is intact even with no stamp (insert recomputes + verifies the hash)
    expect(verifyChain(timeline as any).valid).toBe(true);
  });

  it('verified id is server-authoritative: token sub wins over the claimed service.name', async () => {
    // Span claims service.name=agt_other, but the token is for agt_real.
    await postTrace(genaiTrace('agt_other', 't3'), await agentToken('agt_real'));

    for (const r of verifiedCol()) {
      expect(r.agent_id).toBe('agt_other'); // claimed id untouched
      expect(r.verified_agent_id).toBe('agt_real'); // attribution follows the verified token
    }
  });

  it('invalid token (wrong secret) → not verified', async () => {
    const forged = await signAccessToken(
      { sub: 'agt_real', tid: 'default', role: 'viewer', email: '', typ: 'agent' },
      { oidc: null, jwt: { secret: 'a-different-secret-at-least-32-chars-long!', accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 604800 }, authDisabled: false },
    );
    await postTrace(genaiTrace('agt_real', 't4'), forged);
    for (const r of verifiedCol()) expect(r.verified_agent_id).toBeNull();
  });
});

describe('OTLP → billing-grade spend, end to end (#88 × #87)', () => {
  const SVC_TOKEN = 'svc-test-token-otlp';

  beforeEach(() => {
    resetRateLimiter();
    process.env['AGENTGATE_JWT_SECRET'] = JWT_SECRET;
    process.env['AGENTGATE_SERVICE_TOKEN'] = SVC_TOKEN;
    process.env['BILLING_GRADE_SPEND'] = 'true';
  });
  afterEach(() => {
    delete process.env['AGENTGATE_JWT_SECRET'];
    delete process.env['AGENTGATE_SERVICE_TOKEN'];
    delete process.env['BILLING_GRADE_SPEND'];
  });

  it('verified OTLP cost is attributed; spoofed OTLP cost lands in unattributed', async () => {
    const { app } = await createTestApp();
    const trace = async (svc: string, traceId: string, token?: string) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (token) headers['X-Agent-Token'] = token;
      const res = await app.request('/v1/traces', { method: 'POST', headers, body: JSON.stringify(genaiTrace(svc, traceId)) });
      expect(res.status).toBe(200);
    };

    await trace('agt_real', 'e1', await agentToken('agt_real')); // verified
    await trace('agt_real', 'e2'); // spoof: claims agt_real, no token

    const res = await app.request('/api/internal/spend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SVC_TOKEN}` },
      body: JSON.stringify({ agentIds: ['agt_real'], tenantId: 'default', from: '2023-11-01T00:00:00Z', to: '2023-12-01T00:00:00Z' }),
    });
    const body = (await res.json()) as {
      spend: Array<{ agentId: string; totalCostUsd: number }>;
      unattributed: { totalCostUsd: number };
    };
    const verifiedCost = body.spend.find((s) => s.agentId === 'agt_real')?.totalCostUsd ?? 0;

    // Each gen_ai span prices identically; the verified one bills to agt_real,
    // the spoofed one is surfaced as unattributed (never billed to agt_real).
    expect(verifiedCost).toBeGreaterThan(0);
    expect(body.unattributed.totalCostUsd).toBeCloseTo(verifiedCost, 6);
  });
});
