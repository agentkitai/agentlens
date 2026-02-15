/**
 * Tests for Alert Rule CRUD endpoints (Story 12.1) and alert history.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, authHeaders, type TestContext } from './test-helpers.js';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestApp();
});

describe('POST /api/alerts/rules', () => {
  it('creates an alert rule with valid data', async () => {
    const res = await ctx.app.request('/api/alerts/rules', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({
        name: 'High Error Rate',
        condition: 'error_rate_exceeds',
        threshold: 0.1,
        windowMinutes: 60,
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.name).toBe('High Error Rate');
    expect(body.condition).toBe('error_rate_exceeds');
    expect(body.threshold).toBe(0.1);
    expect(body.windowMinutes).toBe(60);
    expect(body.enabled).toBe(true);
    expect(body.scope).toEqual({});
    expect(body.notifyChannels).toEqual([]);
  });

  it('creates a rule with all fields', async () => {
    const res = await ctx.app.request('/api/alerts/rules', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({
        name: 'Cost Alert',
        condition: 'cost_exceeds',
        threshold: 10.0,
        windowMinutes: 1440,
        enabled: false,
        scope: { agentId: 'my-agent' },
        notifyChannels: ['https://hooks.slack.com/xxx'],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Cost Alert');
    expect(body.enabled).toBe(false);
    expect(body.scope).toEqual({ agentId: 'my-agent' });
    expect(body.notifyChannels).toEqual(['https://hooks.slack.com/xxx']);
  });

  it('rejects invalid condition', async () => {
    const res = await ctx.app.request('/api/alerts/rules', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({
        name: 'Bad Rule',
        condition: 'invalid_condition',
        threshold: 1,
        windowMinutes: 60,
      }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects missing name', async () => {
    const res = await ctx.app.request('/api/alerts/rules', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({
        condition: 'error_rate_exceeds',
        threshold: 0.1,
        windowMinutes: 60,
      }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects negative threshold', async () => {
    const res = await ctx.app.request('/api/alerts/rules', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({
        name: 'Bad',
        condition: 'error_rate_exceeds',
        threshold: -1,
        windowMinutes: 60,
      }),
    });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/alerts/rules', () => {
  it('returns empty list initially', async () => {
    const res = await ctx.app.request('/api/alerts/rules', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rules).toEqual([]);
  });

  it('lists created rules', async () => {
    // Create two rules
    await ctx.app.request('/api/alerts/rules', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({
        name: 'Rule 1',
        condition: 'error_rate_exceeds',
        threshold: 0.1,
        windowMinutes: 60,
      }),
    });

    await ctx.app.request('/api/alerts/rules', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({
        name: 'Rule 2',
        condition: 'cost_exceeds',
        threshold: 5.0,
        windowMinutes: 1440,
      }),
    });

    const res = await ctx.app.request('/api/alerts/rules', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rules).toHaveLength(2);
  });
});

describe('GET /api/alerts/rules/:id', () => {
  it('returns a single rule', async () => {
    const createRes = await ctx.app.request('/api/alerts/rules', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({
        name: 'Test Rule',
        condition: 'latency_exceeds',
        threshold: 500,
        windowMinutes: 30,
      }),
    });
    const created = await createRes.json();

    const res = await ctx.app.request(`/api/alerts/rules/${created.id}`, {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(created.id);
    expect(body.name).toBe('Test Rule');
  });

  it('returns 404 for nonexistent rule', async () => {
    const res = await ctx.app.request('/api/alerts/rules/nonexistent', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/alerts/rules/:id', () => {
  it('updates a rule', async () => {
    const createRes = await ctx.app.request('/api/alerts/rules', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({
        name: 'Original',
        condition: 'error_rate_exceeds',
        threshold: 0.1,
        windowMinutes: 60,
      }),
    });
    const created = await createRes.json();

    const res = await ctx.app.request(`/api/alerts/rules/${created.id}`, {
      method: 'PUT',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({
        name: 'Updated',
        threshold: 0.2,
        enabled: false,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated');
    expect(body.threshold).toBe(0.2);
    expect(body.enabled).toBe(false);
    // Unchanged fields preserved
    expect(body.condition).toBe('error_rate_exceeds');
    expect(body.windowMinutes).toBe(60);
  });

  it('returns 404 for nonexistent rule', async () => {
    const res = await ctx.app.request('/api/alerts/rules/nonexistent', {
      method: 'PUT',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ name: 'Updated' }),
    });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/alerts/rules/:id', () => {
  it('deletes a rule', async () => {
    const createRes = await ctx.app.request('/api/alerts/rules', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({
        name: 'To Delete',
        condition: 'error_rate_exceeds',
        threshold: 0.1,
        windowMinutes: 60,
      }),
    });
    const created = await createRes.json();

    const delRes = await ctx.app.request(`/api/alerts/rules/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders(ctx.apiKey),
    });

    expect(delRes.status).toBe(200);
    const body = await delRes.json();
    expect(body.deleted).toBe(true);

    // Verify it's gone
    const getRes = await ctx.app.request(`/api/alerts/rules/${created.id}`, {
      headers: authHeaders(ctx.apiKey),
    });
    expect(getRes.status).toBe(404);
  });

  it('returns 404 for nonexistent rule', async () => {
    const res = await ctx.app.request('/api/alerts/rules/nonexistent', {
      method: 'DELETE',
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(404);
  });
});

describe('GET /api/alerts/history', () => {
  it('returns empty history initially', async () => {
    const res = await ctx.app.request('/api/alerts/history', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toEqual([]);
    expect(body.total).toBe(0);
  });
});
