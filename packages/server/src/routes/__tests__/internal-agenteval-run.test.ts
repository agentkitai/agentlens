/**
 * POST /api/internal/eval/run — the agenteval→lens federation (#55).
 *
 * agenteval (the external Python eval framework) reports a completed suite run;
 * AgentLens records it as a hash-chained, server-authoritative eval_result in a
 * (synthetic) session's audit trail. The chain must still verify, and the endpoint
 * is gated by the service token.
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

const SVC_TOKEN = 'svc-run-token-xyz';

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

const passingRun = {
  id: 'run_abc123',
  suite: 'pii-suite',
  createdAt: '2026-06-25T12:00:00.000Z',
  method: 'deterministic' as const,
  summary: { total: 3, passed: 3, failed: 0, passRate: 1, totalCostUsd: 0.0123 },
};

const failingRun = {
  id: 'run_def456',
  suite: 'pii-suite',
  summary: { total: 3, passed: 1, failed: 2, passRate: 0.3333 },
  failedCases: [
    { name: 'leaks-ssn', score: 0, detail: 'SSN present in output' },
    { name: 'leaks-email', score: 0.2 },
  ],
};

describe('POST /api/internal/eval/run', () => {
  let db: any;
  let store: SqliteEventStore;
  let app: any;
  let apiKey: string;

  const emit = (body: unknown, token: string | null = SVC_TOKEN) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return app.request('/api/internal/eval/run', { method: 'POST', headers, body: JSON.stringify(body) });
  };

  beforeEach(async () => {
    process.env['AGENTGATE_SERVICE_TOKEN'] = SVC_TOKEN;
    db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    app = createApp(db, store);
    apiKey = seedApiKey(db);

    // Pre-existing session the eval can chain onto.
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

  it('records a passing run as a chained eval_result; the chain still verifies', async () => {
    const res = await emit({ tenantId: 'default', sessionId: 's1', agentId: 'module:agent', run: passingRun });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.recorded).toBe(true);
    expect(body.passed).toBe(true);
    expect(body.score).toBe(1);
    expect(body.rulesEvaluated).toBe(3);
    expect(body.violations).toHaveLength(0);
    expect(body.event.hash).toBeDefined();

    const timeline = await store.getSessionTimeline('s1');
    expect(timeline).toHaveLength(3);
    const evalEvent = timeline.find((e) => e.eventType === 'eval_result');
    expect(evalEvent).toBeDefined();
    const p = evalEvent!.payload as any;
    expect(p.scorerType).toBe('agenteval');
    expect(p.method).toBe('deterministic');
    expect(p.evalRunId).toBe('run_abc123');
    // A passing run is informational; a failing one is a warning.
    expect(evalEvent!.severity).toBe('info');
    // Provenance metadata is stamped (and hashed) onto the event.
    const m = evalEvent!.metadata as any;
    expect(m.source).toBe('agenteval');
    expect(m.suite).toBe('pii-suite');
    expect(m.runId).toBe('run_abc123');
    expect(m.ranAt).toBe('2026-06-25T12:00:00.000Z');
    expect(verifyChain(timeline as any).valid).toBe(true);
  });

  it('maps failed cases to violations and marks the run failed (warn)', async () => {
    const res = await emit({ tenantId: 'default', sessionId: 's1', agentId: 'module:agent', run: failingRun });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.passed).toBe(false);
    expect(body.score).toBeCloseTo(0.3333, 4);
    expect(body.violations).toHaveLength(2);
    expect(body.violations[0]).toMatchObject({ ruleId: 'leaks-ssn', ruleType: 'eval_case', detail: 'SSN present in output' });
    // No detail supplied → synthesized from the score.
    expect(body.violations[1].detail).toContain('0.20');

    const timeline = await store.getSessionTimeline('s1');
    const evalEvent = timeline.find((e) => e.eventType === 'eval_result');
    expect(evalEvent!.severity).toBe('warn');
    expect(verifyChain(timeline as any).valid).toBe(true);
  });

  it('records a run into a previously-unseen session (genesis), still verifies', async () => {
    const res = await emit({ tenantId: 'default', sessionId: 'eval-run_abc123', agentId: 'module:agent', run: passingRun });
    expect(res.status).toBe(201);
    const timeline = await store.getSessionTimeline('eval-run_abc123');
    expect(timeline).toHaveLength(1);
    expect(timeline[0]!.eventType).toBe('eval_result');
    expect(timeline[0]!.prevHash).toBeNull();
    expect(verifyChain(timeline as any).valid).toBe(true);
  });

  it('returns 409 only on a hash-chain race (retryable), 500 otherwise', async () => {
    const spy = vi.spyOn(store, 'insertEvents');
    spy.mockRejectedValueOnce(new HashChainError('Chain continuity broken'));
    const r409 = await emit({ tenantId: 'default', sessionId: 's1', agentId: 'module:agent', run: passingRun });
    expect(r409.status).toBe(409);
    // The detail (event ids/hashes) must NOT leak to the caller.
    expect((await r409.json()).error).not.toContain('Chain continuity');

    spy.mockRejectedValueOnce(new Error('db is down'));
    const r500 = await emit({ tenantId: 'default', sessionId: 's1', agentId: 'module:agent', run: passingRun });
    expect(r500.status).toBe(500);
    spy.mockRestore();
  });

  it('rejects a missing token (401)', async () => {
    const res = await emit({ tenantId: 'default', sessionId: 's1', agentId: 'module:agent', run: passingRun }, null);
    expect(res.status).toBe(401);
  });

  it('rejects a wrong token (401)', async () => {
    const res = await emit({ tenantId: 'default', sessionId: 's1', agentId: 'module:agent', run: passingRun }, 'nope');
    expect(res.status).toBe(401);
  });

  it('returns 503 when the service token is unset', async () => {
    delete process.env['AGENTGATE_SERVICE_TOKEN'];
    const res = await emit({ tenantId: 'default', sessionId: 's1', agentId: 'module:agent', run: passingRun });
    expect(res.status).toBe(503);
  });

  it('validates the body (400 on missing/invalid fields)', async () => {
    const ok = passingRun;
    for (const body of [
      { sessionId: 's1', agentId: 'a', run: ok }, // no tenantId
      { tenantId: 'default', agentId: 'a', run: ok }, // no sessionId
      { tenantId: 'default', sessionId: 's1', run: ok }, // no agentId
      { tenantId: 'default', sessionId: 's1', agentId: 'a' }, // no run
      { tenantId: 'default', sessionId: 's1', agentId: 'a', run: { ...ok, id: '' } }, // empty run.id
      { tenantId: 'default', sessionId: 's1', agentId: 'a', run: { ...ok, summary: { ...ok.summary, passRate: 1.5 } } }, // passRate > 1
      { tenantId: 'default', sessionId: 's1', agentId: 'a', run: { ...ok, method: 'bogus' } }, // bad method enum
    ]) {
      const res = await emit(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('does not let a cross-tenant run touch another tenant\'s session chain', async () => {
    // s1 belongs to tenant 'default'. A run for tenant 'other' + sessionId 's1'
    // must start a SEPARATE chain under 'other', not append to default's s1.
    const res = await emit({ tenantId: 'other', sessionId: 's1', agentId: 'module:agent', run: passingRun });
    expect(res.status).toBe(201);
    const def = await store.getSessionTimeline('s1', 'default');
    expect(def).toHaveLength(2);
    expect(verifyChain(def as any).valid).toBe(true);
    const other = await store.getSessionTimeline('s1', 'other');
    expect(other).toHaveLength(1);
    expect(other[0]!.eventType).toBe('eval_result');
    expect(other[0]!.prevHash).toBeNull();
    expect(verifyChain(other as any).valid).toBe(true);
  });
});
