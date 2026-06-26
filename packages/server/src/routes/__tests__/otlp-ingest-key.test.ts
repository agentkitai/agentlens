/**
 * OTLP ingest-key verification (#24, Option 3 — the AgentLens callback half).
 *
 * A longer-lived ingest key (X-Agent-Ingest-Key) is resolved to a verified agent
 * id by calling AgentGate's /api/internal/verify-ingest-key (mocked here), with a
 * short cache and fail-open-to-unattributed. The agent JWT still wins when both
 * are present. Off unless AGENTGATE_URL + AGENTGATE_SERVICE_TOKEN are set.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { signAccessToken, type AuthConfig } from '@agentkitai/auth';
import { otlpRoutes, resetRateLimiter } from '../otlp.js';
import { createTestDb, type SqliteDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SqliteEventStore } from '../../db/sqlite-store.js';
import { _resetIngestKeyCache, _ingestKeyCacheSize, verifyIngestKey } from '../../lib/ingest-key-verify.js';

const JWT_SECRET = 'agentgate-shared-secret-at-least-32-chars!';
const SVC = 'svc-tok';

const agentCfg = (): AuthConfig => ({ oidc: null, jwt: { secret: JWT_SECRET, accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 604800 }, authDisabled: false });

function genaiTrace(serviceName: string, traceId: string) {
  return {
    resourceSpans: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: serviceName } }] },
      scopeSpans: [{ spans: [{
        name: 'chat', traceId, spanId: `${traceId}-s`,
        startTimeUnixNano: '1700000000000000000', endTimeUnixNano: '1700000002000000000', status: { code: 1 },
        attributes: [
          { key: 'gen_ai.system', value: { stringValue: 'anthropic' } },
          { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
          { key: 'gen_ai.request.model', value: { stringValue: 'claude-haiku-4-5' } },
          { key: 'gen_ai.usage.input_tokens', value: { intValue: 100 } },
          { key: 'gen_ai.usage.output_tokens', value: { intValue: 50 } },
        ],
      }] }],
    }],
  };
}

describe('OTLP ingest-key verification (#24)', () => {
  let db: SqliteDb;
  let store: SqliteEventStore;
  let app: Hono;

  beforeEach(() => {
    resetRateLimiter();
    _resetIngestKeyCache();
    process.env['AGENTGATE_URL'] = 'http://agentgate.test';
    process.env['AGENTGATE_SERVICE_TOKEN'] = SVC;
    process.env['AGENTGATE_JWT_SECRET'] = JWT_SECRET;
    db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    app = new Hono();
    app.route('/v1', otlpRoutes(store));
  });
  afterEach(() => {
    delete process.env['AGENTGATE_URL'];
    delete process.env['AGENTGATE_SERVICE_TOKEN'];
    delete process.env['AGENTGATE_JWT_SECRET'];
    vi.restoreAllMocks();
  });

  async function postTrace(svc: string, traceId: string, headers: Record<string, string> = {}) {
    const res = await app.request('/v1/traces', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(genaiTrace(svc, traceId)),
    });
    expect(res.status).toBe(200);
  }
  const col = () => db.all<{ agent_id: string; verified_agent_id: string | null }>(sql`SELECT agent_id, verified_agent_id FROM events`);
  const setFetch = (impl: (...a: unknown[]) => Promise<Response>) => {
    const f = vi.fn(impl);
    (globalThis as unknown as { fetch: unknown }).fetch = f;
    return f;
  };

  it('resolves a valid ingest key via AgentGate and stamps method agentgate_ingest_key', async () => {
    const f = setFetch(async () => new Response(JSON.stringify({ agentId: 'agt_real' }), { status: 200 }));
    await postTrace('agt_claimed', 'k1', { 'X-Agent-Ingest-Key': 'agl_ingest_xyz' });

    const tl = await store.getSessionTimeline('trace-k1');
    expect(tl.length).toBeGreaterThan(0);
    for (const e of tl) {
      expect(e.metadata['verifiedAgentId']).toBe('agt_real');
      expect(e.metadata['verifiedAgentMethod']).toBe('agentgate_ingest_key');
    }
    for (const r of col()) expect(r.verified_agent_id).toBe('agt_real');
    // called AgentGate's verify endpoint with the service token
    expect((f.mock.calls[0]![0] as string)).toContain('/api/internal/verify-ingest-key');
  });

  it('caches the resolution — a second span with the same key does not re-call AgentGate', async () => {
    const f = setFetch(async () => new Response(JSON.stringify({ agentId: 'agt_real' }), { status: 200 }));
    await postTrace('x', 'k2', { 'X-Agent-Ingest-Key': 'agl_ingest_same' });
    await postTrace('x', 'k3', { 'X-Agent-Ingest-Key': 'agl_ingest_same' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('invalid/revoked key (AgentGate agentId:null) → unattributed', async () => {
    setFetch(async () => new Response(JSON.stringify({ agentId: null }), { status: 200 }));
    await postTrace('x', 'k4', { 'X-Agent-Ingest-Key': 'agl_ingest_bad' });
    for (const r of col()) expect(r.verified_agent_id).toBeNull();
  });

  it('AgentGate unreachable → fail-open to unattributed (no throw, span still ingests)', async () => {
    setFetch(async () => { throw new Error('ECONNREFUSED'); });
    await postTrace('x', 'k5', { 'X-Agent-Ingest-Key': 'agl_ingest_z' });
    for (const r of col()) expect(r.verified_agent_id).toBeNull();
  });

  it('the agent JWT wins over an ingest key when both are present (no AgentGate call)', async () => {
    const f = setFetch(async () => new Response(JSON.stringify({ agentId: 'agt_key' }), { status: 200 }));
    const token = await signAccessToken({ sub: 'agt_jwt', tid: 'default', role: 'viewer', email: '', typ: 'agent' }, agentCfg());
    await postTrace('x', 'k6', { 'X-Agent-Token': token, 'X-Agent-Ingest-Key': 'agl_ingest_unused' });
    for (const r of col()) expect(r.verified_agent_id).toBe('agt_jwt');
    expect(f).not.toHaveBeenCalled(); // JWT path is local — never hits AgentGate
  });

  it('ignores the ingest key when AGENTGATE_URL is unset (feature off)', async () => {
    delete process.env['AGENTGATE_URL'];
    const f = setFetch(async () => new Response(JSON.stringify({ agentId: 'agt_real' }), { status: 200 }));
    await postTrace('x', 'k7', { 'X-Agent-Ingest-Key': 'agl_ingest_z' });
    for (const r of col()) expect(r.verified_agent_id).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('caps the verify cache under a flood of distinct keys (no unbounded growth)', async () => {
    // The cache key is sha256 of the caller-controlled ingest-key header, so a
    // flood of distinct keys must not grow the cache without bound. All entries
    // stay UNEXPIRED here (resolved → 60s TTL), so this only passes with a hard cap.
    setFetch(async () => new Response(JSON.stringify({ agentId: 'agt_x' }), { status: 200 }));
    for (let i = 0; i < 10_200; i++) {
      await verifyIngestKey(`agl_ingest_flood_${i}`);
    }
    expect(_ingestKeyCacheSize()).toBeLessThanOrEqual(10_001); // MAX_CACHE (10k) + the final set
  });
});
