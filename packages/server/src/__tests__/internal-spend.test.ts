/**
 * POST /api/internal/spend — service-token-authenticated per-agent spend reads (#13).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestApp, createApiKey, authHeaders } from './test-helpers.js';
import type { Hono } from 'hono';
import type { SqliteDb } from '../db/index.js';
import { ServiceTokenStore } from '../db/service-token-store.js';
import { hashApiKey } from '../middleware/auth.js';

const SVC_TOKEN = 'svc-test-token-abc123';

/** Mint a per-tenant DB service token (#59); returns the raw token to present. */
async function mkServiceToken(
  db: SqliteDb,
  raw: string,
  tenantId: string,
  opts: { expiresAt?: number; revoke?: boolean } = {},
): Promise<string> {
  const store = new ServiceTokenStore(db);
  const now = Math.floor(Date.now() / 1000);
  await store.create({ id: `st_${raw}`, tokenHash: hashApiKey(raw), tenantId, name: 'test', createdAt: now, expiresAt: opts.expiresAt ?? null });
  if (opts.revoke) await store.revoke(tenantId, `st_${raw}`, now);
  return raw;
}
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
  let db: SqliteDb;

  beforeEach(async () => {
    process.env['AGENTGATE_SERVICE_TOKEN'] = SVC_TOKEN;
    const ctx = await createTestApp();
    app = ctx.app;
    apiKey = ctx.apiKey;
    db = ctx.db;
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

  it('isolates by tenant for the SAME agent id (no cross-tenant leakage)', async () => {
    // Same agent id (agt_a) earns spend under a second tenant. A query scoped to
    // one tenant must not see the other's rows — the core invariant, since
    // tenantId comes from the (org-scoped) request body.
    const keyB = createApiKey(db, { tenantId: 'tenant-b' });
    await app.request('/api/events', {
      method: 'POST',
      headers: authHeaders(keyB),
      body: JSON.stringify({ events: [costEvent('agt_a', 's3', 0.50, '2026-01-17T10:00:00Z')] }),
    });

    const resDefault = await spend(app, { agentIds: ['agt_a'], tenantId: 'default', ...WINDOW });
    const defaultSpend = ((await resDefault.json()) as { spend: Array<{ agentId: string; totalCostUsd: number }> }).spend;
    expect(defaultSpend).toHaveLength(1);
    expect(defaultSpend[0]!.totalCostUsd).toBeCloseTo(0.02, 6); // default only, NOT 0.52

    const resB = await spend(app, { agentIds: ['agt_a'], tenantId: 'tenant-b', ...WINDOW });
    const bSpend = ((await resB.json()) as { spend: Array<{ totalCostUsd: number }> }).spend;
    expect(bSpend).toHaveLength(1);
    expect(bSpend[0]!.totalCostUsd).toBeCloseTo(0.50, 6); // tenant-b only
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

  // ── Per-tenant service tokens (#59) ──
  it('per-tenant token authorizes its own tenant (200) but not another (403)', async () => {
    const tok = await mkServiceToken(db, 'agl_svc_default_xyz', 'default');
    expect((await spend(app, { agentIds: ['agt_a'], tenantId: 'default', ...WINDOW }, tok)).status).toBe(200);
    expect((await spend(app, { agentIds: ['agt_a'], tenantId: 'tenant-b', ...WINDOW }, tok)).status).toBe(403);
  });

  it('still works when AGENTGATE_SERVICE_TOKEN is unset, via a DB token', async () => {
    delete process.env['AGENTGATE_SERVICE_TOKEN'];
    const tok = await mkServiceToken(db, 'agl_svc_only_db', 'default');
    expect((await spend(app, { agentIds: ['agt_a'], tenantId: 'default', ...WINDOW }, tok)).status).toBe(200);
    expect((await spend(app, { agentIds: ['agt_a'], tenantId: 'tenant-b', ...WINDOW }, tok)).status).toBe(403);
    process.env['AGENTGATE_SERVICE_TOKEN'] = SVC_TOKEN;
  });

  it('rejects a revoked service token (401)', async () => {
    const tok = await mkServiceToken(db, 'agl_svc_revoked', 'default', { revoke: true });
    expect((await spend(app, { agentIds: ['agt_a'], tenantId: 'default', ...WINDOW }, tok)).status).toBe(401);
  });

  it('rejects an expired service token (401)', async () => {
    const tok = await mkServiceToken(db, 'agl_svc_expired', 'default', { expiresAt: Math.floor(Date.now() / 1000) - 10 });
    expect((await spend(app, { agentIds: ['agt_a'], tenantId: 'default', ...WINDOW }, tok)).status).toBe(401);
  });

  it('validates the body (400 on empty/missing agentIds or tenantId)', async () => {
    expect((await spend(app, { agentIds: [], tenantId: 'default' })).status).toBe(400);
    expect((await spend(app, { agentIds: ['agt_a'] })).status).toBe(400);
    expect((await spend(app, { tenantId: 'default' })).status).toBe(400);
  });

  it('rejects more than 1000 agentIds (400)', async () => {
    const tooMany = Array.from({ length: 1001 }, (_, i) => `agt_${i}`);
    expect((await spend(app, { agentIds: tooMany, tenantId: 'default' })).status).toBe(400);
  });
});
