/**
 * Tests for Capability Registration REST API (Story 5.2)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, createApiKey, authHeaders, type TestContext } from './test-helpers.js';
import { SqliteEventStore } from '../db/sqlite-store.js';

describe('Capability Registration REST API (Story 5.2)', () => {
  let ctx: TestContext;

  const validCapability = {
    taskType: 'translation',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { translated: { type: 'string' } } },
  };

  beforeEach(async () => {
    ctx = createTestApp({ authDisabled: false });
    // Create an agent
    await ctx.store.upsertAgent({ id: 'agent-1', name: 'Test Agent', tenantId: 'default' });
  });

  // ─── PUT /api/agents/:id/capabilities ────────────────────

  describe('PUT /api/agents/:id/capabilities', () => {
    it('should register a capability and return 201', async () => {
      const res = await ctx.app.request('/api/agents/agent-1/capabilities', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify(validCapability),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.capability).toBeDefined();
      expect(body.capability.taskType).toBe('translation');
      expect(body.capability.scope).toBe('internal');
    });

    it('should return anonymousAgentId', async () => {
      const res = await ctx.app.request('/api/agents/agent-1/capabilities', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify(validCapability),
      });
      const body = await res.json();
      expect(body.anonymousAgentId).toBeDefined();
      expect(typeof body.anonymousAgentId).toBe('string');
    });

    it('should return 400 on invalid taskType', async () => {
      const res = await ctx.app.request('/api/agents/agent-1/capabilities', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ ...validCapability, taskType: 'invalid' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/taskType/);
    });

    it('should return 400 on invalid inputSchema', async () => {
      const res = await ctx.app.request('/api/agents/agent-1/capabilities', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ ...validCapability, inputSchema: null }),
      });
      expect(res.status).toBe(400);
    });

    it('should return 400 on invalid outputSchema', async () => {
      const res = await ctx.app.request('/api/agents/agent-1/capabilities', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ ...validCapability, outputSchema: 'not-an-object' }),
      });
      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent agent', async () => {
      const res = await ctx.app.request('/api/agents/nonexistent/capabilities', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify(validCapability),
      });
      expect(res.status).toBe(404);
    });

    it('should return 401 without auth', async () => {
      const res = await ctx.app.request('/api/agents/agent-1/capabilities', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validCapability),
      });
      expect(res.status).toBe(401);
    });

    it('should return 400 on invalid JSON body', async () => {
      const res = await ctx.app.request('/api/agents/agent-1/capabilities', {
        method: 'PUT',
        headers: { ...authHeaders(ctx.apiKey), 'Content-Type': 'application/json' },
        body: 'not-json',
      });
      expect(res.status).toBe(400);
    });

    it('should return 400 on invalid customType format', async () => {
      const res = await ctx.app.request('/api/agents/agent-1/capabilities', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ ...validCapability, taskType: 'custom', customType: 'has spaces' }),
      });
      expect(res.status).toBe(400);
    });

    it('should allow multiple capabilities per agent', async () => {
      await ctx.app.request('/api/agents/agent-1/capabilities', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify(validCapability),
      });
      await ctx.app.request('/api/agents/agent-1/capabilities', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ ...validCapability, taskType: 'summarization' }),
      });

      const listRes = await ctx.app.request('/api/agents/agent-1/capabilities', {
        headers: authHeaders(ctx.apiKey),
      });
      const body = await listRes.json();
      expect(body.capabilities).toHaveLength(2);
    });
  });

  // ─── GET /api/agents/:id/capabilities ────────────────────

  describe('GET /api/agents/:id/capabilities', () => {
    it('should return empty array for agent with no capabilities', async () => {
      const res = await ctx.app.request('/api/agents/agent-1/capabilities', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.capabilities).toEqual([]);
    });

    it('should return capabilities for agent', async () => {
      await ctx.app.request('/api/agents/agent-1/capabilities', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify(validCapability),
      });

      const res = await ctx.app.request('/api/agents/agent-1/capabilities', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.capabilities).toHaveLength(1);
      expect(body.capabilities[0].taskType).toBe('translation');
    });

    it('should return anonymousAgentId in list response', async () => {
      const res = await ctx.app.request('/api/agents/agent-1/capabilities', {
        headers: authHeaders(ctx.apiKey),
      });
      const body = await res.json();
      expect(body.anonymousAgentId).toBeDefined();
    });

    it('should return 404 for non-existent agent', async () => {
      const res = await ctx.app.request('/api/agents/nonexistent/capabilities', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(404);
    });

    it('should return 401 without auth', async () => {
      const res = await ctx.app.request('/api/agents/agent-1/capabilities', {
        headers: {},
      });
      expect(res.status).toBe(401);
    });
  });

  // ─── DELETE /api/agents/:id/capabilities/:capabilityId ────

  describe('DELETE /api/agents/:id/capabilities/:capabilityId', () => {
    it('should delete a capability', async () => {
      const putRes = await ctx.app.request('/api/agents/agent-1/capabilities', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify(validCapability),
      });
      const { capability } = await putRes.json();

      const delRes = await ctx.app.request(`/api/agents/agent-1/capabilities/${capability.id}`, {
        method: 'DELETE',
        headers: authHeaders(ctx.apiKey),
      });
      expect(delRes.status).toBe(200);
      const body = await delRes.json();
      expect(body.deleted).toBe(true);

      // Verify it's gone
      const listRes = await ctx.app.request('/api/agents/agent-1/capabilities', {
        headers: authHeaders(ctx.apiKey),
      });
      const listBody = await listRes.json();
      expect(listBody.capabilities).toHaveLength(0);
    });

    it('should return 404 for non-existent capability', async () => {
      const res = await ctx.app.request('/api/agents/agent-1/capabilities/nonexistent', {
        method: 'DELETE',
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(404);
    });

    it('should return 404 for non-existent agent', async () => {
      const res = await ctx.app.request('/api/agents/nonexistent/capabilities/some-id', {
        method: 'DELETE',
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(404);
    });

    it('should return 401 without auth', async () => {
      const res = await ctx.app.request('/api/agents/agent-1/capabilities/some-id', {
        method: 'DELETE',
        headers: {},
      });
      expect(res.status).toBe(401);
    });
  });

  // ─── Tenant isolation ────────────────────────────────────

  describe('Tenant isolation', () => {
    it('should not see capabilities from another tenant', async () => {
      // Create capability as default tenant
      await ctx.app.request('/api/agents/agent-1/capabilities', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify(validCapability),
      });

      // Create a second tenant key
      const tenant2Key = createApiKey(ctx.db, { tenantId: 'tenant-2' });
      // Create the same agent in tenant-2
      await ctx.store.upsertAgent({ id: 'agent-1', name: 'Test Agent', tenantId: 'tenant-2' });

      // List as tenant-2 — should be empty
      const res = await ctx.app.request('/api/agents/agent-1/capabilities', {
        headers: authHeaders(tenant2Key),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.capabilities).toHaveLength(0);
    });

    it('should not delete capability from another tenant', async () => {
      const putRes = await ctx.app.request('/api/agents/agent-1/capabilities', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify(validCapability),
      });
      const { capability } = await putRes.json();

      // Try to delete as tenant-2
      const tenant2Key = createApiKey(ctx.db, { tenantId: 'tenant-2' });
      await ctx.store.upsertAgent({ id: 'agent-1', name: 'Test Agent', tenantId: 'tenant-2' });

      const res = await ctx.app.request(`/api/agents/agent-1/capabilities/${capability.id}`, {
        method: 'DELETE',
        headers: authHeaders(tenant2Key),
      });
      expect(res.status).toBe(404);

      // Verify still exists for original tenant
      const listRes = await ctx.app.request('/api/agents/agent-1/capabilities', {
        headers: authHeaders(ctx.apiKey),
      });
      const body = await listRes.json();
      expect(body.capabilities).toHaveLength(1);
    });
  });
});
