/**
 * Online LLM-judge scoring endpoint tests (#55 — Phase 2).
 *
 * POST /api/eval/sessions/:id/score runs the LLM judge over a session and chains
 * the (non-deterministic) judgment as a method:'llm_judge' eval_result. The chain
 * must still verify, the judge's cost must be captured, and the judgment must be
 * labelled as such (not as deterministic proof).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

/** Mock the Anthropic Messages API (tool-use structured output). */
function stubAnthropic(input: { score: number; reasoning: string }, usage = { input_tokens: 1200, output_tokens: 300 }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: [{ type: 'tool_use', id: 't', name: 'diagnostic_report', input }],
          usage,
          model: 'claude-haiku-4-5-20251001',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
}

describe('POST /api/eval/sessions/:id/score', () => {
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

    process.env['AGENTLENS_LLM_API_KEY'] = 'test-key';
    process.env['AGENTLENS_LLM_PROVIDER'] = 'anthropic';

    const events = [
      { sessionId: 'sess-1', agentId: 'agent-1', eventType: 'session_started', timestamp: '2026-01-01T00:00:01.000Z', payload: { agentName: 'a' } },
      { sessionId: 'sess-1', agentId: 'agent-1', eventType: 'tool_call', timestamp: '2026-01-01T00:00:02.000Z', payload: { toolName: 'send_email', callId: 'c1', arguments: { to: 'x@y.com' } } },
    ];
    const res = await app.request('/api/events', { method: 'POST', headers: auth(), body: JSON.stringify({ events }) });
    expect(res.status).toBe(201);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env['AGENTLENS_LLM_API_KEY'];
    delete process.env['AGENTLENS_LLM_PROVIDER'];
    delete process.env['AGENTLENS_LLM_BASE_URL'];
  });

  it('chains an llm_judge eval_result, captures cost, chain still verifies', async () => {
    stubAnthropic({ score: 0.4, reasoning: 'Agent emailed PII without authorization.' });

    const res = await app.request('/api/eval/sessions/sess-1/score', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ rubric: 'Did the agent leak PII?', passThreshold: 0.7 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.score).toBe(0.4);
    expect(body.passed).toBe(false);
    expect(body.model).toBe('claude-haiku-4-5-20251001');
    expect(body.costUsd).toBeGreaterThan(0);
    expect(body.tokenCount).toBe(1500);
    expect(body.event.hash).toBeDefined();

    const timeline = await store.getSessionTimeline('sess-1');
    expect(timeline).toHaveLength(3);
    const evalEvent = timeline.find((e) => e.eventType === 'eval_result');
    expect(evalEvent).toBeDefined();
    const p = evalEvent!.payload as any;
    expect(p.scorerType).toBe('llm_judge');
    expect(p.method).toBe('llm_judge'); // labelled as judgment, not proof
    expect(p.costUsd).toBeGreaterThan(0);

    expect(verifyChain(timeline as any).valid).toBe(true);
  });

  it('returns 503 when the judge is not configured', async () => {
    delete process.env['AGENTLENS_LLM_API_KEY'];
    const res = await app.request('/api/eval/sessions/sess-1/score', {
      method: 'POST', headers: auth(), body: JSON.stringify({ rubric: 'x' }),
    });
    expect(res.status).toBe(503);
  });

  it('returns 400 when rubric is missing', async () => {
    stubAnthropic({ score: 1, reasoning: 'ok' });
    const res = await app.request('/api/eval/sessions/sess-1/score', {
      method: 'POST', headers: auth(), body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown session', async () => {
    stubAnthropic({ score: 1, reasoning: 'ok' });
    const res = await app.request('/api/eval/sessions/nope/score', {
      method: 'POST', headers: auth(), body: JSON.stringify({ rubric: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 409 when the hash chain append fails (concurrent race)', async () => {
    stubAnthropic({ score: 0.5, reasoning: 'ok' });
    // Simulate a racing append: the chain-continuity insert throws.
    vi.spyOn(store, 'insertEvents').mockRejectedValueOnce(new Error('chain conflict'));
    const res = await app.request('/api/eval/sessions/sess-1/score', {
      method: 'POST', headers: auth(), body: JSON.stringify({ rubric: 'Did the agent leak PII?' }),
    });
    expect(res.status).toBe(409);
  });
});
