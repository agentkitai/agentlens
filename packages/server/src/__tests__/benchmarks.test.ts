/**
 * Tests for Benchmark REST Endpoints (Story 3.5)
 *
 * CRUD, status transitions, results, auth, tenant isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, createApiKey, authHeaders, type TestContext } from './test-helpers.js';
import type { Hono } from 'hono';

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestApp();
});

// ─── Helpers ───────────────────────────────────────────────

const VALID_CREATE_BODY = {
  name: 'Test Benchmark',
  description: 'A test benchmark',
  variants: [
    { name: 'Variant A', tag: 'config:variant-a' },
    { name: 'Variant B', tag: 'config:variant-b' },
  ],
  metrics: ['avg_cost', 'error_rate'],
  minSessionsPerVariant: 10,
};

async function createBenchmark(
  app: Hono,
  apiKey: string,
  body: any = VALID_CREATE_BODY,
): Promise<any> {
  const res = await app.request('/api/benchmarks', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
  });
  return res;
}

/**
 * Insert a session with given tags via the events API.
 * Tags are placed in the session_start payload per the schema.
 */
async function insertSessionWithTag(
  app: Hono,
  apiKey: string,
  sessionId: string,
  tag: string,
): Promise<void> {
  // Create session_started event with the tag in payload
  await app.request('/api/events', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      events: [
        {
          sessionId,
          agentId: 'agent-1',
          eventType: 'session_started',
          severity: 'info',
          payload: { tags: [tag] },
          metadata: {},
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });

  // Create session_ended event to mark session as completed
  await app.request('/api/events', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      events: [
        {
          sessionId,
          agentId: 'agent-1',
          eventType: 'session_ended',
          severity: 'info',
          payload: { reason: 'completed' },
          metadata: {},
          timestamp: new Date(Date.now() + 60000).toISOString(),
        },
      ],
    }),
  });
}

// ─── POST /api/benchmarks — Create ────────────────────────

