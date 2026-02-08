/**
 * Tests for Health REST Endpoints (Story 1.4)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, createApiKey, authHeaders, type TestContext } from './test-helpers.js';

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestApp();
});

// ─── Helper: seed sessions for an agent ───────────────────────────

async function seedSessions(
  app: TestContext['app'],
  apiKey: string,
  agentId: string,
  count: number,
  opts?: { withErrors?: boolean },
) {
  for (let i = 0; i < count; i++) {
    const sessionId = `ses_${agentId}_${i}`;
    // session_started event
    await app.request('/api/events', {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        events: [
          {
            sessionId,
            agentId,
            eventType: 'session_started',
            severity: 'info',
            payload: {},
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });

    // Optionally add error events
    if (opts?.withErrors && i % 2 === 0) {
      await app.request('/api/events', {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify({
          events: [
            {
              sessionId,
              agentId,
              eventType: 'error',
              severity: 'error',
              payload: { message: 'test error' },
              timestamp: new Date().toISOString(),
            },
          ],
        }),
      });
    }

    // session_ended event
    await app.request('/api/events', {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        events: [
          {
            sessionId,
            agentId,
            eventType: 'session_ended',
            severity: 'info',
            payload: { reason: 'completed' },
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
  }
}

// ─── GET /api/agents/:id/health ───────────────────────────────────

describe('GET /api/agents/:id/health', () => {
  it('returns health score for agent with sessions', async () => {
    await seedSessions(ctx.app, ctx.apiKey, 'agent-1', 3);

    const res = await ctx.app.request('/api/agents/agent-1/health?window=7', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agentId).toBe('agent-1');
    expect(body.overallScore).toBeGreaterThanOrEqual(0);
    expect(body.overallScore).toBeLessThanOrEqual(100);
    expect(body.trend).toBeDefined();
    expect(body.trendDelta).toBeDefined();
    expect(body.dimensions).toHaveLength(5);
    expect(body.window).toBeDefined();
    expect(body.sessionCount).toBe(3);
    expect(body.computedAt).toBeDefined();
  });

  it('returns 404 for unknown agent', async () => {
    const res = await ctx.app.request('/api/agents/nonexistent/health', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('No sessions found for agent in window');
  });

  it('requires authentication', async () => {
    const res = await ctx.app.request('/api/agents/agent-1/health');
    expect(res.status).toBe(401);
  });

  it('uses default window of 7 when not specified', async () => {
    await seedSessions(ctx.app, ctx.apiKey, 'agent-1', 2);

    const res = await ctx.app.request('/api/agents/agent-1/health', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agentId).toBe('agent-1');
  });

  it('returns 400 for window=0', async () => {
    const res = await ctx.app.request('/api/agents/agent-1/health?window=0', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('window must be an integer between 1 and 90');
  });

  it('returns 400 for window=999', async () => {
    const res = await ctx.app.request('/api/agents/agent-1/health?window=999', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('window must be an integer between 1 and 90');
  });

  it('tenant isolation — agent from tenant B not visible to tenant A', async () => {
    // Create tenant B key
    const tenantBKey = createApiKey(ctx.db, { tenantId: 'tenant-b' });

    // Seed sessions for tenant B
    await seedSessions(ctx.app, tenantBKey, 'agent-b', 3);

    // Query with tenant A (default) key — should get 404
    const res = await ctx.app.request('/api/agents/agent-b/health', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/health/overview ─────────────────────────────────────

describe('GET /api/health/overview', () => {
  it('returns overview with multiple agents', async () => {
    await seedSessions(ctx.app, ctx.apiKey, 'agent-1', 2);
    await seedSessions(ctx.app, ctx.apiKey, 'agent-2', 3);

    const res = await ctx.app.request('/api/health/overview?window=7', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toBeDefined();
    expect(Array.isArray(body.agents)).toBe(true);
    expect(body.agents.length).toBeGreaterThanOrEqual(2);
    expect(body.computedAt).toBeDefined();

    // Verify each agent has the expected fields
    for (const agent of body.agents) {
      expect(agent.agentId).toBeDefined();
      expect(agent.overallScore).toBeGreaterThanOrEqual(0);
      expect(agent.dimensions).toHaveLength(5);
    }
  });

  it('requires authentication', async () => {
    const res = await ctx.app.request('/api/health/overview');
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid window', async () => {
    const res = await ctx.app.request('/api/health/overview?window=-1', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(400);
  });
});

// ─── GET /api/health/history ──────────────────────────────────────

describe('GET /api/health/history', () => {
  it('returns empty history when no snapshots exist', async () => {
    const res = await ctx.app.request('/api/health/history?agentId=agent-1', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshots).toEqual([]);
    expect(body.agentId).toBe('agent-1');
    expect(body.days).toBe(30);
  });

  it('returns 400 when agentId is missing', async () => {
    const res = await ctx.app.request('/api/health/history', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Missing required query parameter: agentId');
  });

  it('returns 400 for invalid days parameter', async () => {
    const res = await ctx.app.request('/api/health/history?agentId=agent-1&days=0', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(400);
  });

  it('returns snapshots after health query triggers lazy snapshot', async () => {
    await seedSessions(ctx.app, ctx.apiKey, 'agent-1', 2);

    // Trigger health computation which saves a lazy snapshot
    const healthRes = await ctx.app.request('/api/agents/agent-1/health', {
      headers: authHeaders(ctx.apiKey),
    });
    expect(healthRes.status).toBe(200);

    // Now fetch history
    const res = await ctx.app.request('/api/health/history?agentId=agent-1', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshots.length).toBeGreaterThanOrEqual(1);
    expect(body.snapshots[0].agentId).toBe('agent-1');
  });

  it('requires authentication', async () => {
    const res = await ctx.app.request('/api/health/history?agentId=agent-1');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/config/health-weights ───────────────────────────────

describe('GET /api/config/health-weights', () => {
  it('returns default health weights', async () => {
    const res = await ctx.app.request('/api/config/health-weights', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.errorRate).toBe(0.30);
    expect(body.costEfficiency).toBe(0.20);
    expect(body.toolSuccess).toBe(0.20);
    expect(body.latency).toBe(0.15);
    expect(body.completionRate).toBe(0.15);
  });

  it('requires authentication', async () => {
    const res = await ctx.app.request('/api/config/health-weights');
    expect(res.status).toBe(401);
  });
});

// ─── PUT /api/config/health-weights ───────────────────────────────

describe('PUT /api/config/health-weights', () => {
  it('returns 501 for valid weights (not yet implemented)', async () => {
    const res = await ctx.app.request('/api/config/health-weights', {
      method: 'PUT',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({
        errorRate: 0.30,
        costEfficiency: 0.20,
        toolSuccess: 0.20,
        latency: 0.15,
        completionRate: 0.15,
      }),
    });

    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toContain('Weight customization coming in a future release');
  });

  it('returns 400 for invalid weights (sum != 1.0)', async () => {
    const res = await ctx.app.request('/api/config/health-weights', {
      method: 'PUT',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({
        errorRate: 0.90,
        costEfficiency: 0.90,
        toolSuccess: 0.90,
        latency: 0.90,
        completionRate: 0.90,
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Weights must sum to approximately 1.0');
  });
});
