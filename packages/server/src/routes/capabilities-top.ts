/**
 * Top-level Capability Routes (dashboard-facing)
 *
 * GET  /api/capabilities          — list all capabilities (optionally filter by taskType/agentId)
 * POST /api/capabilities          — register a new capability (agentId in body)
 * PUT  /api/capabilities/:id      — update a capability by ID
 */

import { Hono } from 'hono';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import type { SqliteDb } from '../db/index.js';
import { CapabilityStore, ValidationError } from '../db/capability-store.js';
import { getTenantStore, getTenantId } from './tenant-helper.js';

export function capabilityTopRoutes(store: IEventStore, db: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const capStore = new CapabilityStore(db);

  // GET / — list all capabilities for tenant
  app.get('/', async (c) => {
    const tenantId = getTenantId(c);
    const taskType = c.req.query('taskType') || undefined;
    const agentId = c.req.query('agentId') || undefined;
    const capabilities = capStore.listByTenant(tenantId, { taskType, agentId });
    return c.json({ capabilities });
  });

  // POST / — register a new capability (agentId in body)
  app.post('/', async (c) => {
    const tenantId = getTenantId(c);
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const agentId = body.agentId as string;
    if (!agentId) {
      return c.json({ error: 'agentId is required', status: 400 }, 400);
    }

    try {
      const capability = capStore.create(tenantId, agentId, body as any);
      return c.json(capability, 201);
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ error: err.message, status: 400 }, 400);
      }
      throw err;
    }
  });

  // PUT /:id — update a capability by ID
  app.put('/:id', async (c) => {
    const tenantId = getTenantId(c);
    const capabilityId = c.req.param('id');
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    try {
      const capability = capStore.update(tenantId, capabilityId, body as any);
      return c.json(capability);
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ error: err.message, status: 400 }, 400);
      }
      if ((err as any)?.name === 'NotFoundError') {
        return c.json({ error: 'Capability not found', status: 404 }, 404);
      }
      throw err;
    }
  });

  return app;
}
