/**
 * Tests for Guardrail REST API (v0.8.0 — Stories 2.1, 2.2, 2.3)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, authHeaders, type TestContext } from './test-helpers.js';

describe('Guardrail REST API', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp({ authDisabled: false });
  });

  const validRule = {
    name: 'Error Rate Guard',
    conditionType: 'error_rate_threshold',
    conditionConfig: { threshold: 30, windowMinutes: 5 },
    actionType: 'pause_agent',
    actionConfig: { message: 'Pausing due to errors' },
  };

  describe('POST /api/guardrails', () => {
    it('should create a guardrail rule', async () => {
      const res = await ctx.app.request('/api/guardrails', {
        method: 'POST',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify(validRule),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Error Rate Guard');
      expect(body.enabled).toBe(true);
      expect(body.dryRun).toBe(false);
      expect(body.cooldownMinutes).toBe(15);
    });

    it('should reject invalid body', async () => {
      const res = await ctx.app.request('/api/guardrails', {
        method: 'POST',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ name: '' }), // invalid
      });
      expect(res.status).toBe(400);
    });

    it('should reject invalid condition type', async () => {
      const res = await ctx.app.request('/api/guardrails', {
        method: 'POST',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ ...validRule, conditionType: 'invalid' }),
      });
      expect(res.status).toBe(400);
    });

    it('should require auth', async () => {
      const res = await ctx.app.request('/api/guardrails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validRule),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/guardrails', () => {
    it('should list guardrail rules', async () => {
      // Create two rules
      await ctx.app.request('/api/guardrails', {
        method: 'POST',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify(validRule),
      });
      await ctx.app.request('/api/guardrails', {
        method: 'POST',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ ...validRule, name: 'Cost Guard', conditionType: 'cost_limit', conditionConfig: { maxCostUsd: 5 } }),
      });

      const res = await ctx.app.request('/api/guardrails', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rules).toHaveLength(2);
    });
  });

  describe('GET /api/guardrails/:id', () => {
    it('should get a single rule', async () => {
      const createRes = await ctx.app.request('/api/guardrails', {
        method: 'POST',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify(validRule),
      });
      const { id } = await createRes.json();

      const res = await ctx.app.request(`/api/guardrails/${id}`, {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(id);
      expect(body.name).toBe('Error Rate Guard');
    });

    it('should return 404 for non-existent rule', async () => {
      const res = await ctx.app.request('/api/guardrails/nonexistent', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/guardrails/:id', () => {
    it('should update a rule', async () => {
      const createRes = await ctx.app.request('/api/guardrails', {
        method: 'POST',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify(validRule),
      });
      const { id } = await createRes.json();

      const res = await ctx.app.request(`/api/guardrails/${id}`, {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ name: 'Updated Guard', dryRun: true }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('Updated Guard');
      expect(body.dryRun).toBe(true);
    });

    it('should return 404 for non-existent rule', async () => {
      const res = await ctx.app.request('/api/guardrails/nonexistent', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ name: 'X' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/guardrails/:id', () => {
    it('should delete a rule', async () => {
      const createRes = await ctx.app.request('/api/guardrails', {
        method: 'POST',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify(validRule),
      });
      const { id } = await createRes.json();

      const res = await ctx.app.request(`/api/guardrails/${id}`, {
        method: 'DELETE',
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);

      // Verify it's gone
      const getRes = await ctx.app.request(`/api/guardrails/${id}`, {
        headers: authHeaders(ctx.apiKey),
      });
      expect(getRes.status).toBe(404);
    });

    it('should return 404 for non-existent rule', async () => {
      const res = await ctx.app.request('/api/guardrails/nonexistent', {
        method: 'DELETE',
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/guardrails/:id/status', () => {
    it('should return rule status with recent triggers', async () => {
      const createRes = await ctx.app.request('/api/guardrails', {
        method: 'POST',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify(validRule),
      });
      const { id } = await createRes.json();

      const res = await ctx.app.request(`/api/guardrails/${id}/status`, {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rule.id).toBe(id);
      expect(body.recentTriggers).toEqual([]);
    });

    it('should return 404 for non-existent rule', async () => {
      const res = await ctx.app.request('/api/guardrails/nonexistent/status', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/guardrails/history', () => {
    it('should return empty history initially', async () => {
      const res = await ctx.app.request('/api/guardrails/history', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.triggers).toEqual([]);
      expect(body.total).toBe(0);
    });
  });
});
