/**
 * Tests for Discovery REST API (Stories 5.3 + 5.4)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, authHeaders, type TestContext } from './test-helpers.js';
import { CapabilityStore } from '../db/capability-store.js';
import { DiscoveryService } from '../services/discovery-service.js';

describe('Discovery REST API (Stories 5.3 + 5.4)', () => {
  let ctx: TestContext;
  let capStore: CapabilityStore;
  let service: DiscoveryService;

  const baseInput = {
    taskType: 'translation',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { translated: { type: 'string' } } },
  };

  beforeEach(async () => {
    ctx = await createTestApp();
    capStore = new CapabilityStore(ctx.db);
    service = new DiscoveryService(ctx.db);
    // Lower trust threshold for most tests
    service.updateDiscoveryConfig('default', { minTrustThreshold: 0 });
  });

  // ─── GET /api/agents/discover ─────────────────────────

  describe('GET /api/agents/discover', () => {
    it('should require taskType parameter', async () => {
      const res = await ctx.app.request('/api/agents/discover', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('taskType');
    });

    it('should reject invalid taskType', async () => {
      const res = await ctx.app.request('/api/agents/discover?taskType=invalid', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(400);
    });

    it('should return empty results when no capabilities', async () => {
      const res = await ctx.app.request('/api/agents/discover?taskType=translation', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('should return matching capabilities', async () => {
      const cap = capStore.create('default', 'agent-1', baseInput as any);
      // enabled is true by default

      const res = await ctx.app.request('/api/agents/discover?taskType=translation', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(1);
      expect(body.results[0].taskType).toBe('translation');
    });

    it('should support minTrust query parameter', async () => {
      capStore.create('default', 'agent-1', {
        ...baseInput,
        qualityMetrics: { trustScorePercentile: 30 },
      } as any);

      const res = await ctx.app.request('/api/agents/discover?taskType=translation&minTrust=50', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(0);
    });

    it('should support maxCost query parameter', async () => {
      capStore.create('default', 'agent-1', {
        ...baseInput,
        estimatedCostUsd: 5.0,
      } as any);

      const res = await ctx.app.request('/api/agents/discover?taskType=translation&maxCost=1.0', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(0);
    });

    it('should support maxLatency query parameter', async () => {
      capStore.create('default', 'agent-1', {
        ...baseInput,
        estimatedLatencyMs: 5000,
      } as any);

      const res = await ctx.app.request('/api/agents/discover?taskType=translation&maxLatency=1000', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(0);
    });

    it('should support limit query parameter', async () => {
      for (let i = 0; i < 10; i++) {
        capStore.create('default', `agent-${i}`, baseInput as any);
      }

      const res = await ctx.app.request('/api/agents/discover?taskType=translation&limit=3', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(3);
    });

    it('should support customType filter', async () => {
      capStore.create('default', 'agent-1', {
        ...baseInput,
        taskType: 'custom',
        customType: 'my-task',
      } as any);

      const res = await ctx.app.request('/api/agents/discover?taskType=custom&customType=my-task', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(1);
    });
  });

  // ─── Discovery Config API ─────────────────────────────

  describe('GET /api/agents/discovery/config', () => {
    it('should return default config', async () => {
      const res = await ctx.app.request('/api/agents/discovery/config', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.config.minTrustThreshold).toBeDefined();
    });
  });

  describe('PUT /api/agents/discovery/config', () => {
    it('should update trust threshold', async () => {
      const res = await ctx.app.request('/api/agents/discovery/config', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ minTrustThreshold: 80 }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.config.minTrustThreshold).toBe(80);
    });

    it('should update delegationEnabled', async () => {
      const res = await ctx.app.request('/api/agents/discovery/config', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ delegationEnabled: true }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.config.delegationEnabled).toBe(true);
    });

    it('should reject invalid trust threshold', async () => {
      const res = await ctx.app.request('/api/agents/discovery/config', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ minTrustThreshold: 150 }),
      });
      expect(res.status).toBe(400);
    });

    it('should reject invalid JSON', async () => {
      const res = await ctx.app.request('/api/agents/discovery/config', {
        method: 'PUT',
        headers: { ...authHeaders(ctx.apiKey), 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── Permission API ───────────────────────────────────

  describe('PUT /api/agents/capabilities/:id/permissions', () => {
    it('should update capability permissions', async () => {
      const cap = capStore.create('default', 'agent-1', baseInput as any);

      const res = await ctx.app.request(`/api/agents/capabilities/${cap.id}/permissions`, {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ enabled: false, acceptDelegations: true }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.updated).toBe(true);

      // Verify the update
      const updated = capStore.getById('default', cap.id);
      expect(updated!.enabled).toBe(false);
      expect(updated!.acceptDelegations).toBe(true);
    });

    it('should return 404 for non-existent capability', async () => {
      const res = await ctx.app.request('/api/agents/capabilities/nonexistent/permissions', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ enabled: false }),
      });
      expect(res.status).toBe(404);
    });
  });
});
