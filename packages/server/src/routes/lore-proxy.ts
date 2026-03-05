/**
 * Lore Proxy Routes — read-only proxy to Lore v0.5.0 server for dashboard display.
 *
 * Routes:
 *   GET /api/lore/memories       → list memories (paginated)
 *   GET /api/lore/memories/:id   → single memory detail
 *   GET /api/lore/stats          → aggregate stats by type
 */

import { Hono } from 'hono';
import type { AuthVariables } from '../middleware/auth.js';
import { LoreError, type LoreReadAdapter } from '../lib/lore-client.js';

export function loreProxyRoutes(adapter: LoreReadAdapter) {
  const app = new Hono<{ Variables: AuthVariables }>();

  const handleError = (c: any, err: unknown) => {
    if (err instanceof LoreError) {
      if (err.statusCode === 401 || err.statusCode === 403) {
        return c.json({ error: 'Lore authentication failed', code: 'LORE_AUTH_ERROR', loreStatus: err.statusCode }, 502);
      }
      if (err.statusCode === 404) {
        return c.json({ error: 'Memory not found', code: 'NOT_FOUND' }, 404);
      }
      if (err.statusCode >= 500) {
        return c.json({ error: 'Lore server error', code: 'LORE_SERVER_ERROR', loreStatus: err.statusCode }, 502);
      }
      return c.json({ error: err.message, code: 'LORE_ERROR', loreStatus: err.statusCode }, err.statusCode as 500);
    }
    if (err instanceof Error && err.name === 'TimeoutError') {
      return c.json({ error: 'Lore request timed out', code: 'LORE_TIMEOUT' }, 504);
    }
    if (err instanceof TypeError && (err.message.includes('fetch') || err.message.includes('ECONNREFUSED'))) {
      return c.json({ error: 'Lore service unavailable', code: 'LORE_UNAVAILABLE' }, 503);
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: message, code: 'LORE_UNAVAILABLE' }, 503);
  };

  // GET /memories — List memories
  app.get('/memories', async (c) => {
    try {
      const result = await adapter.listMemories({
        project: c.req.query('project') || undefined,
        search: c.req.query('search') || undefined,
        limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
        offset: c.req.query('offset') ? Number(c.req.query('offset')) : undefined,
      });
      return c.json(result);
    } catch (err) { return handleError(c, err); }
  });

  // GET /memories/:id — Get single memory
  app.get('/memories/:id', async (c) => {
    try {
      const memory = await adapter.getMemory(c.req.param('id'));
      if (!memory) {
        return c.json({ error: 'Memory not found', code: 'NOT_FOUND' }, 404);
      }
      return c.json(memory);
    } catch (err) { return handleError(c, err); }
  });

  // GET /stats — Aggregate stats
  app.get('/stats', async (c) => {
    try {
      const result = await adapter.getStats(c.req.query('project') || undefined);
      return c.json(result);
    } catch (err) { return handleError(c, err); }
  });

  return app;
}
