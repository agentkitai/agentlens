/**
 * Tests for Epic 2: LLM Call Tracking — Server Ingest & Storage
 *
 * Stories covered:
 * - 2.1: Session materialization for LLM events
 * - 2.2: LLM-specific analytics queries
 * - 2.3: Server-side tests (this file)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, authHeaders } from './test-helpers.js';
import type { Hono } from 'hono';

async function ingestEvents(app: Hono, apiKey: string, events: object[]) {
  return app.request('/api/events', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ events }),
  });
}

// ─── Helper: Create a standard llm_call event payload ──────────
function makeLlmCallPayload(callId: string, opts?: { provider?: string; model?: string }) {
  return {
    callId,
    provider: opts?.provider ?? 'anthropic',
    model: opts?.model ?? 'claude-sonnet-4-20250514',
    messages: [
      { role: 'user', content: 'Hello, how are you?' },
    ],
  };
}

// ─── Helper: Create a standard llm_response event payload ──────
function makeLlmResponsePayload(
  callId: string,
  opts?: {
    provider?: string;
    model?: string;
    costUsd?: number;
    latencyMs?: number;
    inputTokens?: number;
    outputTokens?: number;
  },
) {
  return {
    callId,
    provider: opts?.provider ?? 'anthropic',
    model: opts?.model ?? 'claude-sonnet-4-20250514',
    completion: 'I am doing well, thank you for asking!',
    finishReason: 'stop',
    usage: {
      inputTokens: opts?.inputTokens ?? 100,
      outputTokens: opts?.outputTokens ?? 50,
      totalTokens: (opts?.inputTokens ?? 100) + (opts?.outputTokens ?? 50),
    },
    costUsd: opts?.costUsd ?? 0.005,
    latencyMs: opts?.latencyMs ?? 1200,
  };
}

describe('LLM Call Tracking — Server Ingest & Storage (Epic 2)', () => {
  let app: Hono;
  let apiKey: string;

  beforeEach(() => {
    const ctx = createTestApp();
    app = ctx.app;
    apiKey = ctx.apiKey;
  });

  // ─── Story 2.1 + 2.3: Ingesting llm_call events ────────────

  describe('Ingesting llm_call events', () => {
    it('accepts a valid llm_call event', async () => {
      const res = await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_llm_001',
          agentId: 'agent_001',
          eventType: 'llm_call',
          timestamp: '2026-02-08T10:00:00Z',
          payload: makeLlmCallPayload('call-1'),
        },
      ]);

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ingested).toBe(1);
    });

    it('rejects llm_call with missing callId', async () => {
      const res = await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_llm_001',
          agentId: 'agent_001',
          eventType: 'llm_call',
          payload: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-20250514',
            messages: [{ role: 'user', content: 'hi' }],
            // missing callId
          },
        },
      ]);

      expect(res.status).toBe(400);
    });

    it('rejects llm_call with empty messages array', async () => {
      const res = await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_llm_001',
          agentId: 'agent_001',
          eventType: 'llm_call',
          payload: {
            callId: 'call-1',
            provider: 'anthropic',
            model: 'claude-sonnet-4-20250514',
            messages: [], // must have at least 1
          },
        },
      ]);

      expect(res.status).toBe(400);
    });
  });

  // ─── Story 2.1 + 2.3: Ingesting llm_response events ────────

  describe('Ingesting llm_response events', () => {
    it('accepts a valid llm_response event', async () => {
      const res = await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_llm_001',
          agentId: 'agent_001',
          eventType: 'llm_response',
          timestamp: '2026-02-08T10:00:01Z',
          payload: makeLlmResponsePayload('call-1'),
        },
      ]);

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ingested).toBe(1);
    });

    it('rejects llm_response with missing usage', async () => {
      const res = await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_llm_001',
          agentId: 'agent_001',
          eventType: 'llm_response',
          payload: {
            callId: 'call-1',
            provider: 'anthropic',
            model: 'claude-sonnet-4-20250514',
            completion: 'Hello',
            finishReason: 'stop',
            // missing usage, costUsd, latencyMs
          },
        },
      ]);

      expect(res.status).toBe(400);
    });
  });

  // ─── Story 2.1 + 2.3: callId pairing ───────────────────────

  describe('callId pairing', () => {
    it('ingests paired llm_call and llm_response with matching callId', async () => {
      const callId = 'paired-call-001';

      const res = await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_llm_pair',
          agentId: 'agent_001',
          eventType: 'session_started',
          timestamp: '2026-02-08T10:00:00Z',
          payload: { agentName: 'Pair Agent', tags: [] },
        },
        {
          sessionId: 'sess_llm_pair',
          agentId: 'agent_001',
          eventType: 'llm_call',
          timestamp: '2026-02-08T10:00:01Z',
          payload: makeLlmCallPayload(callId),
        },
        {
          sessionId: 'sess_llm_pair',
          agentId: 'agent_001',
          eventType: 'llm_response',
          timestamp: '2026-02-08T10:00:02Z',
          payload: makeLlmResponsePayload(callId),
        },
      ]);

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ingested).toBe(3);

      // Retrieve the timeline and check callId pairing
      const timelineRes = await app.request('/api/sessions/sess_llm_pair/timeline', {
        headers: authHeaders(apiKey),
      });
      const timeline = await timelineRes.json();
      const llmEvents = timeline.events.filter(
        (e: { eventType: string }) => e.eventType === 'llm_call' || e.eventType === 'llm_response',
      );
      expect(llmEvents).toHaveLength(2);
      expect(llmEvents[0].payload.callId).toBe(callId);
      expect(llmEvents[1].payload.callId).toBe(callId);
    });

    it('supports multiple paired LLM calls in a single session', async () => {
      const res = await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_multi_llm',
          agentId: 'agent_001',
          eventType: 'session_started',
          timestamp: '2026-02-08T10:00:00Z',
          payload: { tags: [] },
        },
        {
          sessionId: 'sess_multi_llm',
          agentId: 'agent_001',
          eventType: 'llm_call',
          timestamp: '2026-02-08T10:00:01Z',
          payload: makeLlmCallPayload('call-a'),
        },
        {
          sessionId: 'sess_multi_llm',
          agentId: 'agent_001',
          eventType: 'llm_response',
          timestamp: '2026-02-08T10:00:02Z',
          payload: makeLlmResponsePayload('call-a'),
        },
        {
          sessionId: 'sess_multi_llm',
          agentId: 'agent_001',
          eventType: 'llm_call',
          timestamp: '2026-02-08T10:00:03Z',
          payload: makeLlmCallPayload('call-b', { model: 'gpt-4o', provider: 'openai' }),
        },
        {
          sessionId: 'sess_multi_llm',
          agentId: 'agent_001',
          eventType: 'llm_response',
          timestamp: '2026-02-08T10:00:04Z',
          payload: makeLlmResponsePayload('call-b', { model: 'gpt-4o', provider: 'openai' }),
        },
      ]);

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ingested).toBe(5);
    });
  });

  // ─── Story 2.1 + 2.3: Session materialization ──────────────

  describe('Session materialization from LLM events', () => {
    it('increments llmCallCount on llm_response ingest', async () => {
      await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_mat_001',
          agentId: 'agent_001',
          eventType: 'session_started',
          timestamp: '2026-02-08T10:00:00Z',
          payload: { tags: [] },
        },
        {
          sessionId: 'sess_mat_001',
          agentId: 'agent_001',
          eventType: 'llm_call',
          timestamp: '2026-02-08T10:00:01Z',
          payload: makeLlmCallPayload('call-1'),
        },
        {
          sessionId: 'sess_mat_001',
          agentId: 'agent_001',
          eventType: 'llm_response',
          timestamp: '2026-02-08T10:00:02Z',
          payload: makeLlmResponsePayload('call-1'),
        },
      ]);

      const sessionRes = await app.request('/api/sessions/sess_mat_001', {
        headers: authHeaders(apiKey),
      });
      const session = await sessionRes.json();

      expect(session.llmCallCount).toBe(1);
    });

    it('accumulates totalInputTokens and totalOutputTokens', async () => {
      await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_mat_002',
          agentId: 'agent_001',
          eventType: 'session_started',
          timestamp: '2026-02-08T10:00:00Z',
          payload: { tags: [] },
        },
        {
          sessionId: 'sess_mat_002',
          agentId: 'agent_001',
          eventType: 'llm_response',
          timestamp: '2026-02-08T10:00:01Z',
          payload: makeLlmResponsePayload('call-1', {
            inputTokens: 200,
            outputTokens: 80,
          }),
        },
        {
          sessionId: 'sess_mat_002',
          agentId: 'agent_001',
          eventType: 'llm_response',
          timestamp: '2026-02-08T10:00:02Z',
          payload: makeLlmResponsePayload('call-2', {
            inputTokens: 300,
            outputTokens: 120,
          }),
        },
      ]);

      const sessionRes = await app.request('/api/sessions/sess_mat_002', {
        headers: authHeaders(apiKey),
      });
      const session = await sessionRes.json();

      expect(session.llmCallCount).toBe(2);
      expect(session.totalInputTokens).toBe(500);
      expect(session.totalOutputTokens).toBe(200);
    });

    it('accumulates totalCostUsd from llm_response events', async () => {
      await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_mat_003',
          agentId: 'agent_001',
          eventType: 'session_started',
          timestamp: '2026-02-08T10:00:00Z',
          payload: { tags: [] },
        },
        {
          sessionId: 'sess_mat_003',
          agentId: 'agent_001',
          eventType: 'llm_response',
          timestamp: '2026-02-08T10:00:01Z',
          payload: makeLlmResponsePayload('call-1', { costUsd: 0.01 }),
        },
        {
          sessionId: 'sess_mat_003',
          agentId: 'agent_001',
          eventType: 'llm_response',
          timestamp: '2026-02-08T10:00:02Z',
          payload: makeLlmResponsePayload('call-2', { costUsd: 0.02 }),
        },
      ]);

      const sessionRes = await app.request('/api/sessions/sess_mat_003', {
        headers: authHeaders(apiKey),
      });
      const session = await sessionRes.json();

      expect(session.totalCostUsd).toBeCloseTo(0.03, 3);
    });

    it('both cost_tracked and llm_response accumulate into totalCostUsd', async () => {
      await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_mat_004',
          agentId: 'agent_001',
          eventType: 'session_started',
          timestamp: '2026-02-08T10:00:00Z',
          payload: { tags: [] },
        },
        {
          sessionId: 'sess_mat_004',
          agentId: 'agent_001',
          eventType: 'cost_tracked',
          timestamp: '2026-02-08T10:00:01Z',
          payload: {
            provider: 'openai',
            model: 'gpt-4',
            inputTokens: 50,
            outputTokens: 25,
            totalTokens: 75,
            costUsd: 0.005,
          },
        },
        {
          sessionId: 'sess_mat_004',
          agentId: 'agent_001',
          eventType: 'llm_response',
          timestamp: '2026-02-08T10:00:02Z',
          payload: makeLlmResponsePayload('call-1', { costUsd: 0.01 }),
        },
      ]);

      const sessionRes = await app.request('/api/sessions/sess_mat_004', {
        headers: authHeaders(apiKey),
      });
      const session = await sessionRes.json();

      expect(session.totalCostUsd).toBeCloseTo(0.015, 3);
    });

    it('session without LLM events shows zero for LLM fields', async () => {
      await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_mat_005',
          agentId: 'agent_001',
          eventType: 'session_started',
          timestamp: '2026-02-08T10:00:00Z',
          payload: { tags: [] },
        },
        {
          sessionId: 'sess_mat_005',
          agentId: 'agent_001',
          eventType: 'tool_call',
          timestamp: '2026-02-08T10:00:01Z',
          payload: { toolName: 'search', arguments: {}, callId: 'tc1' },
        },
      ]);

      const sessionRes = await app.request('/api/sessions/sess_mat_005', {
        headers: authHeaders(apiKey),
      });
      const session = await sessionRes.json();

      expect(session.llmCallCount).toBe(0);
      expect(session.totalInputTokens).toBe(0);
      expect(session.totalOutputTokens).toBe(0);
    });
  });

  // ─── Story 2.2 + 2.3: LLM Analytics endpoint ──────────────

  describe('GET /api/analytics/llm', () => {
    beforeEach(async () => {
      // Seed LLM events across two agents, two models
      await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_anl_001',
          agentId: 'agent_alpha',
          eventType: 'session_started',
          timestamp: '2026-02-08T10:00:00Z',
          payload: { agentName: 'Agent Alpha', tags: [] },
        },
        {
          sessionId: 'sess_anl_001',
          agentId: 'agent_alpha',
          eventType: 'llm_call',
          timestamp: '2026-02-08T10:00:01Z',
          payload: makeLlmCallPayload('anl-call-1', { provider: 'anthropic', model: 'claude-sonnet-4-20250514' }),
        },
        {
          sessionId: 'sess_anl_001',
          agentId: 'agent_alpha',
          eventType: 'llm_response',
          timestamp: '2026-02-08T10:00:02Z',
          payload: makeLlmResponsePayload('anl-call-1', {
            provider: 'anthropic',
            model: 'claude-sonnet-4-20250514',
            costUsd: 0.01,
            latencyMs: 1000,
            inputTokens: 100,
            outputTokens: 50,
          }),
        },
        {
          sessionId: 'sess_anl_001',
          agentId: 'agent_alpha',
          eventType: 'llm_call',
          timestamp: '2026-02-08T11:00:01Z',
          payload: makeLlmCallPayload('anl-call-2', { provider: 'openai', model: 'gpt-4o' }),
        },
        {
          sessionId: 'sess_anl_001',
          agentId: 'agent_alpha',
          eventType: 'llm_response',
          timestamp: '2026-02-08T11:00:02Z',
          payload: makeLlmResponsePayload('anl-call-2', {
            provider: 'openai',
            model: 'gpt-4o',
            costUsd: 0.02,
            latencyMs: 800,
            inputTokens: 200,
            outputTokens: 100,
          }),
        },
      ]);

      await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_anl_002',
          agentId: 'agent_beta',
          eventType: 'session_started',
          timestamp: '2026-02-08T12:00:00Z',
          payload: { agentName: 'Agent Beta', tags: [] },
        },
        {
          sessionId: 'sess_anl_002',
          agentId: 'agent_beta',
          eventType: 'llm_call',
          timestamp: '2026-02-08T12:00:01Z',
          payload: makeLlmCallPayload('anl-call-3', { provider: 'anthropic', model: 'claude-sonnet-4-20250514' }),
        },
        {
          sessionId: 'sess_anl_002',
          agentId: 'agent_beta',
          eventType: 'llm_response',
          timestamp: '2026-02-08T12:00:02Z',
          payload: makeLlmResponsePayload('anl-call-3', {
            provider: 'anthropic',
            model: 'claude-sonnet-4-20250514',
            costUsd: 0.015,
            latencyMs: 1500,
            inputTokens: 150,
            outputTokens: 75,
          }),
        },
      ]);
    });

    it('returns summary totals for all LLM calls', async () => {
      const res = await app.request(
        '/api/analytics/llm?from=2026-02-08T00:00:00Z&to=2026-02-08T23:59:59Z',
        { headers: authHeaders(apiKey) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.summary.totalCalls).toBe(3);
      expect(body.summary.totalCostUsd).toBeCloseTo(0.045, 3);
      expect(body.summary.totalInputTokens).toBe(450);
      expect(body.summary.totalOutputTokens).toBe(225);
      expect(body.summary.avgLatencyMs).toBeGreaterThan(0);
      expect(body.summary.avgCostPerCall).toBeCloseTo(0.015, 3);
    });

    it('returns byModel breakdown', async () => {
      const res = await app.request(
        '/api/analytics/llm?from=2026-02-08T00:00:00Z&to=2026-02-08T23:59:59Z',
        { headers: authHeaders(apiKey) },
      );

      const body = await res.json();

      expect(body.byModel).toBeInstanceOf(Array);
      expect(body.byModel.length).toBe(2);

      const anthropicModel = body.byModel.find(
        (m: { model: string }) => m.model === 'claude-sonnet-4-20250514',
      );
      expect(anthropicModel).toBeDefined();
      expect(anthropicModel.calls).toBe(2);
      expect(anthropicModel.provider).toBe('anthropic');
      expect(anthropicModel.costUsd).toBeCloseTo(0.025, 3);
      expect(anthropicModel.inputTokens).toBe(250);
      expect(anthropicModel.outputTokens).toBe(125);

      const openaiModel = body.byModel.find(
        (m: { model: string }) => m.model === 'gpt-4o',
      );
      expect(openaiModel).toBeDefined();
      expect(openaiModel.calls).toBe(1);
      expect(openaiModel.provider).toBe('openai');
    });

    it('returns byTime buckets', async () => {
      const res = await app.request(
        '/api/analytics/llm?from=2026-02-08T00:00:00Z&to=2026-02-08T23:59:59Z&granularity=hour',
        { headers: authHeaders(apiKey) },
      );

      const body = await res.json();

      expect(body.byTime).toBeInstanceOf(Array);
      expect(body.byTime.length).toBeGreaterThanOrEqual(2);

      // Check that buckets are ordered
      for (let i = 1; i < body.byTime.length; i++) {
        expect(body.byTime[i].bucket >= body.byTime[i - 1].bucket).toBe(true);
      }
    });

    it('filters by agentId', async () => {
      const res = await app.request(
        '/api/analytics/llm?from=2026-02-08T00:00:00Z&to=2026-02-08T23:59:59Z&agentId=agent_alpha',
        { headers: authHeaders(apiKey) },
      );

      const body = await res.json();

      expect(body.summary.totalCalls).toBe(2);
      expect(body.summary.totalCostUsd).toBeCloseTo(0.03, 3);
    });

    it('filters by model', async () => {
      const res = await app.request(
        '/api/analytics/llm?from=2026-02-08T00:00:00Z&to=2026-02-08T23:59:59Z&model=gpt-4o',
        { headers: authHeaders(apiKey) },
      );

      const body = await res.json();

      expect(body.summary.totalCalls).toBe(1);
      expect(body.summary.totalCostUsd).toBeCloseTo(0.02, 3);
      expect(body.byModel.length).toBe(1);
      expect(body.byModel[0].model).toBe('gpt-4o');
    });

    it('filters by provider', async () => {
      const res = await app.request(
        '/api/analytics/llm?from=2026-02-08T00:00:00Z&to=2026-02-08T23:59:59Z&provider=anthropic',
        { headers: authHeaders(apiKey) },
      );

      const body = await res.json();

      expect(body.summary.totalCalls).toBe(2);
      expect(body.summary.totalInputTokens).toBe(250);
    });

    it('returns empty results for time range with no data', async () => {
      const res = await app.request(
        '/api/analytics/llm?from=2025-01-01T00:00:00Z&to=2025-01-01T23:59:59Z',
        { headers: authHeaders(apiKey) },
      );

      const body = await res.json();

      expect(body.summary.totalCalls).toBe(0);
      expect(body.summary.totalCostUsd).toBe(0);
      expect(body.summary.avgCostPerCall).toBe(0);
      expect(body.byModel).toEqual([]);
      expect(body.byTime).toEqual([]);
    });

    it('rejects invalid granularity', async () => {
      const res = await app.request(
        '/api/analytics/llm?from=2026-02-08T00:00:00Z&to=2026-02-08T23:59:59Z&granularity=minute',
        { headers: authHeaders(apiKey) },
      );

      expect(res.status).toBe(400);
    });
  });

  // ─── Story 2.3: Full-text search on prompt content ─────────

  describe('Full-text search on LLM payload content', () => {
    it('finds llm_call events by prompt content via search', async () => {
      await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_search_001',
          agentId: 'agent_001',
          eventType: 'llm_call',
          timestamp: '2026-02-08T10:00:00Z',
          payload: {
            callId: 'search-call-1',
            provider: 'anthropic',
            model: 'claude-sonnet-4-20250514',
            messages: [
              { role: 'user', content: 'Tell me about quantum computing and its applications' },
            ],
          },
        },
        {
          sessionId: 'sess_search_001',
          agentId: 'agent_001',
          eventType: 'llm_response',
          timestamp: '2026-02-08T10:00:01Z',
          payload: makeLlmResponsePayload('search-call-1'),
        },
      ]);

      const res = await app.request(
        '/api/events?search=quantum%20computing&eventType=llm_call',
        { headers: authHeaders(apiKey) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events.length).toBe(1);
      expect(body.events[0].eventType).toBe('llm_call');
      expect(body.events[0].payload.messages[0].content).toContain('quantum computing');
    });

    it('finds llm_response events by completion content via search', async () => {
      await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_search_002',
          agentId: 'agent_001',
          eventType: 'llm_response',
          timestamp: '2026-02-08T10:00:00Z',
          payload: {
            callId: 'search-call-2',
            provider: 'openai',
            model: 'gpt-4o',
            completion: 'The Fibonacci sequence is a series where each number is the sum of the two preceding ones.',
            finishReason: 'stop',
            usage: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
            costUsd: 0.003,
            latencyMs: 500,
          },
        },
      ]);

      const res = await app.request(
        '/api/events?search=Fibonacci%20sequence',
        { headers: authHeaders(apiKey) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events.length).toBe(1);
      expect(body.events[0].payload.completion).toContain('Fibonacci sequence');
    });
  });
});
