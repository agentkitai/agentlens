/**
 * Optimization Advisor Endpoints (Feature 10)
 *
 * GET /api/agents/:id/optimize — per-agent optimization suggestions
 * GET /api/optimize/summary    — aggregate suggestions across all agents
 */

import { Hono } from 'hono';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantStore } from './tenant-helper.js';
import { getOptimizationSuggestions, getOptimizationSummary } from '../services/optimization-advisor.js';

export function optimizationAdvisorRoutes(store: IEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET /api/agents/:id/optimize
  app.get('/agents/:id/optimize', async (c) => {
    const tenantStore = getTenantStore(store, c);
    const agentId = c.req.param('id');

    if (!agentId) {
      return c.json({ error: 'Agent ID is required', status: 400 }, 400);
    }

    try {
      const result = await getOptimizationSuggestions(tenantStore, agentId);
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal error';
      return c.json({ error: message, status: 500 }, 500);
    }
  });

  // GET /api/optimize/summary
  app.get('/optimize/summary', async (c) => {
    const tenantStore = getTenantStore(store, c);

    try {
      const result = await getOptimizationSummary(tenantStore);
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal error';
      return c.json({ error: message, status: 500 }, 500);
    }
  });

  return app;
}
