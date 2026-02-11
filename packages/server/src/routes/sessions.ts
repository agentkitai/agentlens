/**
 * Session Endpoints (Story 4.6)
 *
 * GET /api/sessions            — list sessions with filters + pagination
 * GET /api/sessions/:id        — session detail with aggregates
 * GET /api/sessions/:id/timeline — all events ascending + chainValid
 */

import { Hono } from 'hono';
import { verifyChain, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@agentlensai/core';
import type { SessionQuery, SessionStatus } from '@agentlensai/core';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantStore } from './tenant-helper.js';

export function sessionsRoutes(store: IEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET /api/sessions — list sessions
  app.get('/', async (c) => {
    const tenantStore = getTenantStore(store, c);
    const query: SessionQuery = {};

    const agentId = c.req.query('agentId');
    if (agentId) query.agentId = agentId;

    const status = c.req.query('status');
    if (status) {
      const statuses = status.split(',').filter(Boolean) as SessionStatus[];
      query.status = statuses.length === 1 ? statuses[0] : statuses;
    }

    const from = c.req.query('from');
    if (from) query.from = from;

    const to = c.req.query('to');
    if (to) query.to = to;

    const tags = c.req.query('tags');
    if (tags) query.tags = tags.split(',');

    const limitStr = c.req.query('limit');
    query.limit = limitStr
      ? Math.max(1, Math.min(parseInt(limitStr, 10) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE))
      : DEFAULT_PAGE_SIZE;

    const offsetStr = c.req.query('offset');
    query.offset = offsetStr ? Math.max(0, parseInt(offsetStr, 10) || 0) : 0;

    const countOnly = c.req.query('countOnly') === 'true';

    if (countOnly) {
      // Optimized path: query with limit 0 to get just the count
      const countQuery = { ...query, limit: 1, offset: 0 };
      const result = await tenantStore.querySessions(countQuery);
      return c.json({ count: result.total });
    }

    const result = await tenantStore.querySessions(query);

    return c.json({
      sessions: result.sessions,
      total: result.total,
      hasMore: (query.offset ?? 0) + result.sessions.length < result.total,
    });
  });

  // GET /api/sessions/:id — session detail
  app.get('/:id', async (c) => {
    const tenantStore = getTenantStore(store, c);
    const id = c.req.param('id');

    const session = await tenantStore.getSession(id);
    if (!session) {
      return c.json({ error: 'Session not found', status: 404 }, 404);
    }

    return c.json(session);
  });

  // GET /api/sessions/:id/timeline — all events ascending + chain verification
  app.get('/:id/timeline', async (c) => {
    const tenantStore = getTenantStore(store, c);
    const id = c.req.param('id');

    const session = await tenantStore.getSession(id);
    if (!session) {
      return c.json({ error: 'Session not found', status: 404 }, 404);
    }

    const timeline = await tenantStore.getSessionTimeline(id);
    const chainResult = verifyChain(timeline);

    return c.json({
      events: timeline,
      chainValid: chainResult.valid,
    });
  });

  return app;
}
