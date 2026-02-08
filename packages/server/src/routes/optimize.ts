/**
 * Optimize REST Endpoint (Story 2.4)
 *
 * GET /api/optimize/recommendations?agentId=X&period=7&limit=10
 *
 * Returns cost optimization recommendations based on LLM call patterns.
 * Requires auth (tenant-scoped).
 */

import { Hono } from 'hono';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantStore } from './tenant-helper.js';
import { OptimizationEngine } from '../lib/optimization/index.js';

export function optimizeRoutes(store: IEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET /api/optimize/recommendations
  app.get('/recommendations', async (c) => {
    const tenantStore = getTenantStore(store, c);

    // Parse and validate query params
    const agentId = c.req.query('agentId') || undefined;
    const periodStr = c.req.query('period');
    const limitStr = c.req.query('limit');

    // period: integer 1-90, default 7
    let period = 7;
    if (periodStr !== undefined && periodStr !== '') {
      const parsed = parseInt(periodStr, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 90) {
        return c.json(
          { error: 'Invalid period: must be an integer between 1 and 90', status: 400 },
          400,
        );
      }
      period = parsed;
    }

    // limit: integer 1-50, default 10
    let limit = 10;
    if (limitStr !== undefined && limitStr !== '') {
      const parsed = parseInt(limitStr, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 50) {
        return c.json(
          { error: 'Invalid limit: must be an integer between 1 and 50', status: 400 },
          400,
        );
      }
      limit = parsed;
    }

    try {
      const engine = new OptimizationEngine();
      const result = await engine.getRecommendations(tenantStore, {
        agentId,
        period,
        limit,
      });

      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal error';
      return c.json({ error: message, status: 500 }, 500);
    }
  });

  return app;
}
