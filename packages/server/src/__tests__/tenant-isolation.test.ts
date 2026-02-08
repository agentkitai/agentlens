/**
 * End-to-End Tenant Isolation Tests (Story 1.4)
 *
 * Tests that two API keys with different tenantIds are fully isolated
 * at the HTTP API level. Insert via one, query via the other, verify isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, createApiKey, authHeaders, type TestContext } from './test-helpers.js';

describe('End-to-End Tenant Isolation (Story 1.4)', () => {
  let ctx: TestContext;
  let keyA: string;
  let keyB: string;

  beforeEach(() => {
    // Create test app with default tenant key
    ctx = createTestApp({ tenantId: 'tenant-a' });

    // The default key is already tenant-a; re-assign for clarity
    keyA = ctx.apiKey;

    // Create a second API key for tenant-b
    keyB = createApiKey(ctx.db, { tenantId: 'tenant-b', name: 'Tenant B Key' });
  });

  // ─── Event Isolation via API ───────────────────────────────

  describe('Event Isolation via API', () => {
    it('events ingested by tenant A are invisible to tenant B', async () => {
      // Tenant A ingests events
      const ingestRes = await ctx.app.request('/api/events', {
        method: 'POST',
        headers: authHeaders(keyA),
        body: JSON.stringify({
          events: [{
            sessionId: 'sess-a',
            agentId: 'agent-a',
            eventType: 'session_started',
            payload: { agentName: 'Agent A' },
          }],
        }),
      });
      expect(ingestRes.status).toBe(201);

      // Tenant A can see the event
      const resA = await ctx.app.request('/api/events', {
        headers: authHeaders(keyA),
      });
      expect(resA.status).toBe(200);
      const bodyA = await resA.json();
      expect(bodyA.events).toHaveLength(1);

      // Tenant B cannot see it
      const resB = await ctx.app.request('/api/events', {
        headers: authHeaders(keyB),
      });
      expect(resB.status).toBe(200);
      const bodyB = await resB.json();
      expect(bodyB.events).toHaveLength(0);
    });

    it('tenant B cannot access tenant A event by ID', async () => {
      const ingestRes = await ctx.app.request('/api/events', {
        method: 'POST',
        headers: authHeaders(keyA),
        body: JSON.stringify({
          events: [{
            sessionId: 'sess-a',
            agentId: 'agent-a',
            eventType: 'session_started',
            payload: { agentName: 'Agent A' },
          }],
        }),
      });
      const ingestBody = await ingestRes.json();
      const eventId = ingestBody.events[0].id;

      // Tenant A can get it
      const resA = await ctx.app.request(`/api/events/${eventId}`, {
        headers: authHeaders(keyA),
      });
      expect(resA.status).toBe(200);

      // Tenant B gets 404
      const resB = await ctx.app.request(`/api/events/${eventId}`, {
        headers: authHeaders(keyB),
      });
      expect(resB.status).toBe(404);
    });
  });

  // ─── Session Isolation via API ─────────────────────────────

  describe('Session Isolation via API', () => {
    it('sessions created by tenant A are invisible to tenant B', async () => {
      // Ingest session_started for tenant A
      await ctx.app.request('/api/events', {
        method: 'POST',
        headers: authHeaders(keyA),
        body: JSON.stringify({
          events: [{
            sessionId: 'sess-a',
            agentId: 'agent-a',
            eventType: 'session_started',
            payload: { agentName: 'Agent A' },
          }],
        }),
      });

      // Tenant A sees 1 session
      const resA = await ctx.app.request('/api/sessions', {
        headers: authHeaders(keyA),
      });
      const bodyA = await resA.json();
      expect(bodyA.sessions).toHaveLength(1);
      expect(bodyA.sessions[0].id).toBe('sess-a');

      // Tenant B sees 0 sessions
      const resB = await ctx.app.request('/api/sessions', {
        headers: authHeaders(keyB),
      });
      const bodyB = await resB.json();
      expect(bodyB.sessions).toHaveLength(0);
    });

    it('tenant B cannot access tenant A session by ID', async () => {
      await ctx.app.request('/api/events', {
        method: 'POST',
        headers: authHeaders(keyA),
        body: JSON.stringify({
          events: [{
            sessionId: 'sess-a',
            agentId: 'agent-a',
            eventType: 'session_started',
            payload: { agentName: 'Agent A' },
          }],
        }),
      });

      const resA = await ctx.app.request('/api/sessions/sess-a', {
        headers: authHeaders(keyA),
      });
      expect(resA.status).toBe(200);

      const resB = await ctx.app.request('/api/sessions/sess-a', {
        headers: authHeaders(keyB),
      });
      expect(resB.status).toBe(404);
    });

    it('session timeline is tenant-scoped', async () => {
      await ctx.app.request('/api/events', {
        method: 'POST',
        headers: authHeaders(keyA),
        body: JSON.stringify({
          events: [{
            sessionId: 'sess-a',
            agentId: 'agent-a',
            eventType: 'session_started',
            payload: { agentName: 'Agent A' },
          }],
        }),
      });

      const resA = await ctx.app.request('/api/sessions/sess-a/timeline', {
        headers: authHeaders(keyA),
      });
      expect(resA.status).toBe(200);
      const bodyA = await resA.json();
      expect(bodyA.events).toHaveLength(1);

      const resB = await ctx.app.request('/api/sessions/sess-a/timeline', {
        headers: authHeaders(keyB),
      });
      expect(resB.status).toBe(404);
    });
  });

  // ─── Agent Isolation via API ───────────────────────────────

  describe('Agent Isolation via API', () => {
    it('agents created by tenant A are invisible to tenant B', async () => {
      await ctx.app.request('/api/events', {
        method: 'POST',
        headers: authHeaders(keyA),
        body: JSON.stringify({
          events: [{
            sessionId: 'sess-a',
            agentId: 'agent-a',
            eventType: 'session_started',
            payload: { agentName: 'Agent A' },
          }],
        }),
      });

      const resA = await ctx.app.request('/api/agents', {
        headers: authHeaders(keyA),
      });
      const bodyA = await resA.json();
      expect(bodyA.agents).toHaveLength(1);
      expect(bodyA.agents[0].id).toBe('agent-a');

      const resB = await ctx.app.request('/api/agents', {
        headers: authHeaders(keyB),
      });
      const bodyB = await resB.json();
      expect(bodyB.agents).toHaveLength(0);
    });
  });

  // ─── Stats Isolation via API ───────────────────────────────

  describe('Stats Isolation via API', () => {
    it('stats reflect only the authenticated tenants data', async () => {
      // Ingest 2 events for tenant A
      await ctx.app.request('/api/events', {
        method: 'POST',
        headers: authHeaders(keyA),
        body: JSON.stringify({
          events: [
            { sessionId: 'sess-a', agentId: 'agent-a', eventType: 'session_started', payload: {} },
            { sessionId: 'sess-a', agentId: 'agent-a', eventType: 'tool_call', payload: { toolName: 'test', arguments: {}, callId: 'c1' } },
          ],
        }),
      });

      // Ingest 1 event for tenant B
      await ctx.app.request('/api/events', {
        method: 'POST',
        headers: authHeaders(keyB),
        body: JSON.stringify({
          events: [
            { sessionId: 'sess-b', agentId: 'agent-b', eventType: 'session_started', payload: {} },
          ],
        }),
      });

      const resA = await ctx.app.request('/api/stats', {
        headers: authHeaders(keyA),
      });
      const statsA = await resA.json();
      expect(statsA.totalEvents).toBe(2);
      expect(statsA.totalSessions).toBe(1);

      const resB = await ctx.app.request('/api/stats', {
        headers: authHeaders(keyB),
      });
      const statsB = await resB.json();
      expect(statsB.totalEvents).toBe(1);
      expect(statsB.totalSessions).toBe(1);
    });
  });

  // ─── Alert Rule Isolation via API ──────────────────────────

  describe('Alert Rule Isolation via API', () => {
    it('alert rules are tenant-isolated', async () => {
      // Create rule for tenant A
      const createRes = await ctx.app.request('/api/alerts/rules', {
        method: 'POST',
        headers: authHeaders(keyA),
        body: JSON.stringify({
          name: 'A Rule',
          condition: 'error_rate_exceeds',
          threshold: 0.1,
          windowMinutes: 60,
        }),
      });
      expect(createRes.status).toBe(201);

      // Tenant A sees it
      const resA = await ctx.app.request('/api/alerts/rules', {
        headers: authHeaders(keyA),
      });
      const bodyA = await resA.json();
      expect(bodyA.rules).toHaveLength(1);

      // Tenant B doesn't
      const resB = await ctx.app.request('/api/alerts/rules', {
        headers: authHeaders(keyB),
      });
      const bodyB = await resB.json();
      expect(bodyB.rules).toHaveLength(0);
    });
  });

  // ─── Analytics Isolation via API ─────────────────────────────

  describe('Analytics Isolation via API (costs, agents, tools, llm)', () => {
    // Seed both tenants with distinct event data before each analytics test
    beforeEach(async () => {
      // Tenant A: agent-alpha, tool "search", cost $0.05, llm_response
      await ctx.app.request('/api/events', {
        method: 'POST',
        headers: authHeaders(keyA),
        body: JSON.stringify({
          events: [
            {
              sessionId: 'sess-a1',
              agentId: 'agent-alpha',
              eventType: 'session_started',
              timestamp: '2026-01-15T10:00:00Z',
              payload: { agentName: 'Alpha', tags: [] },
            },
            {
              sessionId: 'sess-a1',
              agentId: 'agent-alpha',
              eventType: 'tool_call',
              timestamp: '2026-01-15T10:01:00Z',
              payload: { toolName: 'search', arguments: { q: 'a' }, callId: 'ca1' },
            },
            {
              sessionId: 'sess-a1',
              agentId: 'agent-alpha',
              eventType: 'tool_response',
              timestamp: '2026-01-15T10:01:05Z',
              payload: { callId: 'ca1', toolName: 'search', result: 'ok', durationMs: 200 },
            },
            {
              sessionId: 'sess-a1',
              agentId: 'agent-alpha',
              eventType: 'cost_tracked',
              timestamp: '2026-01-15T10:02:00Z',
              payload: {
                provider: 'openai',
                model: 'gpt-4',
                inputTokens: 100,
                outputTokens: 50,
                totalTokens: 150,
                costUsd: 0.05,
              },
            },
            {
              sessionId: 'sess-a1',
              agentId: 'agent-alpha',
              eventType: 'llm_response',
              timestamp: '2026-01-15T10:02:30Z',
              payload: {
                callId: 'llm-a1',
                provider: 'openai',
                model: 'gpt-4',
                completion: 'Hello world',
                finishReason: 'stop',
                costUsd: 0.05,
                latencyMs: 800,
                usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
              },
            },
            {
              sessionId: 'sess-a1',
              agentId: 'agent-alpha',
              eventType: 'session_ended',
              timestamp: '2026-01-15T10:05:00Z',
              payload: { reason: 'completed' },
            },
          ],
        }),
      });

      // Tenant B: agent-beta, tool "fetch", cost $0.10, llm_response
      await ctx.app.request('/api/events', {
        method: 'POST',
        headers: authHeaders(keyB),
        body: JSON.stringify({
          events: [
            {
              sessionId: 'sess-b1',
              agentId: 'agent-beta',
              eventType: 'session_started',
              timestamp: '2026-01-15T11:00:00Z',
              payload: { agentName: 'Beta', tags: [] },
            },
            {
              sessionId: 'sess-b1',
              agentId: 'agent-beta',
              eventType: 'tool_call',
              timestamp: '2026-01-15T11:01:00Z',
              payload: { toolName: 'fetch', arguments: { url: 'http://x' }, callId: 'cb1' },
            },
            {
              sessionId: 'sess-b1',
              agentId: 'agent-beta',
              eventType: 'tool_response',
              timestamp: '2026-01-15T11:01:10Z',
              payload: { callId: 'cb1', toolName: 'fetch', result: 'ok', durationMs: 500 },
            },
            {
              sessionId: 'sess-b1',
              agentId: 'agent-beta',
              eventType: 'cost_tracked',
              timestamp: '2026-01-15T11:02:00Z',
              payload: {
                provider: 'anthropic',
                model: 'claude-3',
                inputTokens: 200,
                outputTokens: 100,
                totalTokens: 300,
                costUsd: 0.10,
              },
            },
            {
              sessionId: 'sess-b1',
              agentId: 'agent-beta',
              eventType: 'llm_response',
              timestamp: '2026-01-15T11:02:30Z',
              payload: {
                callId: 'llm-b1',
                provider: 'anthropic',
                model: 'claude-3',
                completion: 'Hi there',
                finishReason: 'stop',
                costUsd: 0.10,
                latencyMs: 1200,
                usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
              },
            },
            {
              sessionId: 'sess-b1',
              agentId: 'agent-beta',
              eventType: 'session_ended',
              timestamp: '2026-01-15T11:05:00Z',
              payload: { reason: 'completed' },
            },
          ],
        }),
      });
    });

    const timeRange = 'from=2026-01-15T00:00:00Z&to=2026-01-15T23:59:59Z';

    it('GET /api/analytics/costs — tenant A cannot see tenant B cost data', async () => {
      const resA = await ctx.app.request(`/api/analytics/costs?${timeRange}`, {
        headers: authHeaders(keyA),
      });
      expect(resA.status).toBe(200);
      const bodyA = await resA.json();
      expect(bodyA.totals.totalCostUsd).toBeCloseTo(0.05, 3);
      expect(bodyA.byAgent).toHaveLength(1);
      expect(bodyA.byAgent[0].agentId).toBe('agent-alpha');

      const resB = await ctx.app.request(`/api/analytics/costs?${timeRange}`, {
        headers: authHeaders(keyB),
      });
      expect(resB.status).toBe(200);
      const bodyB = await resB.json();
      expect(bodyB.totals.totalCostUsd).toBeCloseTo(0.10, 3);
      expect(bodyB.byAgent).toHaveLength(1);
      expect(bodyB.byAgent[0].agentId).toBe('agent-beta');
    });

    it('GET /api/analytics/agents — tenant A cannot see tenant B agent stats', async () => {
      const resA = await ctx.app.request(`/api/analytics/agents?${timeRange}`, {
        headers: authHeaders(keyA),
      });
      expect(resA.status).toBe(200);
      const bodyA = await resA.json();
      expect(bodyA.agents).toHaveLength(1);
      expect(bodyA.agents[0].agentId).toBe('agent-alpha');
      expect(bodyA.agents[0].sessionCount).toBe(1);

      const resB = await ctx.app.request(`/api/analytics/agents?${timeRange}`, {
        headers: authHeaders(keyB),
      });
      expect(resB.status).toBe(200);
      const bodyB = await resB.json();
      expect(bodyB.agents).toHaveLength(1);
      expect(bodyB.agents[0].agentId).toBe('agent-beta');
      expect(bodyB.agents[0].sessionCount).toBe(1);
    });

    it('GET /api/analytics/tools — tenant A cannot see tenant B tool usage', async () => {
      const resA = await ctx.app.request(`/api/analytics/tools?${timeRange}`, {
        headers: authHeaders(keyA),
      });
      expect(resA.status).toBe(200);
      const bodyA = await resA.json();
      const toolNamesA = bodyA.tools.map((t: { toolName: string }) => t.toolName);
      expect(toolNamesA).toContain('search');
      expect(toolNamesA).not.toContain('fetch');

      const resB = await ctx.app.request(`/api/analytics/tools?${timeRange}`, {
        headers: authHeaders(keyB),
      });
      expect(resB.status).toBe(200);
      const bodyB = await resB.json();
      const toolNamesB = bodyB.tools.map((t: { toolName: string }) => t.toolName);
      expect(toolNamesB).toContain('fetch');
      expect(toolNamesB).not.toContain('search');
    });

    it('GET /api/analytics/llm — tenant A cannot see tenant B LLM analytics', async () => {
      const resA = await ctx.app.request(`/api/analytics/llm?${timeRange}`, {
        headers: authHeaders(keyA),
      });
      expect(resA.status).toBe(200);
      const bodyA = await resA.json();
      expect(bodyA.summary.totalCalls).toBe(1);
      expect(bodyA.summary.totalCostUsd).toBeCloseTo(0.05, 3);
      expect(bodyA.byModel).toHaveLength(1);
      expect(bodyA.byModel[0].provider).toBe('openai');
      expect(bodyA.byModel[0].model).toBe('gpt-4');

      const resB = await ctx.app.request(`/api/analytics/llm?${timeRange}`, {
        headers: authHeaders(keyB),
      });
      expect(resB.status).toBe(200);
      const bodyB = await resB.json();
      expect(bodyB.summary.totalCalls).toBe(1);
      expect(bodyB.summary.totalCostUsd).toBeCloseTo(0.10, 3);
      expect(bodyB.byModel).toHaveLength(1);
      expect(bodyB.byModel[0].provider).toBe('anthropic');
      expect(bodyB.byModel[0].model).toBe('claude-3');
    });
  });

  // ─── Retention Isolation via API ───────────────────────────

  describe('Retention Isolation', () => {
    it('applyRetention on tenant A does not delete tenant B data', async () => {
      // Ingest old events for both tenants
      await ctx.app.request('/api/events', {
        method: 'POST',
        headers: authHeaders(keyA),
        body: JSON.stringify({
          events: [{
            sessionId: 'sess-old-a',
            agentId: 'agent-a',
            eventType: 'session_started',
            timestamp: '2020-01-01T00:00:00Z',
            payload: { agentName: 'Agent A' },
          }],
        }),
      });

      await ctx.app.request('/api/events', {
        method: 'POST',
        headers: authHeaders(keyB),
        body: JSON.stringify({
          events: [{
            sessionId: 'sess-old-b',
            agentId: 'agent-b',
            eventType: 'session_started',
            timestamp: '2020-01-01T00:00:00Z',
            payload: { agentName: 'Agent B' },
          }],
        }),
      });

      // Verify both tenants have events
      const beforeA = await ctx.app.request('/api/events', { headers: authHeaders(keyA) });
      expect((await beforeA.json()).events).toHaveLength(1);
      const beforeB = await ctx.app.request('/api/events', { headers: authHeaders(keyB) });
      expect((await beforeB.json()).events).toHaveLength(1);

      // Apply retention via tenant-scoped store (tenant A only)
      const tenantAStore = new (await import('../db/tenant-scoped-store.js')).TenantScopedStore(ctx.store, 'tenant-a');
      const result = await tenantAStore.applyRetention('2025-01-01T00:00:00Z');
      expect(result.deletedCount).toBe(1);

      // Tenant A should have 0 events
      const afterA = await ctx.app.request('/api/events', { headers: authHeaders(keyA) });
      expect((await afterA.json()).events).toHaveLength(0);

      // Tenant B should still have 1 event
      const afterB = await ctx.app.request('/api/events', { headers: authHeaders(keyB) });
      expect((await afterB.json()).events).toHaveLength(1);
    });
  });

  // ─── API Key Creation with tenantId ────────────────────────

  describe('API Key Management (Story 1.1)', () => {
    it('POST /api/keys enforces caller tenantId (ignores body tenantId)', async () => {
      const res = await ctx.app.request('/api/keys', {
        method: 'POST',
        headers: authHeaders(keyA),
        body: JSON.stringify({
          name: 'Custom Tenant Key',
          tenantId: 'custom-tenant', // Should be ignored — caller is tenant-a
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      // Non-dev callers always get their own tenantId, not the requested one
      expect(body.tenantId).toBe('tenant-a');
      expect(body.key).toMatch(/^als_/);
    });

    it('POST /api/keys defaults tenantId to caller tenant when not specified', async () => {
      const res = await ctx.app.request('/api/keys', {
        method: 'POST',
        headers: authHeaders(keyA),
        body: JSON.stringify({ name: 'Default Tenant Key' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.tenantId).toBe('tenant-a');
    });

    it('GET /api/keys includes tenantId in response', async () => {
      const res = await ctx.app.request('/api/keys', {
        headers: authHeaders(keyA),
      });
      const body = await res.json();
      expect(body.keys[0].tenantId).toBeDefined();
    });
  });

  // ─── Auth Middleware tenantId ───────────────────────────────

  describe('Auth Middleware tenantId (Story 1.1)', () => {
    it('dev mode defaults tenantId to "default"', async () => {
      const devCtx = createTestApp({ authDisabled: true });
      const res = await devCtx.app.request('/api/events');
      expect(res.status).toBe(200);
      // Events should be empty — but the fact it returned 200 means auth passed
      // with dev tenantId='default'
    });
  });
});
