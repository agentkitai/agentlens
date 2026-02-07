/**
 * Stats Endpoint (Story 4.7)
 *
 * GET /api/stats — storage statistics
 */

import { Hono } from 'hono';
import type { IEventStore } from '@agentlens/core';
import type { AuthVariables } from '../middleware/auth.js';

export function statsRoutes(store: IEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET /api/stats — storage statistics
  app.get('/', async (c) => {
    const stats = await store.getStats();
    return c.json(stats);
  });

  return app;
}
