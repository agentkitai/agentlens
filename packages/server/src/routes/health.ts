/**
 * Health REST Endpoints (Story 1.4, migrated to OpenAPI in F13-S2)
 *
 * GET /agents/:id/health?window=7   — Single agent health score
 * GET /health/overview?window=7     — All agents overview
 * GET /health/history?agentId=X&days=30 — Snapshot history
 * GET /config/health-weights        — Current health weights
 * PUT /config/health-weights        — Update weights (501 placeholder)
 *
 * Returns an OpenAPIHono sub-app mounted at /api in index.ts.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { IEventStore } from '@agentlensai/core';
import { DEFAULT_HEALTH_WEIGHTS, HealthWeightsSchema as WeightsSchema } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantStore, getTenantId } from './tenant-helper.js';
import { HealthComputer } from '../lib/health/computer.js';
import { HealthSnapshotStore } from '../db/health-snapshot-store.js';
import type { SqliteDb } from '../db/index.js';
import { ErrorResponseSchema } from '../schemas/common.js';
import {
  WindowQuerySchema,
  HealthScoreSchema,
  HealthOverviewSchema,
  HealthHistoryResponseSchema,
  HealthHistoryQuerySchema,
  AgentIdParamSchema,
} from '../schemas/health.js';

// ─── Route definitions ──────────────────────────────────

const getAgentHealthRoute = createRoute({
  operationId: 'getAgentHealth',
  method: 'get',
  path: '/agents/{id}/health',
  tags: ['Observability'],
  summary: 'Get agent health score',
  description: 'Compute health score for a single agent over a sliding window.',
  security: [{ Bearer: [] }],
  request: {
    params: AgentIdParamSchema,
    query: WindowQuerySchema,
  },
  responses: {
    200: {
      description: 'Health score for the agent',
      content: { 'application/json': { schema: HealthScoreSchema } },
    },
    400: {
      description: 'Invalid window parameter',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    404: {
      description: 'No sessions found for agent in window',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    500: {
      description: 'Internal error',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

const getHealthOverviewRoute = createRoute({
  operationId: 'getHealthOverview',
  method: 'get',
  path: '/health/overview',
  tags: ['Observability'],
  summary: 'Get health overview for all agents',
  description: 'Compute health scores for all agents over a sliding window.',
  security: [{ Bearer: [] }],
  request: {
    query: WindowQuerySchema,
  },
  responses: {
    200: {
      description: 'Health overview with all agents',
      content: { 'application/json': { schema: HealthOverviewSchema } },
    },
    400: {
      description: 'Invalid window parameter',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    500: {
      description: 'Internal error',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

const getHealthHistoryRoute = createRoute({
  operationId: 'getHealthHistory',
  method: 'get',
  path: '/health/history',
  tags: ['Observability'],
  summary: 'Get health snapshot history',
  description: 'Retrieve daily health snapshots for an agent over a time range.',
  security: [{ Bearer: [] }],
  request: {
    query: HealthHistoryQuerySchema,
  },
  responses: {
    200: {
      description: 'Health history snapshots',
      content: { 'application/json': { schema: HealthHistoryResponseSchema } },
    },
    400: {
      description: 'Missing or invalid parameters',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    500: {
      description: 'Snapshot store not available',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

const getHealthWeightsRoute = createRoute({
  operationId: 'getHealthWeights',
  method: 'get',
  path: '/config/health-weights',
  tags: ['Observability'],
  summary: 'Get current health weights',
  description: 'Returns the weight configuration used for health score computation.',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      description: 'Current health weights',
      content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
    },
  },
});

const updateHealthWeightsRoute = createRoute({
  operationId: 'updateHealthWeights',
  method: 'put',
  path: '/config/health-weights',
  tags: ['Observability'],
  summary: 'Update health weights',
  description: 'Update the weight configuration. Currently returns 501 (not implemented).',
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
    },
  },
  responses: {
    200: {
      description: 'Weights updated',
      content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
    },
    400: {
      description: 'Invalid body',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    501: {
      description: 'Not implemented',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

// ─── Factory ────────────────────────────────────────────

/**
 * Create health routes sub-app.
 * Mount at `/api` in index.ts: `app.route('/api', healthRoutes(store, db))`
 */
