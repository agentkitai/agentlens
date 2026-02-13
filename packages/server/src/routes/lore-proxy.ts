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

  // POST /:id/rate — Rate a lesson
  app.post('/:id/rate', async (c) => {
    try {
      const { delta } = await c.req.json();
      const result = await adapter.rateLesson(c.req.param('id'), delta);
      return c.json(result);
    } catch (err) { return handleError(c, err); }
  });

  return app;
}

export function loreCommunityProxyRoutes(adapter: LoreAdapter) {
  const app = new Hono<{ Variables: AuthVariables }>();

  const handleError = (c: any, err: unknown) => {
    if (err instanceof LoreError) {
      return c.json({ error: err.message }, err.statusCode as 500);
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: message }, 500);
  };

  // GET /search — Search community lessons
  app.get('/search', async (c) => {
    try {
      const query = c.req.query('q') ?? c.req.query('query') ?? '';
      const options = {
        category: c.req.query('category') || undefined,
        limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
        minReputation: c.req.query('minReputation') ? Number(c.req.query('minReputation')) : undefined,
      };
      const result = await adapter.searchCommunity(query, options);
      return c.json(result);
    } catch (err) { return handleError(c, err); }
  });

  // POST /rate — Rate a community lesson
  app.post('/rate', async (c) => {
    try {
      const { lessonId, delta } = await c.req.json();
      const result = await adapter.rateLesson(lessonId, delta);
      return c.json(result);
    } catch (err) { return handleError(c, err); }
  });

  // GET /config — Get sharing config
  app.get('/config', async (c) => {
    try {
      return c.json(await adapter.getSharingConfig());
    } catch (err) { return handleError(c, err); }
  });

  // PUT /config — Update sharing config
  app.put('/config', async (c) => {
    try {
      const body = await c.req.json();
      return c.json(await adapter.updateSharingConfig(body));
    } catch (err) { return handleError(c, err); }
  });

  // GET /agents — Get agent sharing configs
  app.get('/agents', async (c) => {
    try {
      return c.json(await adapter.getAgentSharingConfigs());
    } catch (err) { return handleError(c, err); }
  });

  // PUT /agents/:agentId — Update agent sharing config
  app.put('/agents/:agentId', async (c) => {
    try {
      const body = await c.req.json();
      return c.json(await adapter.updateAgentSharingConfig(c.req.param('agentId'), body));
    } catch (err) { return handleError(c, err); }
  });

  // GET /deny-list — Get deny list
  app.get('/deny-list', async (c) => {
    try {
      return c.json(await adapter.getDenyList());
    } catch (err) { return handleError(c, err); }
  });

  // POST /deny-list — Add deny list rule
  app.post('/deny-list', async (c) => {
    try {
      const body = await c.req.json();
      return c.json(await adapter.addDenyListRule(body), 201);
    } catch (err) { return handleError(c, err); }
  });

  // DELETE /deny-list/:id — Delete deny list rule
  app.delete('/deny-list/:id', async (c) => {
    try {
      return c.json(await adapter.deleteDenyListRule(c.req.param('id')));
    } catch (err) { return handleError(c, err); }
  });

  // GET /audit — Get sharing audit log
  app.get('/audit', async (c) => {
    try {
      const params = {
        eventType: c.req.query('eventType') || undefined,
        from: c.req.query('from') || undefined,
        to: c.req.query('to') || undefined,
        limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
      };
      return c.json(await adapter.getSharingAuditLog(params));
    } catch (err) { return handleError(c, err); }
  });

  // GET /stats — Get sharing stats
  app.get('/stats', async (c) => {
    try {
      return c.json(await adapter.getSharingStats());
    } catch (err) { return handleError(c, err); }
  });

  // POST /purge — Kill switch
  app.post('/purge', async (c) => {
    try {
      const { confirmation } = await c.req.json();
      return c.json(await adapter.purgeSharing(confirmation));
    } catch (err) { return handleError(c, err); }
  });

  return app;
}
