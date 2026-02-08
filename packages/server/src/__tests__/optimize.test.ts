/**
 * Tests for Optimize REST Endpoint (Story 2.4)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, createApiKey, authHeaders, type TestContext } from './test-helpers.js';
import type { Hono } from 'hono';

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestApp();
});

/**
 * Helper: insert llm_call + llm_response event pair via the API endpoint.
 * Uses the HTTP API (not store.insertEvents) to correctly handle hash chain.
 */
async function insertLlmCallPair(
  app: Hono,
  apiKey: string,
  opts: {
    sessionId?: string;
    agentId?: string;
    model?: string;
    callId?: string;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    finishReason?: string;
    toolCallCount?: number;
  } = {},
) {
  const sessionId = opts.sessionId ?? 'ses-1';
  const agentId = opts.agentId ?? 'agent-1';
  const model = opts.model ?? 'gpt-4o';
  const callId = opts.callId ?? `call-${Math.random().toString(36).slice(2)}`;
  const inputTokens = opts.inputTokens ?? 100;
  const outputTokens = opts.outputTokens ?? 50;
  const costUsd = opts.costUsd ?? 0.01;
  const finishReason = opts.finishReason ?? 'stop';

  // Build tool calls array if needed
  const toolCalls = [];
  for (let i = 0; i < (opts.toolCallCount ?? 0); i++) {
    toolCalls.push({ id: `tool-${i}`, name: `tool_${i}`, arguments: {} });
  }

  // Insert llm_call event
  await app.request('/api/events', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      events: [
        {
          sessionId,
          agentId,
          eventType: 'llm_call',
          severity: 'info',
          payload: {
            callId,
            model,
            provider: 'openai',
            messages: [{ role: 'user', content: 'test' }],
            ...(toolCalls.length > 0 ? { tools: toolCalls.map((t: { name: string }) => ({ name: t.name })) } : {}),
          },
          metadata: {},
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });

  // Insert llm_response event
  await app.request('/api/events', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      events: [
        {
          sessionId,
          agentId,
          eventType: 'llm_response',
          severity: 'info',
          payload: {
            callId,
            model,
            provider: 'openai',
            completion: 'test response',
            finishReason,
            usage: {
              inputTokens,
              outputTokens,
              totalTokens: inputTokens + outputTokens,
            },
            costUsd,
            latencyMs: 200,
            ...(toolCalls.length > 0 ? { toolCalls } : {}),
          },
          metadata: {},
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });
}

describe('GET /api/optimize/recommendations', () => {
  it('returns recommendations for valid request (happy path)', async () => {
    // Insert some LLM call data — expensive model and cheap model doing the same tier
    for (let i = 0; i < 5; i++) {
      await insertLlmCallPair(ctx.app, ctx.apiKey, {
        model: 'gpt-4o',
        costUsd: 0.05,
        inputTokens: 100,
        outputTokens: 50,
      });
    }
    for (let i = 0; i < 5; i++) {
      await insertLlmCallPair(ctx.app, ctx.apiKey, {
        model: 'gpt-4o-mini',
        costUsd: 0.001,
        inputTokens: 100,
        outputTokens: 50,
      });
    }

    const res = await ctx.app.request('/api/optimize/recommendations', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('recommendations');
    expect(body).toHaveProperty('totalPotentialSavings');
    expect(body).toHaveProperty('period');
    expect(body).toHaveProperty('analyzedCalls');
    expect(Array.isArray(body.recommendations)).toBe(true);
  });

  it('requires authentication (returns 401 without auth)', async () => {
    const res = await ctx.app.request('/api/optimize/recommendations');
    expect(res.status).toBe(401);
  });

  it('enforces tenant isolation', async () => {
    // Insert data for tenant A
    const tenantACtx = createTestApp({ tenantId: 'tenant-a' });
    for (let i = 0; i < 3; i++) {
      await insertLlmCallPair(tenantACtx.app, tenantACtx.apiKey, {
        model: 'gpt-4o',
        costUsd: 0.05,
      });
      await insertLlmCallPair(tenantACtx.app, tenantACtx.apiKey, {
        model: 'gpt-4o-mini',
        costUsd: 0.001,
      });
    }

    // Create a different tenant key
    const tenantBKey = createApiKey(tenantACtx.db, { tenantId: 'tenant-b' });

    // Tenant B should see no data
    const res = await tenantACtx.app.request('/api/optimize/recommendations', {
      headers: authHeaders(tenantBKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recommendations).toEqual([]);
    expect(body.analyzedCalls).toBe(0);
  });

  it('applies default params when none provided', async () => {
    const res = await ctx.app.request('/api/optimize/recommendations', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // Default period=7, limit=10
    expect(body.period).toBe(7);
  });

  it('returns 400 for period=0', async () => {
    const res = await ctx.app.request('/api/optimize/recommendations?period=0', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid period');
  });

  it('returns 400 for limit=-1', async () => {
    const res = await ctx.app.request('/api/optimize/recommendations?limit=-1', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid limit');
  });

  it('returns 400 for period > 90', async () => {
    const res = await ctx.app.request('/api/optimize/recommendations?period=91', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid period');
  });

  it('returns 400 for limit > 50', async () => {
    const res = await ctx.app.request('/api/optimize/recommendations?limit=51', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid limit');
  });

  it('returns 400 for non-numeric period', async () => {
    const res = await ctx.app.request('/api/optimize/recommendations?period=abc', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid period');
  });

  it('returns empty results when no data exists', async () => {
    const res = await ctx.app.request('/api/optimize/recommendations', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recommendations).toEqual([]);
    expect(body.totalPotentialSavings).toBe(0);
    expect(body.analyzedCalls).toBe(0);
  });

  it('filters by agentId when provided', async () => {
    // Insert data for agent-1
    for (let i = 0; i < 3; i++) {
      await insertLlmCallPair(ctx.app, ctx.apiKey, {
        agentId: 'agent-1',
        model: 'gpt-4o',
        costUsd: 0.05,
      });
      await insertLlmCallPair(ctx.app, ctx.apiKey, {
        agentId: 'agent-1',
        model: 'gpt-4o-mini',
        costUsd: 0.001,
      });
    }

    // Insert data for agent-2
    for (let i = 0; i < 3; i++) {
      await insertLlmCallPair(ctx.app, ctx.apiKey, {
        agentId: 'agent-2',
        model: 'gpt-4o',
        costUsd: 0.05,
      });
    }

    // Query only agent-1
    const res = await ctx.app.request('/api/optimize/recommendations?agentId=agent-1', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // Only agent-1 data should be analyzed (3 gpt-4o + 3 gpt-4o-mini = 6)
    expect(body.analyzedCalls).toBe(6);
  });

  it('accepts valid custom period and limit', async () => {
    const res = await ctx.app.request('/api/optimize/recommendations?period=30&limit=5', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.period).toBe(30);
  });

  it('returns proper structure for recommendations', async () => {
    // Insert enough data to generate a recommendation
    for (let i = 0; i < 10; i++) {
      await insertLlmCallPair(ctx.app, ctx.apiKey, {
        model: 'gpt-4o',
        costUsd: 0.05,
        inputTokens: 200,
        outputTokens: 100,
      });
    }
    for (let i = 0; i < 10; i++) {
      await insertLlmCallPair(ctx.app, ctx.apiKey, {
        model: 'gpt-4o-mini',
        costUsd: 0.001,
        inputTokens: 200,
        outputTokens: 100,
      });
    }

    const res = await ctx.app.request('/api/optimize/recommendations', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    if (body.recommendations.length > 0) {
      const rec = body.recommendations[0];
      expect(rec).toHaveProperty('currentModel');
      expect(rec).toHaveProperty('recommendedModel');
      expect(rec).toHaveProperty('complexityTier');
      expect(rec).toHaveProperty('currentCostPerCall');
      expect(rec).toHaveProperty('recommendedCostPerCall');
      expect(rec).toHaveProperty('monthlySavings');
      expect(rec).toHaveProperty('callVolume');
      expect(rec).toHaveProperty('currentSuccessRate');
      expect(rec).toHaveProperty('recommendedSuccessRate');
      expect(rec).toHaveProperty('confidence');
      expect(rec).toHaveProperty('agentId');
    }
  });

  it('limits results to the requested limit', async () => {
    // Insert diverse data to generate many recommendations
    const models = ['gpt-4o', 'gpt-4o-mini', 'claude-opus-4', 'claude-sonnet-4'];
    for (const model of models) {
      for (let i = 0; i < 5; i++) {
        await insertLlmCallPair(ctx.app, ctx.apiKey, {
          model,
          costUsd: model.includes('mini') || model.includes('sonnet') ? 0.001 : 0.05,
          inputTokens: 200,
          outputTokens: 100,
        });
      }
    }

    const res = await ctx.app.request('/api/optimize/recommendations?limit=1', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recommendations.length).toBeLessThanOrEqual(1);
  });
});