export function healthRoutes(
  store: IEventStore,
  db?: SqliteDb,
) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const issues = result.error.issues;
        // Use first issue message as the main error for backward compat
        const firstMessage = issues[0]?.message ?? 'Validation failed';
        return c.json({
          error: firstMessage,
          status: 400,
          details: issues.map((i: any) => ({
            path: i.path.map(String).join('.'),
            message: i.message,
          })),
        }, 400);
      }
    },
  });

  const snapshotStore = db ? new HealthSnapshotStore(db) : null;

  // ─── GET /agents/:id/health ───────────────────────────

  app.openapi(getAgentHealthRoute, async (c) => {
    const tenantStore = getTenantStore(store, c as any);
    const { id: agentId } = c.req.valid('param');
    const { window } = c.req.valid('query');

    try {
      const computer = new HealthComputer(DEFAULT_HEALTH_WEIGHTS);
      const score = await computer.compute(tenantStore, agentId, window);

      if (!score) {
        return c.json(
          { error: 'No sessions found for agent in window', status: 404 } as any,
          404,
        );
      }

      // Lazy snapshot: save if first query of the day
      if (snapshotStore) {
        const tenantId = getTenantId(c as any);
        const today = new Date().toISOString().slice(0, 10);
        const existing = snapshotStore.get(tenantId, agentId, today);
        if (!existing) {
          const dim = (name: string) =>
            score.dimensions.find((d) => d.name === name)?.score ?? 0;
          snapshotStore.save(tenantId, {
            agentId,
            date: today,
            overallScore: score.overallScore,
            errorRateScore: dim('error_rate'),
            costEfficiencyScore: dim('cost_efficiency'),
            toolSuccessScore: dim('tool_success'),
            latencyScore: dim('latency'),
            completionRateScore: dim('completion_rate'),
            sessionCount: score.sessionCount,
          });
        }
      }

      return c.json(score as any);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal error';
      return c.json({ error: message, status: 500 } as any, 500);
    }
  });

  // ─── GET /health/overview ─────────────────────────────

  app.openapi(getHealthOverviewRoute, async (c) => {
    const tenantStore = getTenantStore(store, c as any);
    const { window } = c.req.valid('query');

    try {
      const computer = new HealthComputer(DEFAULT_HEALTH_WEIGHTS);
      const agents = await computer.computeOverview(tenantStore, window);

      return c.json({
        agents,
        computedAt: new Date().toISOString(),
      } as any);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal error';
      return c.json({ error: message, status: 500 } as any, 500);
    }
  });

  // ─── GET /health/history ──────────────────────────────

  app.openapi(getHealthHistoryRoute, async (c) => {
    const { agentId, days } = c.req.valid('query');

    if (!agentId) {
      return c.json(
        { error: 'Missing required query parameter: agentId', status: 400 } as any,
        400,
      );
    }

    if (!snapshotStore) {
      return c.json(
        { error: 'Snapshot store not available', status: 500 } as any,
        500,
      );
    }

    const tenantId = getTenantId(c as any);
    const snapshots = snapshotStore.getHistory(tenantId, agentId, days);
    return c.json({ snapshots, agentId, days } as any);
  });

  // ─── GET /config/health-weights ───────────────────────

  app.openapi(getHealthWeightsRoute, async (c) => {
    return c.json(DEFAULT_HEALTH_WEIGHTS as any);
  });

  // ─── PUT /config/health-weights ───────────────────────

  app.openapi(updateHealthWeightsRoute, async (c) => {
    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) {
      return c.json({ error: 'Invalid JSON body', status: 400 } as any, 400);
    }

    // Validate with the core schema
    const result = WeightsSchema.safeParse(rawBody);
    if (!result.success) {
      return c.json(
        {
          error: (result as any).error.issues.map((i: any) => i.message).join('; '),
          status: 400,
        } as any,
        400,
      );
    }

    return c.json(
      { error: 'Weight customization coming in a future release', status: 501 } as any,
      501,
    );
  });

  return app;
}

// Keep backward-compatible export name for existing re-exports
export { healthRoutes as registerHealthRoutes };
