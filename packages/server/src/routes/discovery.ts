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
import { updateDiscoveryConfigSchema, updateCapabilityPermissionsSchema } from '../schemas/discovery.js';
import { formatZodErrors } from '../middleware/validation.js';
import { getTenantId } from './tenant-helper.js';

const VALID_TASK_TYPES = new Set<string>(TASK_TYPES);

export function discoveryRoutes(db: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const service = new DiscoveryService(db);

  /**
   * @summary Discover agent capabilities by task type
   * @description Searches for agents that can handle the specified task type, filtered by optional
   * trust score, cost, and latency constraints. Currently limited to internal scope (B3).
   * @param {string} taskType — required TaskType (query param)
   * @param {string} [customType] — custom sub-type (query param)
   * @param {number} [minTrust] — minimum trust score (query param)
   * @param {number} [maxCost] — max cost in USD (query param)
   * @param {number} [maxLatency] — max latency in ms (query param)
   * @param {number} [limit] — max results, capped at 20 (query param, default 20)
   * @returns {200} `{ results: DiscoveryResult[], total: number }`
   * @throws {400} Missing or invalid taskType
   */
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

  /**
   * @summary Get tenant discovery configuration
   * @description Returns the discovery settings for the tenant (e.g., minimum trust threshold, delegation toggle).
   * @returns {200} `{ config: DiscoveryConfig }`
   */
  app.get('/discovery/config', async (c) => {
    const tenantId = getTenantId(c);
    const config = service.getDiscoveryConfig(tenantId);
    return c.json({ config });
  });

  /**
   * @summary Update tenant discovery configuration
   * @description Partially updates the discovery config for the tenant.
   * @body {{ minTrustThreshold?: number, delegationEnabled?: boolean }}
   * @returns {200} `{ config: DiscoveryConfig }`
   * @throws {400} Invalid JSON body or minTrustThreshold out of range (0-100)
   */
  app.put('/discovery/config', async (c) => {
    const tenantId = getTenantId(c);
    const rawBody = await c.req.json().catch(() => null);
    if (rawBody === null) {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const parseResult = updateDiscoveryConfigSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return c.json({ error: 'Validation failed', status: 400, details: formatZodErrors(parseResult.error) }, 400);
    }

    const config = service.updateDiscoveryConfig(tenantId, parseResult.data);
    return c.json({ config });
  });

  /**
   * @summary Update per-capability permissions
   * @description Updates discovery and delegation permissions for a specific capability (agent).
   * @param {string} capabilityId — Capability ID (path)
   * @body {{ enabled?: boolean, acceptDelegations?: boolean, inboundRateLimit?: number, outboundRateLimit?: number }}
   * @returns {200} `{ updated: true }`
   * @throws {400} Invalid JSON body
   * @throws {404} Capability not found
   */
  app.put('/capabilities/:capabilityId/permissions', async (c) => {
    const tenantId = getTenantId(c);
    const capabilityId = c.req.param('capabilityId');

    const rawBody = await c.req.json().catch(() => null);
    if (rawBody === null) {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const parseResult = updateCapabilityPermissionsSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return c.json({ error: 'Validation failed', status: 400, details: formatZodErrors(parseResult.error) }, 400);
    }

    const ok = service.updateAgentPermissions(tenantId, capabilityId, parseResult.data);
    if (!ok) {
      return c.json({ error: 'Capability not found', status: 404 }, 404);
    }

    return c.json({ updated: true });
  });

  return { app, service };
}
