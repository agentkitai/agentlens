/**
 * Tests for Lessons REST API (Story 3.2)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, createApiKey, authHeaders, type TestContext } from './test-helpers.js';

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestApp();
});

describe('POST /api/lessons', () => {
  it('creates a lesson with required fields', async () => {
    const res = await ctx.app.request('/api/lessons', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({
        title: 'Always validate inputs',
        content: 'User inputs should be validated at the API boundary.',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.title).toBe('Always validate inputs');
    expect(body.content).toBe('User inputs should be validated at the API boundary.');
    expect(body.category).toBe('general');
    expect(body.importance).toBe('normal');
    expect(body.accessCount).toBe(0);
    expect(body.context).toEqual({});
  });

  it('creates a lesson with all fields', async () => {
    const res = await ctx.app.request('/api/lessons', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({
        title: 'Use semantic search',
        content: 'Semantic search gives better results.',
        category: 'architecture',
        importance: 'high',
        agentId: 'agent-1',
        context: { project: 'agentlens' },
        sourceSessionId: 'ses_123',
        sourceEventId: 'evt_456',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.category).toBe('architecture');
    expect(body.importance).toBe('high');
    expect(body.agentId).toBe('agent-1');
    expect(body.context).toEqual({ project: 'agentlens' });
    expect(body.sourceSessionId).toBe('ses_123');
    expect(body.sourceEventId).toBe('evt_456');
  });

  it('rejects missing title', async () => {
    const res = await ctx.app.request('/api/lessons', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ content: 'Some content' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects missing content', async () => {
    const res = await ctx.app.request('/api/lessons', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ title: 'Some title' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects invalid importance', async () => {
    const res = await ctx.app.request('/api/lessons', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({
        title: 'T',
        content: 'C',
        importance: 'mega',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await ctx.app.request('/api/lessons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'T', content: 'C' }),
    });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/lessons', () => {
  it('returns empty list initially', async () => {
    const res = await ctx.app.request('/api/lessons', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lessons).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('lists created lessons', async () => {
    await ctx.app.request('/api/lessons', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ title: 'L1', content: 'C1' }),
    });
    await ctx.app.request('/api/lessons', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ title: 'L2', content: 'C2' }),
    });

    const res = await ctx.app.request('/api/lessons', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lessons).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it('filters by category', async () => {
    await ctx.app.request('/api/lessons', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ title: 'L1', content: 'C1', category: 'arch' }),
    });
    await ctx.app.request('/api/lessons', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ title: 'L2', content: 'C2', category: 'debug' }),
    });

    const res = await ctx.app.request('/api/lessons?category=arch', {
      headers: authHeaders(ctx.apiKey),
    });

    const body = await res.json();
    expect(body.lessons).toHaveLength(1);
    expect(body.lessons[0].category).toBe('arch');
  });

  it('searches by text', async () => {
    await ctx.app.request('/api/lessons', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ title: 'Rate limiting', content: 'Use rate limiting on APIs' }),
    });
    await ctx.app.request('/api/lessons', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ title: 'Caching', content: 'Use Redis for caching' }),
    });

    const res = await ctx.app.request('/api/lessons?search=rate', {
      headers: authHeaders(ctx.apiKey),
    });

    const body = await res.json();
    expect(body.lessons).toHaveLength(1);
    expect(body.lessons[0].title).toBe('Rate limiting');
  });
});

describe('GET /api/lessons/:id', () => {
  it('returns a single lesson', async () => {
    const createRes = await ctx.app.request('/api/lessons', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ title: 'Test', content: 'Content' }),
    });
    const created = await createRes.json();

    const res = await ctx.app.request(`/api/lessons/${created.id}`, {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(created.id);
    expect(body.title).toBe('Test');
    expect(body.accessCount).toBe(1); // incremented
  });

  it('increments accessCount on each get', async () => {
    const createRes = await ctx.app.request('/api/lessons', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ title: 'Test', content: 'Content' }),
    });
    const created = await createRes.json();

    await ctx.app.request(`/api/lessons/${created.id}`, {
      headers: authHeaders(ctx.apiKey),
    });
    const res2 = await ctx.app.request(`/api/lessons/${created.id}`, {
      headers: authHeaders(ctx.apiKey),
    });

    const body = await res2.json();
    expect(body.accessCount).toBe(2);
  });

  it('returns 404 for non-existent lesson', async () => {
    const res = await ctx.app.request('/api/lessons/nonexistent', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/lessons/:id', () => {
  it('updates a lesson', async () => {
    const createRes = await ctx.app.request('/api/lessons', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ title: 'Original', content: 'Original content' }),
    });
    const created = await createRes.json();

    const res = await ctx.app.request(`/api/lessons/${created.id}`, {
      method: 'PUT',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ title: 'Updated', importance: 'high' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Updated');
    expect(body.importance).toBe('high');
    expect(body.content).toBe('Original content'); // unchanged
  });

  it('returns 404 for non-existent lesson', async () => {
    const res = await ctx.app.request('/api/lessons/nonexistent', {
      method: 'PUT',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ title: 'Updated' }),
    });

    expect(res.status).toBe(404);
  });

  it('rejects invalid importance', async () => {
    const createRes = await ctx.app.request('/api/lessons', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ title: 'T', content: 'C' }),
    });
    const created = await createRes.json();

    const res = await ctx.app.request(`/api/lessons/${created.id}`, {
      method: 'PUT',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ importance: 'mega' }),
    });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/lessons/:id', () => {
  it('archives a lesson (soft delete)', async () => {
    const createRes = await ctx.app.request('/api/lessons', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ title: 'To Delete', content: 'Content' }),
    });
    const created = await createRes.json();

    const delRes = await ctx.app.request(`/api/lessons/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders(ctx.apiKey),
    });

    expect(delRes.status).toBe(200);
    const body = await delRes.json();
    expect(body.archived).toBe(true);

    // Should not appear in default list
    const listRes = await ctx.app.request('/api/lessons', {
      headers: authHeaders(ctx.apiKey),
    });
    const listBody = await listRes.json();
    expect(listBody.lessons).toHaveLength(0);
  });

  it('returns 404 for non-existent lesson', async () => {
    const res = await ctx.app.request('/api/lessons/nonexistent', {
      method: 'DELETE',
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(404);
  });
});

describe('Tenant Isolation', () => {
  it('tenant A cannot see tenant B lessons via API', async () => {
    const tenantBKey = createApiKey(ctx.db, { tenantId: 'tenant-b' });

    // Create lesson as tenant B
    await ctx.app.request('/api/lessons', {
      method: 'POST',
      headers: authHeaders(tenantBKey),
      body: JSON.stringify({ title: 'Tenant B lesson', content: 'B content' }),
    });

    // Default tenant should not see it
    const res = await ctx.app.request('/api/lessons', {
      headers: authHeaders(ctx.apiKey),
    });
    const body = await res.json();
    expect(body.lessons).toHaveLength(0);
  });

  it('tenant A cannot get tenant B lesson by ID', async () => {
    const tenantBKey = createApiKey(ctx.db, { tenantId: 'tenant-b' });

    const createRes = await ctx.app.request('/api/lessons', {
      method: 'POST',
      headers: authHeaders(tenantBKey),
      body: JSON.stringify({ title: 'Tenant B lesson', content: 'B content' }),
    });
    const created = await createRes.json();

    const res = await ctx.app.request(`/api/lessons/${created.id}`, {
      headers: authHeaders(ctx.apiKey),
    });
    expect(res.status).toBe(404);
  });
});
