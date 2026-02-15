/**
 * Tests for Story 11.2: Analytics Endpoints
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

describe('Analytics Endpoints (Story 11.2)', () => {
  let app: Hono;
  let apiKey: string;

  beforeEach(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    apiKey = ctx.apiKey;

    // Seed with data: 2 agents, several event types, cost events
    await ingestEvents(app, apiKey, [
      {
        sessionId: 'sess_001',
        agentId: 'agent_001',
        eventType: 'session_started',
        timestamp: '2026-01-15T10:00:00Z',
        payload: { agentName: 'Agent One', tags: [] },
      },
      {
        sessionId: 'sess_001',
        agentId: 'agent_001',
        eventType: 'tool_call',
        timestamp: '2026-01-15T10:01:00Z',
        payload: { toolName: 'search', arguments: { q: 'test' }, callId: 'c1' },
      },
      {
        sessionId: 'sess_001',
        agentId: 'agent_001',
        eventType: 'tool_response',
        timestamp: '2026-01-15T10:01:05Z',
        payload: { callId: 'c1', toolName: 'search', result: 'ok', durationMs: 5000 },
      },
      {
        sessionId: 'sess_001',
        agentId: 'agent_001',
        eventType: 'cost_tracked',
        timestamp: '2026-01-15T10:02:00Z',
        payload: {
          provider: 'openai',
          model: 'gpt-4',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          costUsd: 0.015,
        },
      },
      {
        sessionId: 'sess_001',
        agentId: 'agent_001',
        eventType: 'session_ended',
        timestamp: '2026-01-15T10:05:00Z',
        payload: { reason: 'completed' },
      },
    ]);

    await ingestEvents(app, apiKey, [
      {
        sessionId: 'sess_002',
        agentId: 'agent_002',
        eventType: 'session_started',
        timestamp: '2026-01-15T11:00:00Z',
        payload: { agentName: 'Agent Two', tags: [] },
      },
      {
        sessionId: 'sess_002',
        agentId: 'agent_002',
        eventType: 'tool_call',
        timestamp: '2026-01-15T11:01:00Z',
        payload: { toolName: 'fetch', arguments: { url: 'http://x' }, callId: 'c2' },
      },
      {
        sessionId: 'sess_002',
        agentId: 'agent_002',
        eventType: 'tool_error',
        timestamp: '2026-01-15T11:01:10Z',
        severity: 'error',
        payload: { callId: 'c2', toolName: 'fetch', error: 'timeout', durationMs: 10000 },
      },
      {
        sessionId: 'sess_002',
        agentId: 'agent_002',
        eventType: 'cost_tracked',
        timestamp: '2026-01-15T11:02:00Z',
        payload: {
          provider: 'anthropic',
          model: 'claude-3',
          inputTokens: 200,
          outputTokens: 100,
          totalTokens: 300,
          costUsd: 0.03,
        },
      },
    ]);
  });

  describe('GET /api/analytics', () => {
    it('returns bucketed metrics', async () => {
      const res = await app.request(
        '/api/analytics?from=2026-01-15T00:00:00Z&to=2026-01-15T23:59:59Z&granularity=hour',
        { headers: authHeaders(apiKey) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.buckets).toBeInstanceOf(Array);
      expect(body.buckets.length).toBeGreaterThan(0);
      expect(body.totals.eventCount).toBe(9);
      expect(body.totals.toolCallCount).toBe(2);
      expect(body.totals.errorCount).toBeGreaterThanOrEqual(1);
      expect(body.totals.totalCostUsd).toBeCloseTo(0.045, 3);
    });

    it('filters by agentId', async () => {
      const res = await app.request(
        '/api/analytics?from=2026-01-15T00:00:00Z&to=2026-01-15T23:59:59Z&granularity=hour&agentId=agent_001',
        { headers: authHeaders(apiKey) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totals.eventCount).toBe(5);
      expect(body.totals.totalCostUsd).toBeCloseTo(0.015, 3);
    });

    it('uses defaults when no params provided', async () => {
      const res = await app.request('/api/analytics', {
        headers: authHeaders(apiKey),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.buckets).toBeInstanceOf(Array);
      expect(body.totals).toBeDefined();
    });
  });

  describe('GET /api/analytics/costs', () => {
    it('returns cost breakdown by agent', async () => {
      const res = await app.request(
        '/api/analytics/costs?from=2026-01-15T00:00:00Z&to=2026-01-15T23:59:59Z',
        { headers: authHeaders(apiKey) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.byAgent).toBeInstanceOf(Array);
      expect(body.byAgent.length).toBe(2);

      const agent2 = body.byAgent.find(
        (a: { agentId: string }) => a.agentId === 'agent_002',
      );
      expect(agent2).toBeDefined();
      expect(agent2.totalCostUsd).toBeCloseTo(0.03, 3);
      expect(agent2.totalInputTokens).toBe(200);
      expect(agent2.totalOutputTokens).toBe(100);

      expect(body.overTime).toBeInstanceOf(Array);
      expect(body.overTime.length).toBeGreaterThan(0);

      expect(body.totals.totalCostUsd).toBeCloseTo(0.045, 3);
      expect(body.totals.totalInputTokens).toBe(300);
      expect(body.totals.totalOutputTokens).toBe(150);
      expect(body.totals.totalTokens).toBe(450);
    });
  });

  describe('GET /api/analytics/agents', () => {
    it('returns per-agent metrics', async () => {
      const res = await app.request(
        '/api/analytics/agents?from=2026-01-15T00:00:00Z&to=2026-01-15T23:59:59Z',
        { headers: authHeaders(apiKey) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.agents).toBeInstanceOf(Array);
      expect(body.agents.length).toBe(2);

      const agent1 = body.agents.find(
        (a: { agentId: string }) => a.agentId === 'agent_001',
      );
      expect(agent1).toBeDefined();
      expect(agent1.sessionCount).toBe(1);
      expect(agent1.totalCostUsd).toBeCloseTo(0.015, 3);
      expect(typeof agent1.errorRate).toBe('number');
      expect(typeof agent1.avgDurationMs).toBe('number');
    });
  });

  describe('GET /api/analytics/tools', () => {
    it('returns tool usage statistics', async () => {
      const res = await app.request(
        '/api/analytics/tools?from=2026-01-15T00:00:00Z&to=2026-01-15T23:59:59Z',
        { headers: authHeaders(apiKey) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.tools).toBeInstanceOf(Array);
      expect(body.tools.length).toBeGreaterThanOrEqual(2);

      const searchTool = body.tools.find(
        (t: { toolName: string }) => t.toolName === 'search',
      );
      expect(searchTool).toBeDefined();
      expect(searchTool.callCount).toBeGreaterThanOrEqual(1);
      expect(typeof searchTool.avgDurationMs).toBe('number');
      expect(typeof searchTool.errorRate).toBe('number');
    });
  });

  describe('Cost tracking on session (Story 11.1)', () => {
    it('session totalCostUsd is aggregated from cost_tracked events', async () => {
      const res = await app.request('/api/sessions/sess_001', {
        headers: authHeaders(apiKey),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalCostUsd).toBeCloseTo(0.015, 3);
    });

    it('session with multiple cost events accumulates cost', async () => {
      // Add another cost event to sess_002
      await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_002',
          agentId: 'agent_002',
          eventType: 'cost_tracked',
          timestamp: '2026-01-15T11:03:00Z',
          payload: {
            provider: 'anthropic',
            model: 'claude-3',
            inputTokens: 50,
            outputTokens: 25,
            totalTokens: 75,
            costUsd: 0.01,
          },
        },
      ]);

      const res = await app.request('/api/sessions/sess_002', {
        headers: authHeaders(apiKey),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalCostUsd).toBeCloseTo(0.04, 3);
    });
  });
});