describe('POST /api/benchmarks', () => {
  it('creates a valid benchmark (201)', async () => {
    const res = await createBenchmark(ctx.app, ctx.apiKey);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.name).toBe('Test Benchmark');
    expect(body.status).toBe('draft');
    expect(body.variants).toHaveLength(2);
    expect(body.variants[0].name).toBe('Variant A');
    expect(body.variants[0].tag).toBe('config:variant-a');
    expect(body.metrics).toEqual(['avg_cost', 'error_rate']);
  });

  it('rejects missing name (400)', async () => {
    const res = await createBenchmark(ctx.app, ctx.apiKey, {
      ...VALID_CREATE_BODY,
      name: '',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('name');
  });

  it('rejects < 2 variants (400)', async () => {
    const res = await createBenchmark(ctx.app, ctx.apiKey, {
      ...VALID_CREATE_BODY,
      variants: [{ name: 'Only One', tag: 'tag-1' }],
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('2');
  });

  it('rejects > 10 variants (400)', async () => {
    const variants = Array.from({ length: 11 }, (_, i) => ({
      name: `V${i}`,
      tag: `tag-${i}`,
    }));

    const res = await createBenchmark(ctx.app, ctx.apiKey, {
      ...VALID_CREATE_BODY,
      variants,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('10');
  });

  it('rejects invalid metrics (400)', async () => {
    const res = await createBenchmark(ctx.app, ctx.apiKey, {
      ...VALID_CREATE_BODY,
      metrics: ['not_a_real_metric'],
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid metric');
  });

  it('rejects variants without tag (400)', async () => {
    const res = await createBenchmark(ctx.app, ctx.apiKey, {
      ...VALID_CREATE_BODY,
      variants: [
        { name: 'A', tag: 'tag-a' },
        { name: 'B' }, // no tag
      ],
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('tag');
  });
});

// ─── GET /api/benchmarks — List ───────────────────────────

describe('GET /api/benchmarks', () => {
  it('lists benchmarks with pagination', async () => {
    // Create 3 benchmarks
    for (let i = 0; i < 3; i++) {
      await createBenchmark(ctx.app, ctx.apiKey, {
        ...VALID_CREATE_BODY,
        name: `Benchmark ${i}`,
      });
    }

    const res = await ctx.app.request('/api/benchmarks?limit=2&offset=0', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.benchmarks).toHaveLength(2);
    expect(body.total).toBe(3);
    expect(body.hasMore).toBe(true);
  });

  it('filters by status', async () => {
    await createBenchmark(ctx.app, ctx.apiKey, {
      ...VALID_CREATE_BODY,
      name: 'Draft Benchmark',
    });

    const res = await ctx.app.request('/api/benchmarks?status=draft', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.benchmarks.length).toBeGreaterThanOrEqual(1);
    expect(body.benchmarks.every((b: any) => b.status === 'draft')).toBe(true);
  });

  it('returns empty list when no benchmarks', async () => {
    const res = await ctx.app.request('/api/benchmarks', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.benchmarks).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.hasMore).toBe(false);
  });
});

// ─── GET /api/benchmarks/:id — Get Detail ─────────────────

describe('GET /api/benchmarks/:id', () => {
  it('returns benchmark detail with variants', async () => {
    const createRes = await createBenchmark(ctx.app, ctx.apiKey);
    const created = await createRes.json();

    const res = await ctx.app.request(`/api/benchmarks/${created.id}`, {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(created.id);
    expect(body.name).toBe('Test Benchmark');
    expect(body.variants).toHaveLength(2);
  });

  it('returns 404 for non-existent benchmark', async () => {
    const res = await ctx.app.request('/api/benchmarks/non-existent-id', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('not found');
  });
});

// ─── PUT /api/benchmarks/:id/status — Status Transitions ──

describe('PUT /api/benchmarks/:id/status', () => {
  it('transitions draft → cancelled', async () => {
    const createRes = await createBenchmark(ctx.app, ctx.apiKey);
    const created = await createRes.json();

    const res = await ctx.app.request(`/api/benchmarks/${created.id}/status`, {
      method: 'PUT',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ status: 'cancelled' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('cancelled');
  });

  it('transitions draft → running when sessions exist', async () => {
    const createRes = await createBenchmark(ctx.app, ctx.apiKey);
    const created = await createRes.json();

    // Insert sessions for each variant
    await insertSessionWithTag(ctx.app, ctx.apiKey, 'ses-a-1', 'config:variant-a');
    await insertSessionWithTag(ctx.app, ctx.apiKey, 'ses-b-1', 'config:variant-b');

    const res = await ctx.app.request(`/api/benchmarks/${created.id}/status`, {
      method: 'PUT',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ status: 'running' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('running');
  });

  it('rejects invalid transition cancelled → running (409)', async () => {
    const createRes = await createBenchmark(ctx.app, ctx.apiKey);
    const created = await createRes.json();

    // draft → cancelled first
    await ctx.app.request(`/api/benchmarks/${created.id}/status`, {
      method: 'PUT',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ status: 'cancelled' }),
    });

    // cancelled → cancelled should fail (no valid transitions from cancelled)
    const res = await ctx.app.request(`/api/benchmarks/${created.id}/status`, {
      method: 'PUT',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ status: 'cancelled' }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('Invalid status transition');
  });

  it('rejects draft → running when no sessions (409)', async () => {
    const createRes = await createBenchmark(ctx.app, ctx.apiKey);
    const created = await createRes.json();

    const res = await ctx.app.request(`/api/benchmarks/${created.id}/status`, {
      method: 'PUT',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ status: 'running' }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('no sessions');
  });
});

// ─── GET /api/benchmarks/:id/results — Results ────────────

describe('GET /api/benchmarks/:id/results', () => {
  it('returns 400 for draft benchmark', async () => {
    const createRes = await createBenchmark(ctx.app, ctx.apiKey);
    const created = await createRes.json();

    const res = await ctx.app.request(`/api/benchmarks/${created.id}/results`, {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('draft');
  });

  it('computes results for running benchmark', async () => {
    const createRes = await createBenchmark(ctx.app, ctx.apiKey);
    const created = await createRes.json();

    // Insert sessions for each variant
    await insertSessionWithTag(ctx.app, ctx.apiKey, 'ses-a-1', 'config:variant-a');
    await insertSessionWithTag(ctx.app, ctx.apiKey, 'ses-b-1', 'config:variant-b');

    // Transition to running
    await ctx.app.request(`/api/benchmarks/${created.id}/status`, {
      method: 'PUT',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ status: 'running' }),
    });

    const res = await ctx.app.request(`/api/benchmarks/${created.id}/results`, {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.benchmarkId).toBe(created.id);
    expect(body.variants).toHaveLength(2);
    expect(body.comparisons).toBeInstanceOf(Array);
    expect(body.summary).toBeTruthy();
  });

  it('returns results for completed benchmark', async () => {
    const createRes = await createBenchmark(ctx.app, ctx.apiKey);
    const created = await createRes.json();

    // Insert sessions
    await insertSessionWithTag(ctx.app, ctx.apiKey, 'ses-a-1', 'config:variant-a');
    await insertSessionWithTag(ctx.app, ctx.apiKey, 'ses-b-1', 'config:variant-b');

    // Transition to running then completed
    await ctx.app.request(`/api/benchmarks/${created.id}/status`, {
      method: 'PUT',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ status: 'running' }),
    });

    await ctx.app.request(`/api/benchmarks/${created.id}/status`, {
      method: 'PUT',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ status: 'completed' }),
    });

    const res = await ctx.app.request(`/api/benchmarks/${created.id}/results`, {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.benchmarkId).toBe(created.id);
  });
});

// ─── DELETE /api/benchmarks/:id ────────────────────────────

describe('DELETE /api/benchmarks/:id', () => {
  it('deletes draft benchmark (204)', async () => {
    const createRes = await createBenchmark(ctx.app, ctx.apiKey);
    const created = await createRes.json();

    const res = await ctx.app.request(`/api/benchmarks/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(204);

    // Verify it's gone
    const getRes = await ctx.app.request(`/api/benchmarks/${created.id}`, {
      headers: authHeaders(ctx.apiKey),
    });
    expect(getRes.status).toBe(404);
  });

  it('deletes cancelled benchmark (204)', async () => {
    const createRes = await createBenchmark(ctx.app, ctx.apiKey);
    const created = await createRes.json();

    // Cancel it
    await ctx.app.request(`/api/benchmarks/${created.id}/status`, {
      method: 'PUT',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ status: 'cancelled' }),
    });

    const res = await ctx.app.request(`/api/benchmarks/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(204);
  });

  it('rejects deleting running benchmark (409)', async () => {
    const createRes = await createBenchmark(ctx.app, ctx.apiKey);
    const created = await createRes.json();

    // Insert sessions and transition to running
    await insertSessionWithTag(ctx.app, ctx.apiKey, 'ses-a-1', 'config:variant-a');
    await insertSessionWithTag(ctx.app, ctx.apiKey, 'ses-b-1', 'config:variant-b');

    await ctx.app.request(`/api/benchmarks/${created.id}/status`, {
      method: 'PUT',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ status: 'running' }),
    });

    const res = await ctx.app.request(`/api/benchmarks/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(409);
  });
});

// ─── Auth & Tenant Isolation ──────────────────────────────

describe('Auth & Tenant Isolation', () => {
  it('requires authentication (401)', async () => {
    const res = await ctx.app.request('/api/benchmarks', {
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(401);
  });

  it('isolates benchmarks between tenants', async () => {
    // Create benchmark with default tenant
    const createRes = await createBenchmark(ctx.app, ctx.apiKey);
    const created = await createRes.json();

    // Create a second tenant's API key
    const otherKey = createApiKey(ctx.db, { tenantId: 'other-tenant' });

    // Other tenant shouldn't see this benchmark
    const res = await ctx.app.request(`/api/benchmarks/${created.id}`, {
      headers: authHeaders(otherKey),
    });

    expect(res.status).toBe(404);

    // Other tenant's list should be empty
    const listRes = await ctx.app.request('/api/benchmarks', {
      headers: authHeaders(otherKey),
    });
    const listBody = await listRes.json();
    expect(listBody.benchmarks).toEqual([]);
    expect(listBody.total).toBe(0);
  });
});
