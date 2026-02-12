/**
 * Lore Proxy Routes — proxies lesson CRUD and community search through LoreAdapter
 */

import { Hono } from 'hono';
import type { AuthVariables } from '../middleware/auth.js';
import type { LoreAdapter } from '../lib/lore-client.js';
import { LoreError } from '../lib/lore-client.js';

export function loreProxyRoutes(adapter: LoreAdapter) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // Error handler for adapter errors
  const handleError = (c: any, err: unknown) => {
    if (err instanceof LoreError) {
      return c.json({ error: err.message }, err.statusCode as 500);
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: message }, 500);
  };

  // POST / — Create lesson
  app.post('/', async (c) => {
    try {
      const body = await c.req.json();
      const result = await adapter.createLesson(body);
      return c.json(result, 201);
    } catch (err) { return handleError(c, err); }
  });

  // GET / — List lessons
  app.get('/', async (c) => {
    try {
      const query = {
        category: c.req.query('category'),
        agentId: c.req.query('agentId'),
        importance: c.req.query('importance'),
        search: c.req.query('search'),
        limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
        offset: c.req.query('offset') ? Number(c.req.query('offset')) : undefined,
      };
      // Remove undefined keys
      const cleaned = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined));
      const result = await adapter.listLessons(cleaned);
      return c.json(result);
    } catch (err) { return handleError(c, err); }
  });

  // GET /:id — Get lesson
  app.get('/:id', async (c) => {
    try {
      const result = await adapter.getLesson(c.req.param('id'));
      return c.json(result);
    } catch (err) { return handleError(c, err); }
  });

  // PUT /:id — Update lesson
  app.put('/:id', async (c) => {
    try {
      const body = await c.req.json();
      const result = await adapter.updateLesson(c.req.param('id'), body);
      return c.json(result);
    } catch (err) { return handleError(c, err); }
  });

  // DELETE /:id — Delete lesson
  app.delete('/:id', async (c) => {
    try {
      const result = await adapter.deleteLesson(c.req.param('id'));
      return c.json(result);
    } catch (err) { return handleError(c, err); }
  });

  return app;
}

export function loreCommunityProxyRoutes(adapter: LoreAdapter) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET /search — Search community lessons
  app.get('/search', async (c) => {
    try {
      const query = c.req.query('q') ?? c.req.query('query') ?? '';
      const options = {
        category: c.req.query('category') || undefined,
        limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
      };
      const result = await adapter.searchCommunity(query, options);
      return c.json(result);
    } catch (err) {
      if (err instanceof LoreError) {
        return c.json({ error: err.message }, err.statusCode as 500);
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
