/**
 * Session Endpoints (Story 4.6, migrated to OpenAPI in F13-S3)
 *
 * GET /          — list sessions with filters + pagination
 * GET /:id       — session detail with aggregates
 * GET /:id/timeline — all events ascending + chainValid
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { verifyChain, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@agentlensai/core';
import type { SessionQuery, SessionStatus } from '@agentlensai/core';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantStore } from './tenant-helper.js';
import { ErrorResponseSchema } from '../schemas/common.js';
import {
  SessionQuerySchema,
  SessionListResponseSchema,
  SessionCountResponseSchema,
  SessionIdParamSchema,
  SessionSchema,
  SessionTimelineResponseSchema,
} from '../schemas/sessions.js';

// ─── Route definitions ──────────────────────────────────

const listSessionsRoute = createRoute({
  operationId: 'listSessions',
  method: 'get',
  path: '/',
  tags: ['Sessions'],
  summary: 'List sessions',
  description: 'Query sessions with filtering by agent, status, date range, tags, and pagination.',
  security: [{ Bearer: [] }],
  request: {
    query: SessionQuerySchema,
  },
  responses: {
    200: {
      description: 'Session list or count',
      content: { 'application/json': { schema: SessionListResponseSchema } },
    },
  },
});

const getSessionRoute = createRoute({
  operationId: 'getSession',
  method: 'get',
  path: '/{id}',
  tags: ['Sessions'],
  summary: 'Get session detail',
  description: 'Returns a single session with aggregated metrics.',
  security: [{ Bearer: [] }],
  request: {
    params: SessionIdParamSchema,
  },
  responses: {
    200: {
      description: 'Session detail',
      content: { 'application/json': { schema: SessionSchema } },
    },
    404: {
      description: 'Session not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

const getSessionTimelineRoute = createRoute({
  operationId: 'getSessionTimeline',
  method: 'get',
  path: '/{id}/timeline',
  tags: ['Sessions'],
  summary: 'Get session timeline',
  description: 'Returns all events for a session in ascending order with chain verification.',
  security: [{ Bearer: [] }],
  request: {
    params: SessionIdParamSchema,
  },
  responses: {
    200: {
      description: 'Session timeline with chain verification',
      content: { 'application/json': { schema: SessionTimelineResponseSchema } },
    },
    404: {
      description: 'Session not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

// ─── Factory ────────────────────────────────────────────

export function sessionsRoutes(store: IEventStore) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({
          error: 'Validation failed',
          status: 400,
          details: result.error.issues.map((i: any) => ({
            path: i.path.map(String).join('.'),
            message: i.message,
          })),
        }, 400);
      }
    },
  });

  // GET / — list sessions
  app.openapi(listSessionsRoute, async (c) => {
    const tenantStore = getTenantStore(store, c as any);
    const validated = c.req.valid('query');
    const query: SessionQuery = {};

    if (validated.agentId) query.agentId = validated.agentId;

    if (validated.status) {
      const statuses = validated.status.split(',').filter(Boolean) as SessionStatus[];
      query.status = statuses.length === 1 ? statuses[0] : statuses;
    }

    if (validated.from) query.from = validated.from;
    if (validated.to) query.to = validated.to;
    if (validated.tags) query.tags = validated.tags.split(',');

    query.limit = Math.max(1, Math.min(validated.limit || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE));
    query.offset = Math.max(0, validated.offset || 0);

    const countOnly = validated.countOnly === 'true';

    if (countOnly) {
      const countQuery = { ...query, limit: 1, offset: 0 };
      const result = await tenantStore.querySessions(countQuery);
      return c.json({ count: result.total } as any);
    }

    const result = await tenantStore.querySessions(query);

    return c.json({
      sessions: result.sessions,
      total: result.total,
      hasMore: (query.offset ?? 0) + result.sessions.length < result.total,
    } as any);
  });

  // GET /:id — session detail
  app.openapi(getSessionRoute, async (c) => {
    const tenantStore = getTenantStore(store, c as any);
    const { id } = c.req.valid('param');

    const session = await tenantStore.getSession(id);
    if (!session) {
      return c.json({ error: 'Session not found', status: 404 } as any, 404);
    }

    return c.json(session as any);
  });

  // GET /:id/timeline — session timeline
  app.openapi(getSessionTimelineRoute, async (c) => {
    const tenantStore = getTenantStore(store, c as any);
    const { id } = c.req.valid('param');

    const session = await tenantStore.getSession(id);
    if (!session) {
      return c.json({ error: 'Session not found', status: 404 } as any, 404);
    }

    const timeline = await tenantStore.getSessionTimeline(id);
    const chainResult = verifyChain(timeline);

    return c.json({
      events: timeline,
      chainValid: chainResult.valid,
    } as any);
  });

  return app;
}
