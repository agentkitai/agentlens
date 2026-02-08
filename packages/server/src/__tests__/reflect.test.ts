/**
 * Tests for Reflect REST Endpoint (Story 4.6)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, authHeaders, type TestContext } from './test-helpers.js';

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestApp();
});

describe('GET /api/reflect', () => {
  it('returns 400 without analysis parameter', async () => {
    const res = await ctx.app.request('/api/reflect', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Missing required query parameter: analysis');
  });

  it('returns 400 for invalid analysis type', async () => {
    const res = await ctx.app.request('/api/reflect?analysis=invalid', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid analysis type');
  });

  it('returns error_patterns analysis result', async () => {
    const res = await ctx.app.request('/api/reflect?analysis=error_patterns', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analysis).toBe('error_patterns');
    expect(body.insights).toBeDefined();
    expect(Array.isArray(body.insights)).toBe(true);
    expect(body.metadata).toBeDefined();
    expect(body.metadata.eventsAnalyzed).toBeDefined();
  });

  it('returns tool_sequences analysis result', async () => {
    const res = await ctx.app.request('/api/reflect?analysis=tool_sequences', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analysis).toBe('tool_sequences');
    expect(body.insights).toBeDefined();
    expect(body.metadata).toBeDefined();
  });

  it('returns cost_analysis result', async () => {
    const res = await ctx.app.request('/api/reflect?analysis=cost_analysis', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analysis).toBe('cost_analysis');
    expect(body.insights).toBeDefined();
  });

  it('returns performance_trends result', async () => {
    const res = await ctx.app.request('/api/reflect?analysis=performance_trends', {
      headers: authHeaders(ctx.apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analysis).toBe('performance_trends');
    expect(body.insights).toBeDefined();
    expect(body.metadata).toBeDefined();
  });

  it('passes query parameters through', async () => {
    const res = await ctx.app.request(
      '/api/reflect?analysis=error_patterns&agentId=test-agent&from=2024-01-01&to=2024-12-31&limit=5',
      {
        headers: authHeaders(ctx.apiKey),
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analysis).toBe('error_patterns');
  });

  it('requires authentication', async () => {
    const res = await ctx.app.request('/api/reflect?analysis=error_patterns');

    expect(res.status).toBe(401);
  });
});
