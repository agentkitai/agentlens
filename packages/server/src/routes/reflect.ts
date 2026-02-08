/**
 * Reflect REST Endpoint (Story 4.6)
 *
 * GET /api/reflect?analysis=error_patterns&agentId=X&from=...&to=...&limit=...
 *
 * Dispatches to the appropriate analysis function based on the `analysis` param.
 * Requires auth (tenant-scoped).
 */

import { Hono } from 'hono';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantStore } from './tenant-helper.js';
import { runAnalysis } from '../lib/analysis/index.js';

const VALID_ANALYSES = [
  'error_patterns',
  'tool_sequences',
  'cost_analysis',
  'performance_trends',
  'session_comparison',
];

export function reflectRoutes(store: IEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET /api/reflect
  app.get('/', async (c) => {
    const tenantStore = getTenantStore(store, c);

    const analysis = c.req.query('analysis');
    if (!analysis) {
      return c.json(
        { error: 'Missing required query parameter: analysis', status: 400 },
        400,
      );
    }

    if (!VALID_ANALYSES.includes(analysis)) {
      return c.json(
        {
          error: `Invalid analysis type: ${analysis}. Must be one of: ${VALID_ANALYSES.join(', ')}`,
          status: 400,
        },
        400,
      );
    }

    const agentId = c.req.query('agentId') || undefined;
    const from = c.req.query('from') || undefined;
    const to = c.req.query('to') || undefined;
    const limitStr = c.req.query('limit');
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;

    try {
      const result = await runAnalysis(analysis, tenantStore, {
        agentId,
        from,
        to,
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
