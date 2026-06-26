/**
 * POST /api/internal/eval/guardrail-breach — the gate→lens wedge (#55).
 *
 * AgentGate reports a guardrail breach; AgentLens records it as a hash-chained,
 * server-authoritative compliance eval_result in the session's audit trail. The
 * chain must still verify, and the endpoint is gated by the service token.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { verifyChain } from '@agentkitai/agentlens-core';
import { eventsRoutes } from '../events.js';
import { internalRoutes } from '../internal.js';
import { HashChainError } from '../../db/errors.js';
import { authMiddleware, hashApiKey, type AuthVariables } from '../../middleware/auth.js';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SqliteEventStore } from '../../db/sqlite-store.js';
import { apiKeys } from '../../db/schema.sqlite.js';

const SVC_TOKEN = 'svc-breach-token-xyz';

function createApp(db: any, store: SqliteEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('/api/events/*', authMiddleware(db, false));
  app.route('/api/events', eventsRoutes(store, { embeddingWorker: null }));
  app.route('/api/internal', internalRoutes(store, db));
  return app;
}

function seedApiKey(db: any): string {
  const rawKey = 'als_testkey1234567890abcdef1234567890abcdef';
  db.insert(apiKeys).values({
    id: 'key-1', keyHash: hashApiKey(rawKey), name: 'Test Key',
    scopes: JSON.stringify(['*']), createdAt: Math.floor(Date.now() / 1000),
    tenantId: 'default', role: 'editor',
  }).run();
  return rawKey;
}

describe('POST /api/internal/eval/guardrail-breach', () => {
  let db: any;
  let store: SqliteEventStore;
  let app: any;
  let apiKey: string;

  const breach = (body: unknown, token: string | null = SVC_TOKEN) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return app.request('/api/internal/eval/guardrail-breach', { method: 'POST', headers, body: JSON.stringify(body) });
  };

  beforeEach(async () => {
    process.env['AGENTGATE_SERVICE_TOKEN'] = SVC_TOKEN;
    db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    app = createApp(db, store);
    apiKey = seedApiKey(db);

    const events = [
      { sessionId: 's1', agentId: 'agt_a', eventType: 'session_started', timestamp: '2026-01-01T00:00:01.000Z', payload: { agentName: 'a' } },
      { sessionId: 's1', agentId: 'agt_a', eventType: 'tool_call', timestamp: '2026-01-01T00:00:02.000Z', payload: { toolName: 'read_file', callId: 'c1', arguments: {} } },
    ];
    const res = await app.request('/api/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    });
    expect(res.status).toBe(201);
  });

  afterEach(() => {
    delete process.env['AGENTGATE_SERVICE_TOKEN'];
  });

  it('records a breach as a chained eval_result; the chain still verifies', async () => {
    const res = await breach({
      tenantId: 'default', sessionId: 's1', agentId: 'agt_a',
      breach: { ruleId: 'no_delete', ruleType: 'tool_denylist', tool: 'delete_db', reason: 'hard-denied by MCP guardrail', source: 'mcp_guardrail' },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.recorded).toBe(true);
    expect(body.passed).toBe(false);
    expect(body.score).toBe(0);
    expect(body.rulesEvaluated).toBeGreaterThanOrEqual(1);
    expect(body.violations).toHaveLength(1);
    expect(body.violations[0].ruleId).toBe('no_delete');
    expect(body.event.hash).toBeDefined();

    const timeline = await store.getSessionTimeline('s1');
    expect(timeline).toHaveLength(3);
    const evalEvent = timeline.find((e) => e.eventType === 'eval_result');
    expect(evalEvent).toBeDefined();
    const p = evalEvent!.payload as any;
    expect(p.scorerType).toBe('compliance');
    expect(p.method).toBe('deterministic');
    // Provenance metadata is stamped (and hashed) onto the event.
    const m = evalEvent!.metadata as any;
    expect(m.source).toBe('guardrail_breach');
    expect(m.gateSource).toBe('mcp_guardrail');
    expect(m.ruleId).toBe('no_delete');
    expect(verifyChain(timeline as any).valid).toBe(true);
  });

  it('returns 409 only on a hash-chain race (retryable), 500 otherwise', async () => {
    const spy = vi.spyOn(store, 'insertEvents');
    spy.mockRejectedValueOnce(new HashChainError('Chain continuity broken'));
    const r409 = await breach({
      tenantId: 'default', sessionId: 's1', agentId: 'agt_a',
      breach: { ruleId: 'no_delete', tool: 'delete_db', source: 'mcp_guardrail' },
    });
    expect(r409.status).toBe(409);
    // The detail (event ids/hashes) must NOT leak to the caller.
    expect((await r409.json()).error).not.toContain('Chain continuity');

    spy.mockRejectedValueOnce(new Error('db is down'));
    const r500 = await breach({
      tenantId: 'default', sessionId: 's1', agentId: 'agt_a',
      breach: { ruleId: 'no_delete', tool: 'delete_db', source: 'mcp_guardrail' },
    });
    expect(r500.status).toBe(500);
    spy.mockRestore();
  });

  it('records a breach into a previously-unseen session (genesis), still verifies', async () => {
    const res = await breach({
      tenantId: 'default', sessionId: 's-new', agentId: 'agt_a',
      breach: { ruleId: 'budget', ruleType: 'budget', reason: 'over cap', source: 'reactive_guardrail' },
    });
    expect(res.status).toBe(201);
    const timeline = await store.getSessionTimeline('s-new');
    expect(timeline).toHaveLength(1);
    expect(timeline[0]!.eventType).toBe('eval_result');
    expect(verifyChain(timeline as any).valid).toBe(true);
  });

  it('rejects a missing token (401)', async () => {
    const res = await breach({ tenantId: 'default', sessionId: 's1', agentId: 'agt_a', breach: { ruleId: 'x', source: 'mcp_guardrail' } }, null);
    expect(res.status).toBe(401);
  });

  it('rejects a wrong token (401)', async () => {
    const res = await breach({ tenantId: 'default', sessionId: 's1', agentId: 'agt_a', breach: { ruleId: 'x', source: 'mcp_guardrail' } }, 'nope');
    expect(res.status).toBe(401);
  });

  it('returns 503 when the service token is unset', async () => {
    delete process.env['AGENTGATE_SERVICE_TOKEN'];
    const res = await breach({ tenantId: 'default', sessionId: 's1', agentId: 'agt_a', breach: { ruleId: 'x', source: 'mcp_guardrail' } });
    expect(res.status).toBe(503);
  });

  it('validates the body (400 on missing fields)', async () => {
    for (const body of [
      { sessionId: 's1', agentId: 'agt_a', breach: { ruleId: 'x', source: 'mcp_guardrail' } }, // no tenantId
      { tenantId: 'default', agentId: 'agt_a', breach: { ruleId: 'x', source: 'mcp_guardrail' } }, // no sessionId
      { tenantId: 'default', sessionId: 's1', agentId: 'agt_a', breach: { source: 'mcp_guardrail' } }, // no ruleId
      { tenantId: 'default', sessionId: 's1', agentId: 'agt_a', breach: { ruleId: 'x' } }, // no source
      { tenantId: '', sessionId: 's1', agentId: 'agt_a', breach: { ruleId: 'x', source: 'mcp_guardrail' } }, // empty tenantId
      { tenantId: 'default', sessionId: '', agentId: 'agt_a', breach: { ruleId: 'x', source: 'mcp_guardrail' } }, // empty sessionId
    ]) {
      const res = await breach(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('does not let a cross-tenant breach touch another tenant\'s session chain', async () => {
    // s1 belongs to tenant 'default'. A breach for tenant 'other' + sessionId 's1'
    // must start a SEPARATE chain under 'other', not append to default's s1.
    const res = await breach({
      tenantId: 'other', sessionId: 's1', agentId: 'agt_a',
      breach: { ruleId: 'x', tool: 'delete_db', source: 'mcp_guardrail' },
    });
    expect(res.status).toBe(201);
    // default's s1 is untouched (still 2 events), and still verifies.
    const def = await store.getSessionTimeline('s1', 'default');
    expect(def).toHaveLength(2);
    expect(verifyChain(def as any).valid).toBe(true);
    // The breach landed in 'other's SEPARATE chain (genesis), and verifies.
    const other = await store.getSessionTimeline('s1', 'other');
    expect(other).toHaveLength(1);
    expect(other[0]!.eventType).toBe('eval_result');
    expect(other[0]!.prevHash).toBeNull();
    expect(verifyChain(other as any).valid).toBe(true);
  });
});
