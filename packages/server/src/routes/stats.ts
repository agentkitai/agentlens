/**
 * Stats Endpoint (Story 4.7)
 *
 * GET /api/stats — storage statistics
 */

import { Hono } from 'hono';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantStore } from './tenant-helper.js';

export function statsRoutes(store: IEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET /api/stats — storage statistics
  app.get('/', async (c) => {
    const tenantStore = getTenantStore(store, c);
    const stats = await tenantStore.getStats();
    return c.json(stats);
  });

  return app;
}
