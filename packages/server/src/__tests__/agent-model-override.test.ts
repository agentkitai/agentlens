/**
 * Tests for Story 3.2: Model Override Propagation via GET /api/agents/:id
 *
 * Verifies that after a guardrail triggers downgrade_model, the agent endpoint
 * reflects the new model_override and paused_at fields.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, createApiKey, authHeaders, type TestContext } from './test-helpers.js';
import type { Hono } from 'hono';

async function ingestEvents(app: Hono, apiKey: string, events: object[]) {
  return app.request('/api/events', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ events }),
  });
}

describe('GET /api/agents/:id — Model Override Propagation (Story 3.2)', () => {
  let app: Hono;
  let apiKey: string;
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    apiKey = ctx.apiKey;

    // Create an agent by ingesting a session
    await ingestEvents(app, apiKey, [
      {
        sessionId: 'sess_mo_001',
        agentId: 'agent_mo_001',
        eventType: 'session_started',
        payload: { agentName: 'Override Test Agent', tags: [] },
      },
    ]);
  });

  it('returns agent with modelOverride=null initially', async () => {
    const res = await app.request('/api/agents/agent_mo_001', {
      headers: authHeaders(apiKey),
    });
    expect(res.status).toBe(200);
    const agent = await res.json();
    expect(agent.id).toBe('agent_mo_001');
    expect(agent.modelOverride).toBeFalsy();
    expect(agent.pausedAt).toBeFalsy();
  });

  it('returns 404 for non-existent agent', async () => {
    const res = await app.request('/api/agents/nonexistent', {
      headers: authHeaders(apiKey),
    });
    expect(res.status).toBe(404);
  });

  it('reflects modelOverride after setModelOverride is called', async () => {
    // Directly call the store method (simulating what the guardrail engine does)
    await ctx.store.setModelOverride('default', 'agent_mo_001', 'gpt-3.5-turbo');

    const res = await app.request('/api/agents/agent_mo_001', {
      headers: authHeaders(apiKey),
    });
    expect(res.status).toBe(200);
    const agent = await res.json();
    expect(agent.modelOverride).toBe('gpt-3.5-turbo');
  });

  it('reflects pausedAt after pauseAgent is called', async () => {
    await ctx.store.pauseAgent('default', 'agent_mo_001', 'Too many errors');

    const res = await app.request('/api/agents/agent_mo_001', {
      headers: authHeaders(apiKey),
    });
    expect(res.status).toBe(200);
    const agent = await res.json();
    expect(agent.pausedAt).toBeTruthy();
    expect(agent.pauseReason).toBe('Too many errors');
  });

  it('clears pausedAt after unpauseAgent is called', async () => {
    await ctx.store.pauseAgent('default', 'agent_mo_001', 'Error rate high');
    await ctx.store.unpauseAgent('default', 'agent_mo_001', false);

    const res = await app.request('/api/agents/agent_mo_001', {
      headers: authHeaders(apiKey),
    });
    expect(res.status).toBe(200);
    const agent = await res.json();
    expect(agent.pausedAt).toBeFalsy();
  });

  it('clears modelOverride when unpause with clearModelOverride=true', async () => {
    await ctx.store.setModelOverride('default', 'agent_mo_001', 'gpt-3.5-turbo');
    await ctx.store.pauseAgent('default', 'agent_mo_001', 'Cost limit');
    await ctx.store.unpauseAgent('default', 'agent_mo_001', true);

    const res = await app.request('/api/agents/agent_mo_001', {
      headers: authHeaders(apiKey),
    });
    expect(res.status).toBe(200);
    const agent = await res.json();
    expect(agent.pausedAt).toBeFalsy();
    expect(agent.modelOverride).toBeFalsy();
  });

  it('returns both modelOverride and pausedAt together', async () => {
    await ctx.store.setModelOverride('default', 'agent_mo_001', 'claude-haiku');
    await ctx.store.pauseAgent('default', 'agent_mo_001', 'Health score low');

    const res = await app.request('/api/agents/agent_mo_001', {
      headers: authHeaders(apiKey),
    });
    expect(res.status).toBe(200);
    const agent = await res.json();
    expect(agent.modelOverride).toBe('claude-haiku');
    expect(agent.pausedAt).toBeTruthy();
    expect(agent.pauseReason).toBe('Health score low');
  });

  it('returns 404 when accessing agent from different tenant (L4)', async () => {
    // Create a second API key for tenant B
    const tenantBKey = createApiKey(ctx.db, { tenantId: 'tenant-b' });

    // Agent was created under default tenant — tenant B should not see it
    const res = await app.request('/api/agents/agent_mo_001', {
      headers: authHeaders(tenantBKey),
    });
    expect(res.status).toBe(404);
  });

  it('unpause via REST endpoint clears paused state', async () => {
    await ctx.store.pauseAgent('default', 'agent_mo_001', 'Test pause');

    const unpauseRes = await app.request('/api/agents/agent_mo_001/unpause', {
      method: 'PUT',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ clearModelOverride: false }),
    });
    expect(unpauseRes.status).toBe(200);

    const res = await app.request('/api/agents/agent_mo_001', {
      headers: authHeaders(apiKey),
    });
    const agent = await res.json();
    expect(agent.pausedAt).toBeFalsy();
  });
});
