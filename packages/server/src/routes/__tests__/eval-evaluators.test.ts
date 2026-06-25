/**
 * Evaluator catalog API + instantiation (#55 Phase 4).
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
import { EvaluatorStore } from '../../db/evaluator-store.js';
import { BUILTIN_EVALUATORS } from '../../lib/eval/builtin-evaluators.js';
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
  db.insert(apiKeys).values({ id: 'key-1', keyHash: hashApiKey(rawKey), name: 'Test Key', scopes: JSON.stringify(['*']), createdAt: Math.floor(Date.now() / 1000), tenantId: 'default', role: 'editor' }).run();
  return rawKey;
}

describe('evaluator catalog API', () => {
  let db: any, store: SqliteEventStore, app: any, apiKey: string;
  const auth = () => ({ Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' });

  beforeEach(async () => {
    db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    app = createApp(db, store);
    apiKey = seedApiKey(db);
    new EvaluatorStore(db).seedBuiltins(BUILTIN_EVALUATORS); // registration does this in prod
    // a session that calls a denied tool
    await app.request('/api/events', { method: 'POST', headers: auth(), body: JSON.stringify({ events: [
      { sessionId: 'sess-1', agentId: 'agt_a', eventType: 'session_started', timestamp: '2026-01-01T00:00:01.000Z', payload: { agentName: 'a' } },
      { sessionId: 'sess-1', agentId: 'agt_a', eventType: 'tool_call', timestamp: '2026-01-01T00:00:02.000Z', payload: { toolName: 'delete_db', callId: 'c1', arguments: {} } },
    ] }) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['AGENTLENS_LLM_API_KEY'];
    delete process.env['AGENTLENS_LLM_PROVIDER'];
  });

  it('lists built-ins and supports CRUD + publish/verify lifecycle', async () => {
    const list = await (await app.request('/api/eval/evaluators', { headers: auth() })).json();
    expect(list.evaluators.length).toBe(BUILTIN_EVALUATORS.length);

    const created = await app.request('/api/eval/evaluators', { method: 'POST', headers: auth(), body: JSON.stringify({
      name: 'My denylist', scorerType: 'compliance', configTemplate: { rules: [{ id: 'no_delete', type: 'tool_denylist', tools: ['delete_*'] }] }, tags: ['custom'],
    }) });
    expect(created.status).toBe(201);
    const ev = await created.json();
    expect(ev.status).toBe('draft');

    expect((await app.request(`/api/eval/evaluators/${ev.id}`, { method: 'PUT', headers: auth(), body: JSON.stringify({ description: 'updated' }) })).status).toBe(200);
    const pub = await (await app.request(`/api/eval/evaluators/${ev.id}/publish`, { method: 'POST', headers: auth() })).json();
    expect(pub.status).toBe('published');
    const ver = await (await app.request(`/api/eval/evaluators/${ev.id}/verify`, { method: 'POST', headers: auth() })).json();
    expect(ver.verifiedAt).toBeDefined();
    expect((await app.request(`/api/eval/evaluators/${ev.id}`, { method: 'DELETE', headers: auth() })).status).toBe(204);
  });

  it('refuses to edit or delete a read-only built-in (404)', async () => {
    expect((await app.request('/api/eval/evaluators/builtin:pii-no-exfil', { method: 'PUT', headers: auth(), body: JSON.stringify({ name: 'x' }) })).status).toBe(404);
    expect((await app.request('/api/eval/evaluators/builtin:pii-no-exfil', { method: 'DELETE', headers: auth() })).status).toBe(404);
  });

  it('rejects an invalid configTemplate at create (compliance needs rules)', async () => {
    const res = await app.request('/api/eval/evaluators', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'bad', scorerType: 'compliance', configTemplate: {} }) });
    expect(res.status).toBe(400);
  });

  it('instantiates a compliance evaluator by id on /compliance (deterministic)', async () => {
    const ev = await (await app.request('/api/eval/evaluators', { method: 'POST', headers: auth(), body: JSON.stringify({
      name: 'no delete', scorerType: 'compliance', configTemplate: { rules: [{ id: 'no_delete', type: 'tool_denylist', tools: ['delete_*'] }] },
    }) })).json();

    const res = await app.request('/api/eval/sessions/sess-1/compliance', { method: 'POST', headers: auth(), body: JSON.stringify({ evaluatorId: ev.id }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.passed).toBe(false);
    expect(body.violations[0].ruleId).toBe('no_delete');

    const timeline = await store.getSessionTimeline('sess-1');
    const evalEvent = timeline.find((e) => e.eventType === 'eval_result')!;
    expect((evalEvent.metadata as any).evaluatorId).toBe(ev.id);
    expect(verifyChain(timeline as any).valid).toBe(true);
  });

  it('rejects a scorer-type mismatch (llm_judge evaluator on /compliance)', async () => {
    const res = await app.request('/api/eval/sessions/sess-1/compliance', { method: 'POST', headers: auth(), body: JSON.stringify({ evaluatorId: 'builtin:pii-leak-judge' }) });
    expect(res.status).toBe(400);
  });

  it('404s an unknown evaluatorId', async () => {
    const res = await app.request('/api/eval/sessions/sess-1/compliance', { method: 'POST', headers: auth(), body: JSON.stringify({ evaluatorId: 'nope' }) });
    expect(res.status).toBe(404);
  });

  it('isolates evaluators across tenants (B cannot see/edit A; built-ins are shared)', async () => {
    const rawB = 'als_tenantb_key_1234567890abcdef1234567890ab';
    db.insert(apiKeys).values({ id: 'key-b', keyHash: hashApiKey(rawB), name: 'B', scopes: JSON.stringify(['*']), createdAt: Math.floor(Date.now() / 1000), tenantId: 'tenant-b', role: 'editor' }).run();
    const authB = () => ({ Authorization: `Bearer ${rawB}`, 'Content-Type': 'application/json' });

    const ev = await (await app.request('/api/eval/evaluators', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'A-only', scorerType: 'compliance', configTemplate: { rules: [{ id: 'r', type: 'tool_denylist', tools: ['x'] }] } }) })).json();

    expect((await app.request(`/api/eval/evaluators/${ev.id}`, { headers: authB() })).status).toBe(404);
    expect((await app.request(`/api/eval/evaluators/${ev.id}`, { method: 'PUT', headers: authB(), body: JSON.stringify({ name: 'hijack' }) })).status).toBe(404);
    expect((await app.request(`/api/eval/evaluators/${ev.id}`, { method: 'DELETE', headers: authB() })).status).toBe(404);
    const bList = await (await app.request('/api/eval/evaluators', { headers: authB() })).json();
    expect(bList.evaluators.some((e: any) => e.id === ev.id)).toBe(false);
    expect(bList.evaluators.length).toBe(BUILTIN_EVALUATORS.length); // B sees only the global built-ins
  });

  it('forces configTemplate.type to match scorerType (caller cannot override it)', async () => {
    const ev = await (await app.request('/api/eval/evaluators', { method: 'POST', headers: auth(), body: JSON.stringify({
      name: 'x', scorerType: 'compliance', configTemplate: { type: 'llm_judge', rules: [{ id: 'r', type: 'tool_denylist', tools: ['x'] }] },
    }) })).json();
    expect(ev.scorerType).toBe('compliance');
    expect(ev.configTemplate.type).toBe('compliance'); // caller's 'llm_judge' was overridden
  });

  it('rejects a whitespace-only regex pattern', async () => {
    const res = await app.request('/api/eval/evaluators', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'r', scorerType: 'regex', configTemplate: { pattern: '   ' } }) });
    expect(res.status).toBe(400);
  });

  it('accepts {rules:[], evaluatorId} on /compliance (evaluatorId provides the rules)', async () => {
    const ev = await (await app.request('/api/eval/evaluators', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'nd', scorerType: 'compliance', configTemplate: { rules: [{ id: 'no_delete', type: 'tool_denylist', tools: ['delete_*'] }] } }) })).json();
    const res = await app.request('/api/eval/sessions/sess-1/compliance', { method: 'POST', headers: auth(), body: JSON.stringify({ rules: [], evaluatorId: ev.id }) });
    expect(res.status).toBe(201);
    expect((await res.json()).passed).toBe(false);
  });

  it('filters by status (draft vs published)', async () => {
    const draft = await (await app.request('/api/eval/evaluators', { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'd', scorerType: 'compliance', configTemplate: { rules: [{ id: 'r', type: 'tool_denylist', tools: ['x'] }] } }) })).json();
    const published = await (await app.request('/api/eval/evaluators?status=published', { headers: auth() })).json();
    expect(published.evaluators.some((e: any) => e.id === draft.id)).toBe(false);
    expect(published.evaluators.length).toBe(BUILTIN_EVALUATORS.length);
    const drafts = await (await app.request('/api/eval/evaluators?status=draft', { headers: auth() })).json();
    expect(drafts.evaluators.some((e: any) => e.id === draft.id)).toBe(true);
  });

  it('instantiates an llm_judge evaluator by id on /score (rubric from the catalog)', async () => {
    process.env['AGENTLENS_LLM_API_KEY'] = 'test-key';
    process.env['AGENTLENS_LLM_PROVIDER'] = 'anthropic';
    const captured: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      captured.push(JSON.parse(init.body).messages[0].content);
      return new Response(JSON.stringify({ content: [{ type: 'tool_use', id: 't', name: 'diagnostic_report', input: { score: 0.4, reasoning: 'leaked' } }], usage: { input_tokens: 10, output_tokens: 5 }, model: 'claude-haiku-4-5-20251001' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    const res = await app.request('/api/eval/sessions/sess-1/score', { method: 'POST', headers: auth(), body: JSON.stringify({ evaluatorId: 'builtin:pii-leak-judge' }) });
    expect(res.status).toBe(201);
    expect((await res.json()).score).toBe(0.4);
    // the judge prompt carried the built-in evaluator's rubric
    expect(captured[0]).toContain('disclose any personal data');
    const evalEvent = (await store.getSessionTimeline('sess-1')).find((e) => e.eventType === 'eval_result')!;
    expect((evalEvent.metadata as any).evaluatorId).toBe('builtin:pii-leak-judge');
  });
});
