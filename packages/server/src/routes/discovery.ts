/**
 * Discovery REST API (Story 5.3 + 5.4)
 *
 * GET  /api/agents/discover — discover capabilities
 * PUT  /api/agents/discovery/config — update tenant discovery config
 * GET  /api/agents/discovery/config — get tenant discovery config
 * PUT  /api/agents/capabilities/:capabilityId/permissions — update per-agent permissions
 */

import { Hono } from 'hono';
import type { AuthVariables } from '../middleware/auth.js';
import type { SqliteDb } from '../db/index.js';
import { DiscoveryService } from '../services/discovery-service.js';
import { TASK_TYPES, type DiscoveryQuery, type TaskType } from '@agentlensai/core';

const VALID_TASK_TYPES = new Set<string>(TASK_TYPES);

export function discoveryRoutes(db: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const service = new DiscoveryService(db);

  function getTenantId(c: { get(key: 'apiKey'): { tenantId?: string } | undefined }): string {
    return c.get('apiKey')?.tenantId ?? 'default';
  }

  // GET /discover — discover capabilities
  app.get('/discover', async (c) => {
    const tenantId = getTenantId(c);

    const taskType = c.req.query('taskType');
    if (!taskType || !VALID_TASK_TYPES.has(taskType)) {
      return c.json({ error: 'taskType is required and must be a valid TaskType', status: 400 }, 400);
    }

    const query: DiscoveryQuery = {
      taskType: taskType as TaskType,
      customType: c.req.query('customType') || undefined,
      minTrustScore: c.req.query('minTrust') ? Number(c.req.query('minTrust')) : undefined,
      maxCostUsd: c.req.query('maxCost') ? Number(c.req.query('maxCost')) : undefined,
      maxLatencyMs: c.req.query('maxLatency') ? Number(c.req.query('maxLatency')) : undefined,
      scope: 'internal', // Only internal for now (B3)
      limit: c.req.query('limit') ? Math.min(Number(c.req.query('limit')), 20) : 20,
    };

    const results = service.discover(tenantId, query);
    return c.json({ results, total: results.length });
  });

  // GET /discovery/config — get tenant discovery config
  app.get('/discovery/config', async (c) => {
    const tenantId = getTenantId(c);
    const config = service.getDiscoveryConfig(tenantId);
    return c.json({ config });
  });

  // PUT /discovery/config — update tenant discovery config
  app.put('/discovery/config', async (c) => {
    const tenantId = getTenantId(c);
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const updates: Record<string, unknown> = {};
    if (body.minTrustThreshold !== undefined) {
      const val = Number(body.minTrustThreshold);
      if (isNaN(val) || val < 0 || val > 100) {
        return c.json({ error: 'minTrustThreshold must be 0-100', status: 400 }, 400);
      }
      updates.minTrustThreshold = val;
    }
    if (body.delegationEnabled !== undefined) {
      updates.delegationEnabled = Boolean(body.delegationEnabled);
    }

    const config = service.updateDiscoveryConfig(tenantId, updates);
    return c.json({ config });
  });

  // PUT /capabilities/:capabilityId/permissions — update per-agent permissions
  app.put('/capabilities/:capabilityId/permissions', async (c) => {
    const tenantId = getTenantId(c);
    const capabilityId = c.req.param('capabilityId');

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const updates: Record<string, unknown> = {};
    if (body.enabled !== undefined) updates.enabled = Boolean(body.enabled);
    if (body.acceptDelegations !== undefined) updates.acceptDelegations = Boolean(body.acceptDelegations);
    if (body.inboundRateLimit !== undefined) updates.inboundRateLimit = Number(body.inboundRateLimit);
    if (body.outboundRateLimit !== undefined) updates.outboundRateLimit = Number(body.outboundRateLimit);

    const ok = service.updateAgentPermissions(tenantId, capabilityId, updates);
    if (!ok) {
      return c.json({ error: 'Capability not found', status: 404 }, 404);
    }

    return c.json({ updated: true });
  });

  return { app, service };
}
