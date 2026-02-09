/**
 * Agent Endpoints (Story 4.7 + B1 — Story 1.2)
 *
 * GET  /api/agents          — list all agents (with error rate from sessions)
 * GET  /api/agents/:id      — single agent
 * PUT  /api/agents/:id/unpause — unpause an agent (clear paused_at, pause_reason, optionally model_override)
 */

import { Hono } from 'hono';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantStore } from './tenant-helper.js';

export function agentsRoutes(store: IEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET /api/agents — list all agents with computed error rates
  app.get('/', async (c) => {
    const tenantStore = getTenantStore(store, c);
    const agents = await tenantStore.listAgents();

    return c.json({ agents });
  });

  // PUT /api/agents/:id/unpause — Unpause an agent (B1 — Story 1.2)
  app.put('/:id/unpause', async (c) => {
    const tenantStore = getTenantStore(store, c);
    const id = c.req.param('id');

    // Verify agent exists (tenant-scoped)
    const agent = await tenantStore.getAgent(id);
    if (!agent) {
      return c.json({ error: 'Agent not found', status: 404 }, 404);
    }

    // Parse optional body for clearModelOverride
    let clearModelOverride = false;
    try {
      const body = await c.req.json().catch(() => ({}));
      clearModelOverride = body?.clearModelOverride === true;
    } catch {
      // No body or invalid JSON — that's fine
    }

    // Unpause by clearing pause fields
    const updates: Partial<import('@agentlensai/core').Agent> & { id: string } = {
      id,
      pausedAt: undefined,
      pauseReason: undefined,
    };
    if (clearModelOverride) {
      updates.modelOverride = undefined;
    }
    await tenantStore.upsertAgent(updates);

    // Return the updated agent
    const updated = await tenantStore.getAgent(id);
    return c.json(updated);
  });

  // GET /api/agents/:id — single agent
  app.get('/:id', async (c) => {
    const tenantStore = getTenantStore(store, c);
    const id = c.req.param('id');
    const agent = await tenantStore.getAgent(id);

    if (!agent) {
      return c.json({ error: 'Agent not found', status: 404 }, 404);
    }

    return c.json(agent);
  });

  return app;
}
