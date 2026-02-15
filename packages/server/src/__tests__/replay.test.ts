/**
 * Tests for Replay REST Endpoint + Performance (Stories 2.2, 2.3)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestApp, createApiKey, authHeaders, type TestContext } from './test-helpers.js';
import { replayCache } from '../routes/replay.js';
import type { Hono } from 'hono';

// ─── Helpers ───────────────────────────────────────────────

async function ingestEvents(app: Hono, apiKey: string, events: object[]) {
  return app.request('/api/events', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ events }),
  });
}

/** Build a minimal session with tool_call + tool_response events */
function makeSessionEvents(
  sessionId: string,
  agentId: string,
  count: number,
  opts?: { includeErrors?: boolean; includeLlm?: boolean },
) {
  const events: object[] = [];
  const baseTime = new Date('2026-01-01T10:00:00Z').getTime();

  events.push({
    sessionId,
    agentId,
    eventType: 'session_started',
    timestamp: new Date(baseTime).toISOString(),
    payload: { agentName: 'Test Agent', tags: [] },
  });

  for (let i = 0; i < count; i++) {
    const callId = `call-${i}`;
    events.push({
      sessionId,
      agentId,
      eventType: 'tool_call',
      timestamp: new Date(baseTime + (i + 1) * 1000).toISOString(),
      payload: { toolName: `tool_${i % 3}`, arguments: { idx: i }, callId },
    });
    if (opts?.includeErrors && i % 5 === 0) {
      events.push({
        sessionId,
        agentId,
        eventType: 'tool_error',
        timestamp: new Date(baseTime + (i + 1) * 1000 + 500).toISOString(),
        severity: 'error',
        payload: { callId, toolName: `tool_${i % 3}`, error: `Error at ${i}`, durationMs: 50 },
      });
    } else {
      events.push({
        sessionId,
        agentId,
        eventType: 'tool_response',
        timestamp: new Date(baseTime + (i + 1) * 1000 + 500).toISOString(),
        payload: { callId, toolName: `tool_${i % 3}`, result: { ok: true }, durationMs: 50 },
      });
    }
  }

  if (opts?.includeLlm) {
    for (let i = 0; i < 5; i++) {
      const llmCallId = `llm-${i}`;
      events.push({
        sessionId,
        agentId,
        eventType: 'llm_call',
        timestamp: new Date(baseTime + (count + i + 1) * 1000).toISOString(),
        payload: {
          callId: llmCallId,
          provider: 'openai',
          model: 'gpt-4o',
          messages: [{ role: 'user', content: `Question ${i}` }],
        },
      });
      events.push({
        sessionId,
        agentId,
        eventType: 'llm_response',
        timestamp: new Date(baseTime + (count + i + 1) * 1000 + 200).toISOString(),
        payload: {
          callId: llmCallId,
          provider: 'openai',
          model: 'gpt-4o',
          completion: `Answer ${i}`,
          usage: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
          costUsd: 0.001,
          latencyMs: 200,
          finishReason: 'stop',
        },
      });
    }
  }

  events.push({
    sessionId,
    agentId,
    eventType: 'session_ended',
    timestamp: new Date(baseTime + (count + 10) * 1000).toISOString(),
    payload: { reason: 'completed', summary: 'Done' },
  });

  return events;
}

// ─── Story 2.2: Replay REST Endpoint ──────────────────────

