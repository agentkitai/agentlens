/**
 * Compliance eval endpoint tests (#55 — Phase 1).
 *
 * The key guarantee: the emitted eval_result event extends the session's
 * tamper-evident hash chain, so the whole chain still verifies afterward.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { verifyChain } from '@agentlensai/core';
import { eventsRoutes } from '../events.js';
import { evalRoutes } from '../eval.js';
import { authMiddleware, hashApiKey, type AuthVariables } from '../../middleware/auth.js';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SqliteEventStore } from '../../db/sqlite-store.js';
import { apiKeys } from '../../db/schema.sqlite.js';

function createApp(db: any, store: SqliteEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('/*', authMiddleware(db, false));
  app.route('/api/events', eventsRoutes(store, { embeddingWorker: null }));
  app.route('/api/eval', evalRoutes(db, store));
  return app;
}

function seedApiKey(db: any): string {
  const rawKey = 'als_testkey1234567890abcdef1234567890abcdef';
  db.insert(apiKeys).values({
    id: 'key-1',
    keyHash: hashApiKey(rawKey),
    name: 'Test Key',
    scopes: JSON.stringify(['*']),
    createdAt: Math.floor(Date.now() / 1000),
    tenantId: 'default',
    role: 'editor',
  }).run();
  return rawKey;
}

describe('POST /api/eval/sessions/:id/compliance', () => {
  let db: any;
  let store: SqliteEventStore;
  let app: any;
  let apiKey: string;
  const auth = () => ({ Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' });

  beforeEach(async () => {
    db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    app = createApp(db, store);
    apiKey = seedApiKey(db);

    // Seed a session with distinct, increasing timestamps.
    const events = [
      { sessionId: 'sess-1', agentId: 'agent-1', eventType: 'session_started', timestamp: '2026-01-01T00:00:01.000Z', payload: { agentName: 'a' } },
      { sessionId: 'sess-1', agentId: 'agent-1', eventType: 'tool_call', timestamp: '2026-01-01T00:00:02.000Z', payload: { toolName: 'delete_db', callId: 'c1', arguments: {} } },
      { sessionId: 'sess-1', agentId: 'agent-1', eventType: 'cost_tracked', timestamp: '2026-01-01T00:00:03.000Z', payload: { provider: 'anthropic', model: 'm', inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.5 } },
    ];
    const res = await app.request('/api/events', { method: 'POST', headers: auth(), body: JSON.stringify({ events }) });
    expect(res.status).toBe(201);
  });

  it('fails a denylist violation, records a chained eval_result, chain still verifies', async () => {
    const res = await app.request('/api/eval/sessions/sess-1/compliance', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ rules: [{ id: 'no_delete', type: 'tool_denylist', tools: ['delete_*'] }] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.passed).toBe(false);
    expect(body.violations).toHaveLength(1);
    expect(body.violations[0].ruleId).toBe('no_delete');
    expect(body.event.hash).toBeDefined();

    // The eval_result event is now part of the session chain.
    const timeline = await store.getSessionTimeline('sess-1');
    expect(timeline).toHaveLength(4);
    const evalEvent = timeline.find((e) => e.eventType === 'eval_result');
    expect(evalEvent).toBeDefined();
    expect((evalEvent!.payload as any).scorerType).toBe('compliance');

    // The whole chain (seeded events + appended eval_result) still verifies.
    expect(verifyChain(timeline as any).valid).toBe(true);
  });

  it('passes a clean policy and emits an info-severity eval_result', async () => {
    const res = await app.request('/api/eval/sessions/sess-1/compliance', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ rules: [{ id: 'budget', type: 'max_cost', maxUsd: 10 }] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.passed).toBe(true);
    expect(body.score).toBe(1);

    const timeline = await store.getSessionTimeline('sess-1');
    expect(verifyChain(timeline as any).valid).toBe(true);
  });

  it('returns 400 when no rules are provided', async () => {
    const res = await app.request('/api/eval/sessions/sess-1/compliance', {
      method: 'POST', headers: auth(), body: JSON.stringify({ rules: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects malformed rules at the trust boundary (no crash)', async () => {
    const cases = [
      { rules: [{ id: 'x', type: 'tool_denylist' }] },                 // missing tools
      { rules: [{ id: 'x', type: 'tool_denylist', tools: 'delete' }] }, // tools not an array
      { rules: [{ id: 'x', type: 'bogus_type', foo: 1 }] },            // unknown rule type
      { rules: [{ id: 'x', type: 'no_severity_above', severity: 'oops' }] }, // bad severity
      { rules: [{ id: 'x', type: 'max_cost', maxUsd: 1 }], passThreshold: 2 }, // bad threshold
      { rules: [{ id: 'x', type: 'max_cost', maxUsd: -1 }] },          // negative cap
    ];
    for (const body of cases) {
      const res = await app.request('/api/eval/sessions/sess-1/compliance', {
        method: 'POST', headers: auth(), body: JSON.stringify(body),
      });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('returns 404 for an unknown session', async () => {
    const res = await app.request('/api/eval/sessions/nope/compliance', {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ rules: [{ id: 'x', type: 'max_cost', maxUsd: 1 }] }),
    });
    expect(res.status).toBe(404);
  });
});
