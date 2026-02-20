/**
 * Health REST Endpoints (Story 1.4)
 *
 * GET /api/agents/:id/health?window=7   — Single agent health score
 * GET /api/health/overview?window=7     — All agents overview
 * GET /api/health/history?agentId=X&days=30 — Snapshot history
 * GET /api/config/health-weights        — Current health weights
 * PUT /api/config/health-weights        — Update weights (501 placeholder)
 */

import { Hono } from 'hono';
import type { IEventStore } from '@agentlensai/core';
import { DEFAULT_HEALTH_WEIGHTS, HealthWeightsSchema as WeightsSchema } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantStore, getTenantId } from './tenant-helper.js';
import { HealthComputer } from '../lib/health/computer.js';
import { HealthSnapshotStore } from '../db/health-snapshot-store.js';
import type { SqliteDb } from '../db/index.js';

/** Parse and validate `window` query param (integer 1-90, default 7) */
function parseWindow(raw: string | undefined): number | { error: string } {
  if (raw === undefined || raw === '') return 7;
  const val = parseInt(raw, 10);
  if (isNaN(val) || val < 1 || val > 90) {
    return { error: 'window must be an integer between 1 and 90' };
  }
  return val;
}

/** Parse and validate `days` query param (integer 1-365, default 30) */
function parseDays(raw: string | undefined): number | { error: string } {
  if (raw === undefined || raw === '') return 30;
  const val = parseInt(raw, 10);
  if (isNaN(val) || val < 1 || val > 365) {
    return { error: 'days must be an integer between 1 and 365' };
  }
  return val;
}

/**
 * Register all health-related routes directly on the provided Hono app.
 * Call this from index.ts passing the main app.
 */
export function registerHealthRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  store: IEventStore,
  db?: SqliteDb,
): void {
  const snapshotStore = db ? new HealthSnapshotStore(db) : null;

  // ─── GET /api/agents/:id/health ───────────────────────

  app.get('/api/agents/:id/health', async (c) => {
    const tenantStore = getTenantStore(store, c);
    const agentId = c.req.param('id');

    const window = parseWindow(c.req.query('window'));
    if (typeof window === 'object') {
      return c.json({ error: window.error, status: 400 }, 400);
    }

    try {
      const computer = new HealthComputer(DEFAULT_HEALTH_WEIGHTS);
      const score = await computer.compute(tenantStore, agentId, window);

      if (!score) {
        return c.json(
          { error: 'No sessions found for agent in window' },
          404,
        );
      }

      // Lazy snapshot: save if first query of the day
      if (snapshotStore) {
        const tenantId = getTenantId(c);
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

      return c.json(score);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal error';
      return c.json({ error: message, status: 500 }, 500);
    }
  });

  // ─── GET /api/health/overview ─────────────────────────

  app.get('/api/health/overview', async (c) => {
    const tenantStore = getTenantStore(store, c);

    const window = parseWindow(c.req.query('window'));
    if (typeof window === 'object') {
      return c.json({ error: window.error, status: 400 }, 400);
    }

    try {
      const computer = new HealthComputer(DEFAULT_HEALTH_WEIGHTS);
      const agents = await computer.computeOverview(tenantStore, window);

      return c.json({
        agents,
        computedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal error';
      return c.json({ error: message, status: 500 }, 500);
    }
  });

  // ─── GET /api/health/history ──────────────────────────

  app.get('/api/health/history', async (c) => {
    const agentId = c.req.query('agentId');
    if (!agentId) {
      return c.json(
        { error: 'Missing required query parameter: agentId', status: 400 },
        400,
      );
    }

    const days = parseDays(c.req.query('days'));
    if (typeof days === 'object') {
      return c.json({ error: days.error, status: 400 }, 400);
    }

    if (!snapshotStore) {
      return c.json(
        { error: 'Snapshot store not available', status: 500 },
        500,
      );
    }

    const tenantId = getTenantId(c);

    const snapshots = snapshotStore.getHistory(tenantId, agentId, days);
    return c.json({ snapshots, agentId, days });
  });

  // ─── GET /api/config/health-weights ───────────────────

  app.get('/api/config/health-weights', async (c) => {
    return c.json(DEFAULT_HEALTH_WEIGHTS);
  });

  // ─── PUT /api/config/health-weights ───────────────────

  app.put('/api/config/health-weights', async (c) => {
    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    // Validate with schema
    const result = WeightsSchema.safeParse(rawBody);
    if (!result.success) {
      return c.json(
        {
          error: result.error.issues.map((i) => i.message).join('; '),
          status: 400,
        },
        400,
      );
    }

    return c.json(
      { error: 'Weight customization coming in a future release', status: 501 },
      501,
    );
  });
}