describe('Story 2.2: Replay REST Endpoint', () => {
  let ctx: TestContext;
  let app: Hono;
  let apiKey: string;

  beforeEach(async () => {
    replayCache.clear();
    ctx = await createTestApp();
    app = ctx.app;
    apiKey = ctx.apiKey;

    // Seed a session with 10 tool calls (21 events: started + 10*(call+response) + ended)
    const events = makeSessionEvents('sess-1', 'agent-1', 10, {
      includeErrors: true,
      includeLlm: true,
    });
    await ingestEvents(app, apiKey, events);
  });

  afterEach(() => {
    replayCache.clear();
  });

  it('returns 200 with ReplayState for a valid session', async () => {
    const res = await app.request('/api/sessions/sess-1/replay', {
      headers: authHeaders(apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.session).toBeDefined();
    expect(body.session.id).toBe('sess-1');
    expect(body.chainValid).toBe(true);
    expect(body.totalSteps).toBeGreaterThan(0);
    expect(body.steps).toBeInstanceOf(Array);
    expect(body.steps.length).toBeGreaterThan(0);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.offset).toBe(0);
    expect(body.pagination.limit).toBe(1000);
    expect(body.summary).toBeDefined();
    expect(body.summary.totalToolCalls).toBe(10);
  });

  it('returns 404 for session not found', async () => {
    const res = await app.request('/api/sessions/nonexistent/replay', {
      headers: authHeaders(apiKey),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Session not found');
  });

  it('returns 400 for invalid offset (negative)', async () => {
    const res = await app.request('/api/sessions/sess-1/replay?offset=-1', {
      headers: authHeaders(apiKey),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('offset');
  });

  it('returns 400 for invalid limit (0 or > 5000)', async () => {
    const res1 = await app.request('/api/sessions/sess-1/replay?limit=0', {
      headers: authHeaders(apiKey),
    });
    expect(res1.status).toBe(400);

    const res2 = await app.request('/api/sessions/sess-1/replay?limit=5001', {
      headers: authHeaders(apiKey),
    });
    expect(res2.status).toBe(400);

    const res3 = await app.request('/api/sessions/sess-1/replay?limit=abc', {
      headers: authHeaders(apiKey),
    });
    expect(res3.status).toBe(400);
  });

  it('returns 400 for invalid eventTypes', async () => {
    const res = await app.request('/api/sessions/sess-1/replay?eventTypes=bogus_type', {
      headers: authHeaders(apiKey),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid event type');
  });

  it('supports pagination with offset and limit', async () => {
    const res = await app.request('/api/sessions/sess-1/replay?offset=0&limit=5', {
      headers: authHeaders(apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.steps.length).toBe(5);
    expect(body.pagination.offset).toBe(0);
    expect(body.pagination.limit).toBe(5);
    expect(body.pagination.hasMore).toBe(true);

    // summary is always present even when paginating
    expect(body.summary).toBeDefined();
    expect(body.summary.totalToolCalls).toBe(10);

    // Fetch next page
    const res2 = await app.request('/api/sessions/sess-1/replay?offset=5&limit=5', {
      headers: authHeaders(apiKey),
    });
    const body2 = await res2.json();
    expect(body2.steps.length).toBe(5);
    expect(body2.steps[0].index).toBe(5);
  });

  it('filters events by eventTypes query param', async () => {
    const res = await app.request(
      '/api/sessions/sess-1/replay?eventTypes=tool_call',
      { headers: authHeaders(apiKey) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();

    // All returned steps should be tool_call events
    for (const step of body.steps) {
      expect(step.event.eventType).toBe('tool_call');
    }
    expect(body.totalSteps).toBe(10); // exactly 10 tool_call events

    // summary still reflects all events
    expect(body.summary.totalToolCalls).toBe(10);
  });

  it('returns 401 when no auth provided', async () => {
    const res = await app.request('/api/sessions/sess-1/replay');
    expect(res.status).toBe(401);
  });

  it('enforces tenant isolation', async () => {
    // Create a separate tenant with its own session
    const tenant2Key = createApiKey(ctx.db, { tenantId: 'tenant-2' });
    const events2 = makeSessionEvents('sess-t2', 'agent-t2', 3);
    await ingestEvents(app, tenant2Key, events2);

    // tenant-2 cannot see tenant-1 sessions
    const res = await app.request('/api/sessions/sess-1/replay', {
      headers: authHeaders(tenant2Key),
    });
    expect(res.status).toBe(404);

    // tenant-2 can see its own session
    const res2 = await app.request('/api/sessions/sess-t2/replay', {
      headers: authHeaders(tenant2Key),
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.session.id).toBe('sess-t2');
  });

  it('supports includeContext=false', async () => {
    const res = await app.request(
      '/api/sessions/sess-1/replay?includeContext=false',
      { headers: authHeaders(apiKey) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();

    // Context should be empty (default values)
    for (const step of body.steps) {
      expect(step.context.eventIndex).toBe(0);
      expect(step.context.llmHistory).toEqual([]);
      expect(step.context.toolResults).toEqual([]);
    }
  });
});

// ─── Story 2.3: Replay Performance — Pagination & Caching ─

describe('Story 2.3: Replay Performance — Pagination & Caching', () => {
  let ctx: TestContext;
  let app: Hono;
  let apiKey: string;

  beforeEach(async () => {
    replayCache.clear();
    ctx = await createTestApp();
    app = ctx.app;
    apiKey = ctx.apiKey;
  });

  afterEach(() => {
    replayCache.clear();
  });

  it('caches replay state on first request (cache miss → cache hit)', async () => {
    const events = makeSessionEvents('sess-cache', 'agent-1', 5);
    await ingestEvents(app, apiKey, events);

    // First request — cache miss
    expect(replayCache.size).toBe(0);
    const res1 = await app.request('/api/sessions/sess-cache/replay', {
      headers: authHeaders(apiKey),
    });
    expect(res1.status).toBe(200);
    expect(replayCache.size).toBe(1);

    // Second request — cache should still exist
    const res2 = await app.request('/api/sessions/sess-cache/replay', {
      headers: authHeaders(apiKey),
    });
    expect(res2.status).toBe(200);
    expect(replayCache.size).toBe(1);
  });

  it('cache respects TTL expiry', async () => {
    const events = makeSessionEvents('sess-ttl', 'agent-1', 3);
    await ingestEvents(app, apiKey, events);

    // Populate cache
    const res1 = await app.request('/api/sessions/sess-ttl/replay', {
      headers: authHeaders(apiKey),
    });
    expect(res1.status).toBe(200);
    expect(replayCache.size).toBe(1);

    // Manually expire the cache entry
    const key = 'default:sess-ttl';
    const entry = replayCache.get(key);
    expect(entry).toBeDefined();
    entry!.createdAt = Date.now() - 11 * 60 * 1000; // 11 minutes ago

    // Next request should find expired entry and rebuild
    const res2 = await app.request('/api/sessions/sess-ttl/replay', {
      headers: authHeaders(apiKey),
    });
    expect(res2.status).toBe(200);
    // Cache should have a fresh entry now
    const newEntry = replayCache.get(key);
    expect(newEntry).toBeDefined();
    expect(Date.now() - newEntry!.createdAt).toBeLessThan(5000);
  });

  it('cache evicts oldest entry when at max capacity', async () => {
    // Seed one session for our test
    const events = makeSessionEvents('sess-evict', 'agent-1', 2);
    await ingestEvents(app, apiKey, events);

    // Fill cache to max
    for (let i = 0; i < 100; i++) {
      replayCache.set(`fake-tenant:fake-sess-${i}`, {
        state: {} as any,
        createdAt: Date.now(),
      });
    }
    expect(replayCache.size).toBe(100);

    // Request should evict oldest and add new entry
    await app.request('/api/sessions/sess-evict/replay', {
      headers: authHeaders(apiKey),
    });
    expect(replayCache.size).toBe(100); // still at max
    expect(replayCache.has('default:sess-evict')).toBe(true);
    // The first entry should have been evicted
    expect(replayCache.has('fake-tenant:fake-sess-0')).toBe(false);
  });

  it('pagination returns correct slices', async () => {
    const events = makeSessionEvents('sess-page', 'agent-1', 20);
    await ingestEvents(app, apiKey, events);

    // Get total count first
    const resAll = await app.request('/api/sessions/sess-page/replay', {
      headers: authHeaders(apiKey),
    });
    const allBody = await resAll.json();
    const totalSteps = allBody.totalSteps;

    // Page 1
    const res1 = await app.request('/api/sessions/sess-page/replay?offset=0&limit=10', {
      headers: authHeaders(apiKey),
    });
    const body1 = await res1.json();
    expect(body1.steps.length).toBe(10);
    expect(body1.steps[0].index).toBe(0);
    expect(body1.steps[9].index).toBe(9);
    expect(body1.pagination.hasMore).toBe(true);

    // Page 2
    const res2 = await app.request('/api/sessions/sess-page/replay?offset=10&limit=10', {
      headers: authHeaders(apiKey),
    });
    const body2 = await res2.json();
    expect(body2.steps[0].index).toBe(10);

    // Summary always included
    expect(body1.summary.totalToolCalls).toBe(20);
    expect(body2.summary.totalToolCalls).toBe(20);
  });

  it('caps LLM history in context to last 50 entries (memory guard)', async () => {
    // Build a session with many LLM calls
    const sessionId = 'sess-llm-cap';
    const agentId = 'agent-1';
    const baseTime = new Date('2026-01-01T10:00:00Z').getTime();
    const events: object[] = [];

    events.push({
      sessionId,
      agentId,
      eventType: 'session_started',
      timestamp: new Date(baseTime).toISOString(),
      payload: { agentName: 'Test Agent', tags: [] },
    });

    // 60 LLM call/response pairs
    for (let i = 0; i < 60; i++) {
      const callId = `llm-cap-${i}`;
      events.push({
        sessionId,
        agentId,
        eventType: 'llm_call',
        timestamp: new Date(baseTime + (i + 1) * 1000).toISOString(),
        payload: {
          callId,
          provider: 'openai',
          model: 'gpt-4o',
          messages: [{ role: 'user', content: `Q${i}` }],
        },
      });
      events.push({
        sessionId,
        agentId,
        eventType: 'llm_response',
        timestamp: new Date(baseTime + (i + 1) * 1000 + 200).toISOString(),
        payload: {
          callId,
          provider: 'openai',
          model: 'gpt-4o',
          completion: `A${i}`,
          usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          costUsd: 0.001,
          latencyMs: 200,
          finishReason: 'stop',
        },
      });
    }

    events.push({
      sessionId,
      agentId,
      eventType: 'session_ended',
      timestamp: new Date(baseTime + 70000).toISOString(),
      payload: { reason: 'completed', summary: 'Done' },
    });

    await ingestEvents(app, apiKey, events);

    const res = await app.request('/api/sessions/sess-llm-cap/replay', {
      headers: authHeaders(apiKey),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    // The last step should have at most 50 LLM history entries
    const lastStep = body.steps[body.steps.length - 1];
    expect(lastStep.context.llmHistory.length).toBeLessThanOrEqual(50);
  });

  it('handles large sessions (> 5000 events) with enforced pagination', async () => {
    // We won't actually create 5000+ events in tests (too slow with hash chain),
    // but we'll create a moderate session and verify pagination logic works correctly
    const events = makeSessionEvents('sess-large', 'agent-1', 50);
    await ingestEvents(app, apiKey, events);

    // Request with small limit
    const res = await app.request(
      '/api/sessions/sess-large/replay?offset=0&limit=10',
      { headers: authHeaders(apiKey) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.steps.length).toBe(10);
    expect(body.pagination.hasMore).toBe(true);
    expect(body.pagination.offset).toBe(0);
    expect(body.pagination.limit).toBe(10);

    // Verify total includes all events
    expect(body.totalSteps).toBeGreaterThan(10);

    // Verify we can reach the end
    const resEnd = await app.request(
      `/api/sessions/sess-large/replay?offset=${body.totalSteps - 5}&limit=10`,
      { headers: authHeaders(apiKey) },
    );
    const bodyEnd = await resEnd.json();
    expect(bodyEnd.pagination.hasMore).toBe(false);
    expect(bodyEnd.steps.length).toBeLessThanOrEqual(5);
  });
});
