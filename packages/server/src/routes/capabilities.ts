/**
 * Capability Registration REST API (Story 5.2)
 *
 * PUT    /api/agents/:id/capabilities              — register a new capability
 * GET    /api/agents/:id/capabilities              — list agent's capabilities
 * DELETE /api/agents/:id/capabilities/:capabilityId — remove a capability
 */

import { Hono } from 'hono';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import type { SqliteDb } from '../db/index.js';
import { CapabilityStore, ValidationError } from '../db/capability-store.js';
import { AnonymousIdManager } from '../db/anonymous-id-manager.js';
import { getTenantStore } from './tenant-helper.js';

export function capabilityRoutes(store: IEventStore, db: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const capStore = new CapabilityStore(db);
  const anonIdManager = new AnonymousIdManager(db);

  /**
   * Helper to get tenant ID from auth context.
   */
  function getTenantId(c: { get(key: 'apiKey'): { tenantId?: string } | undefined }): string {
    return c.get('apiKey')?.tenantId ?? 'default';
  }

  // PUT /:id/capabilities — register or update a capability
  app.put('/:id/capabilities', async (c) => {
    const tenantId = getTenantId(c);
    const agentId = c.req.param('id');

    // Verify agent exists
    const tenantStore = getTenantStore(store, c);
    const agent = await tenantStore.getAgent(agentId);
    if (!agent) {
      return c.json({ error: 'Agent not found', status: 404 }, 404);
    }

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    try {
      const capability = capStore.create(tenantId, agentId, body as Parameters<typeof capStore.create>[2]);
      const anonymousAgentId = anonIdManager.getOrRotateAnonymousId(tenantId, agentId);
      return c.json({ capability, anonymousAgentId }, 201);
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ error: err.message, status: 400 }, 400);
      }
      throw err;
    }
  });

  // GET /:id/capabilities — list agent's capabilities
  app.get('/:id/capabilities', async (c) => {
    const tenantId = getTenantId(c);
    const agentId = c.req.param('id');

    // Verify agent exists
    const tenantStore = getTenantStore(store, c);
    const agent = await tenantStore.getAgent(agentId);
    if (!agent) {
      return c.json({ error: 'Agent not found', status: 404 }, 404);
    }

    const capabilities = capStore.listByAgent(tenantId, agentId);
    const anonymousAgentId = anonIdManager.getOrRotateAnonymousId(tenantId, agentId);
    return c.json({ capabilities, anonymousAgentId });
  });

  // DELETE /:id/capabilities/:capabilityId — remove a capability
  app.delete('/:id/capabilities/:capabilityId', async (c) => {
    const tenantId = getTenantId(c);
    const agentId = c.req.param('id');
    const capabilityId = c.req.param('capabilityId');

    // Verify agent exists
    const tenantStore = getTenantStore(store, c);
    const agent = await tenantStore.getAgent(agentId);
    if (!agent) {
      return c.json({ error: 'Agent not found', status: 404 }, 404);
    }

    // Verify the capability belongs to this agent
    const existing = capStore.getById(tenantId, capabilityId);
    if (!existing || existing.agentId !== agentId) {
      return c.json({ error: 'Capability not found', status: 404 }, 404);
    }

    capStore.delete(tenantId, capabilityId);
    return c.json({ deleted: true });
  });

  return app;
}
