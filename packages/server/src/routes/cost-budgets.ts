/**
 * Cost Budget REST API Routes (Feature 5 — Story 5)
 *
 * POST   /                   — Create budget
 * GET    /                   — List budgets
 * PUT    /:id                — Update budget
 * DELETE /:id                — Delete budget
 * GET    /:id/status         — Budget status (spend vs limit)
 * GET    /anomaly/config     — Get anomaly config
 * PUT    /anomaly/config     — Update anomaly config
 */

import { Hono } from 'hono';
import { ulid } from 'ulid';
import {
  createCostBudgetSchema,
  updateCostBudgetSchema,
  updateAnomalyConfigSchema,
} from '@agentlensai/core';
import type { CostBudget, CostAnomalyConfig, IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import type { CostBudgetStore } from '../db/cost-budget-store.js';
import type { BudgetEngine } from '../lib/budget-engine.js';

export function costBudgetRoutes(store: CostBudgetStore, eventStore: IEventStore, budgetEngine: BudgetEngine) {
  const app = new Hono<{ Variables: AuthVariables }>();

  function getTenantId(c: any): string {
    const apiKeyInfo = c.get('apiKey');
    return apiKeyInfo?.tenantId ?? 'default';
  }

  // ─── Budget CRUD ─────────────────────────────────────────

  app.post('/', async (c) => {
    const tenantId = getTenantId(c);
    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const result = createCostBudgetSchema.safeParse(rawBody);
    if (!result.success) {
      return c.json({
        error: 'Validation failed',
        status: 400,
        details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      }, 400);
    }

    const now = new Date().toISOString();
    const budget: CostBudget = {
      id: ulid(),
      tenantId,
      scope: result.data.scope,
      agentId: result.data.agentId,
      period: result.data.period,
      limitUsd: result.data.limitUsd,
      onBreach: result.data.onBreach,
      downgradeTargetModel: result.data.downgradeTargetModel,
      enabled: result.data.enabled,
      createdAt: now,
      updatedAt: now,
    };

    store.createBudget(budget);
    return c.json(budget, 201);
  });

  app.get('/', async (c) => {
    const tenantId = getTenantId(c);
    const agentId = c.req.query('agentId');
    const scope = c.req.query('scope');
    const enabledStr = c.req.query('enabled');
    const enabled = enabledStr === 'true' ? true : enabledStr === 'false' ? false : undefined;

    const budgets = store.listBudgets(tenantId, {
      agentId: agentId || undefined,
      scope: scope || undefined,
      enabled,
    });
    return c.json({ budgets });
  });

  app.get('/anomaly/config', async (c) => {
    const tenantId = getTenantId(c);
    const config = store.getAnomalyConfig(tenantId);
    if (!config) {
      return c.json({
        tenantId,
        multiplier: 3.0,
        minSessions: 5,
        enabled: true,
        updatedAt: new Date().toISOString(),
      });
    }
    return c.json(config);
  });

  app.put('/anomaly/config', async (c) => {
    const tenantId = getTenantId(c);
    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const result = updateAnomalyConfigSchema.safeParse(rawBody);
    if (!result.success) {
      return c.json({
        error: 'Validation failed',
        status: 400,
        details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      }, 400);
    }

    const existing = store.getAnomalyConfig(tenantId);
    const config: CostAnomalyConfig = {
      tenantId,
      multiplier: result.data.multiplier ?? existing?.multiplier ?? 3.0,
      minSessions: result.data.minSessions ?? existing?.minSessions ?? 5,
      enabled: result.data.enabled ?? existing?.enabled ?? true,
      updatedAt: new Date().toISOString(),
    };

    store.upsertAnomalyConfig(config);
    return c.json(config);
  });

  app.get('/:id/status', async (c) => {
    const tenantId = getTenantId(c);
    const budgetId = c.req.param('id');
    const budget = store.getBudget(tenantId, budgetId);
    if (!budget) {
      return c.json({ error: 'Budget not found', status: 404 }, 404);
    }

    // Compute current spend
    let currentSpend = 0;
    const periodStart = budgetEngine.getPeriodStart(budget.period);

    if (budget.scope === 'agent' && budget.agentId) {
      currentSpend = await eventStore.sumSessionCost({
        agentId: budget.agentId,
        from: periodStart,
        tenantId: budget.tenantId,
      });
    }
    // For session scope, we can't compute without a specific session context
    // Return the cached state value if available
    if (budget.scope === 'session') {
      const state = store.getState(tenantId, budgetId);
      currentSpend = state?.currentSpend ?? 0;
    }

    const percentUsed = budget.limitUsd > 0 ? (currentSpend / budget.limitUsd) * 100 : 0;

    // Compute period end
    let periodEnd: string;
    const now = new Date();
    switch (budget.period) {
      case 'daily': {
        const d = new Date(periodStart);
        d.setUTCDate(d.getUTCDate() + 1);
        periodEnd = d.toISOString();
        break;
      }
      case 'weekly': {
        const d = new Date(periodStart);
        d.setUTCDate(d.getUTCDate() + 7);
        periodEnd = d.toISOString();
        break;
      }
      case 'monthly': {
        const d = new Date(periodStart);
        d.setUTCMonth(d.getUTCMonth() + 1);
        periodEnd = d.toISOString();
        break;
      }
      default:
        periodEnd = now.toISOString();
    }

    return c.json({
      budget,
      currentSpend,
      limitUsd: budget.limitUsd,
      percentUsed: Math.round(percentUsed * 100) / 100,
      breached: currentSpend >= budget.limitUsd,
      periodStart,
      periodEnd,
    });
  });

  app.put('/:id', async (c) => {
    const tenantId = getTenantId(c);
    const budgetId = c.req.param('id');
    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const result = updateCostBudgetSchema.safeParse(rawBody);
    if (!result.success) {
      return c.json({
        error: 'Validation failed',
        status: 400,
        details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      }, 400);
    }

    const updated = store.updateBudget(tenantId, budgetId, result.data as Partial<CostBudget>);
    if (!updated) {
      return c.json({ error: 'Budget not found', status: 404 }, 404);
    }

    const budget = store.getBudget(tenantId, budgetId);
    return c.json(budget);
  });

  app.delete('/:id', async (c) => {
    const tenantId = getTenantId(c);
    const budgetId = c.req.param('id');
    const deleted = store.deleteBudget(tenantId, budgetId);
    if (!deleted) {
      return c.json({ error: 'Budget not found', status: 404 }, 404);
    }
    return c.json({ id: budgetId, deleted: true });
  });

  return app;
}
