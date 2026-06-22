/**
 * POST /api/internal/spend — service-token-authenticated per-agent spend reads (#13).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestApp, authHeaders } from './test-helpers.js';
import type { Hono } from 'hono';

const SVC_TOKEN = 'svc-test-token-abc123';
const WINDOW = { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' };

function costEvent(agentId: string, sessionId: string, costUsd: number, ts: string) {
  return {
    sessionId,
    agentId,
    eventType: 'cost_tracked',
    timestamp: ts,
    payload: { provider: 'openai', model: 'gpt-4o', inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd },
  };
}

async function spend(app: Hono, body: unknown, token: string | null = SVC_TOKEN) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request('/api/internal/spend', { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('POST /api/internal/spend', () => {
  let app: Hono;
  let apiKey: string;

  beforeEach(async () => {
    process.env['AGENTGATE_SERVICE_TOKEN'] = SVC_TOKEN;
    const ctx = await createTestApp();
    app = ctx.app;
    apiKey = ctx.apiKey;
    // Two agents with cost in the window (tenant 'default').
    await app.request('/api/events', {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        events: [
          costEvent('agt_a', 's1', 0.015, '2026-01-15T10:00:00Z'),
          costEvent('agt_a', 's1', 0.005, '2026-01-15T11:00:00Z'),
          costEvent('agt_b', 's2', 0.10, '2026-01-16T10:00:00Z'),
        ],
      }),
    });
  });

  afterAll(() => {
    delete process.env['AGENTGATE_SERVICE_TOKEN'];
  });

  it('aggregates per-agent spend over the window', async () => {
    const res = await spend(app, { agentIds: ['agt_a', 'agt_b'], tenantId: 'default', ...WINDOW });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { spend: Array<{ agentId: string; totalCostUsd: number }> };
    const byAgent = Object.fromEntries(body.spend.map((s) => [s.agentId, s.totalCostUsd]));
    expect(byAgent['agt_a']).toBeCloseTo(0.02, 6); // 0.015 + 0.005
    expect(byAgent['agt_b']).toBeCloseTo(0.10, 6);
  });

  it('only returns the requested agents', async () => {
    const res = await spend(app, { agentIds: ['agt_a'], tenantId: 'default', ...WINDOW });
    const body = (await res.json()) as { spend: Array<{ agentId: string }> };
    expect(body.spend.map((s) => s.agentId)).toEqual(['agt_a']);
  });

  it('isolates by tenant (no cross-tenant leakage)', async () => {
    const res = await spend(app, { agentIds: ['agt_a', 'agt_b'], tenantId: 'someone-else', ...WINDOW });
    const body = (await res.json()) as { spend: unknown[] };
    expect(body.spend).toEqual([]);
  });

  it('omits agents with no spend in the window (caller defaults them to $0)', async () => {
    const res = await spend(app, { agentIds: ['agt_a', 'agt_unknown'], tenantId: 'default', ...WINDOW });
    const body = (await res.json()) as { spend: Array<{ agentId: string }> };
    expect(body.spend.map((s) => s.agentId)).toEqual(['agt_a']);
  });

  it('rejects a missing token (401)', async () => {
    expect((await spend(app, { agentIds: ['agt_a'], tenantId: 'default' }, null)).status).toBe(401);
  });

  it('rejects a wrong token (401)', async () => {
    expect((await spend(app, { agentIds: ['agt_a'], tenantId: 'default' }, 'wrong-token')).status).toBe(401);
  });

  it('returns 503 when the service token is unset (feature disabled)', async () => {
    delete process.env['AGENTGATE_SERVICE_TOKEN'];
    expect((await spend(app, { agentIds: ['agt_a'], tenantId: 'default' })).status).toBe(503);
    process.env['AGENTGATE_SERVICE_TOKEN'] = SVC_TOKEN;
  });

  it('validates the body (400 on empty/missing agentIds or tenantId)', async () => {
    expect((await spend(app, { agentIds: [], tenantId: 'default' })).status).toBe(400);
    expect((await spend(app, { agentIds: ['agt_a'] })).status).toBe(400);
    expect((await spend(app, { tenantId: 'default' })).status).toBe(400);
  });
});
