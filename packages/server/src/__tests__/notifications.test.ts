/**
 * Tests for Notification Channels & Router (Feature 12)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, authHeaders, type TestContext } from './test-helpers.js';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestApp();
});

describe('Notification Channel CRUD', () => {
  const webhookChannel = {
    type: 'webhook',
    name: 'Test Webhook',
    config: { url: 'https://example.com/hook', method: 'POST' },
  };

  it('creates a webhook channel', async () => {
    const res = await ctx.app.request('/api/notifications/channels', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify(webhookChannel),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.name).toBe('Test Webhook');
    expect(body.type).toBe('webhook');
    expect(body.enabled).toBe(true);
  });

  it('lists channels', async () => {
    // Create one first
    await ctx.app.request('/api/notifications/channels', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify(webhookChannel),
    });

    const res = await ctx.app.request('/api/notifications/channels', {
      headers: authHeaders(ctx.apiKey),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channels.length).toBe(1);
  });

  it('gets a channel by ID', async () => {
    const createRes = await ctx.app.request('/api/notifications/channels', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify(webhookChannel),
    });
    const created = await createRes.json();

    const res = await ctx.app.request(`/api/notifications/channels/${created.id}`, {
      headers: authHeaders(ctx.apiKey),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(created.id);
  });

  it('updates a channel', async () => {
    const createRes = await ctx.app.request('/api/notifications/channels', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify(webhookChannel),
    });
    const created = await createRes.json();

    const res = await ctx.app.request(`/api/notifications/channels/${created.id}`, {
      method: 'PUT',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({ name: 'Updated Name' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated Name');
  });

  it('deletes a channel', async () => {
    const createRes = await ctx.app.request('/api/notifications/channels', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify(webhookChannel),
    });
    const created = await createRes.json();

    const delRes = await ctx.app.request(`/api/notifications/channels/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders(ctx.apiKey),
    });
    expect(delRes.status).toBe(200);

    const getRes = await ctx.app.request(`/api/notifications/channels/${created.id}`, {
      headers: authHeaders(ctx.apiKey),
    });
    expect(getRes.status).toBe(404);
  });

  it('validates channel config', async () => {
    const res = await ctx.app.request('/api/notifications/channels', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({
        type: 'webhook',
        name: 'Bad',
        config: { notAUrl: true },
      }),
    });
    expect(res.status).toBe(400);
  });

  it('redacts secrets in responses', async () => {
    const res = await ctx.app.request('/api/notifications/channels', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({
        type: 'pagerduty',
        name: 'PD Channel',
        config: { routingKey: 'my-secret-key' },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.config.routingKey).toBe('***');
  });

  it('creates a slack channel', async () => {
    const res = await ctx.app.request('/api/notifications/channels', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({
        type: 'slack',
        name: 'Slack Alerts',
        config: { webhookUrl: 'https://hooks.slack.com/services/xxx' },
      }),
    });
    expect(res.status).toBe(201);
  });

  it('creates an email channel', async () => {
    const res = await ctx.app.request('/api/notifications/channels', {
      method: 'POST',
      headers: authHeaders(ctx.apiKey),
      body: JSON.stringify({
        type: 'email',
        name: 'Email Alerts',
        config: {
          smtpHost: 'smtp.example.com',
          smtpPort: 587,
          from: 'alerts@example.com',
          to: ['ops@example.com'],
        },
      }),
    });
    expect(res.status).toBe(201);
  });
});

describe('Notification Log', () => {
  it('returns empty log initially', async () => {
    const res = await ctx.app.request('/api/notifications/log', {
      headers: authHeaders(ctx.apiKey),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toEqual([]);
    expect(body.total).toBe(0);
  });
});
