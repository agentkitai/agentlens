/**
 * Guardrail REST API Routes (v0.8.0 — Stories 2.1, 2.2)
 *
 * POST   /api/guardrails              — Create rule
 * GET    /api/guardrails              — List rules
 * GET    /api/guardrails/:id          — Get rule
 * PUT    /api/guardrails/:id          — Update rule
 * DELETE /api/guardrails/:id          — Delete rule
 * GET    /api/guardrails/:id/status   — Get rule status + recent triggers
 * GET    /api/guardrails/history      — List trigger history
 */

import { Hono } from 'hono';
import { ulid } from 'ulid';
import { CreateGuardrailRuleSchema, UpdateGuardrailRuleSchema } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import type { GuardrailStore } from '../db/guardrail-store.js';

/**
 * Validate that conditionConfig contains required fields for the given condition type.
 * Returns an error message string if invalid, or null if valid.
 */
function validateConditionConfig(conditionType: string, config: Record<string, unknown>): string | null {
  switch (conditionType) {
    case 'error_rate_threshold':
      if (config.threshold !== undefined && (typeof config.threshold !== 'number' || config.threshold < 0 || config.threshold > 100)) {
        return 'error_rate_threshold requires threshold to be a number between 0 and 100';
      }
      break;
    case 'cost_limit':
      if (config.maxCostUsd !== undefined && (typeof config.maxCostUsd !== 'number' || config.maxCostUsd < 0)) {
        return 'cost_limit requires maxCostUsd to be a non-negative number';
      }
      if (config.scope !== undefined && config.scope !== 'session' && config.scope !== 'daily') {
        return 'cost_limit scope must be "session" or "daily"';
      }
      break;
    case 'health_score_threshold':
      if (config.minScore !== undefined && (typeof config.minScore !== 'number' || config.minScore < 0 || config.minScore > 100)) {
        return 'health_score_threshold requires minScore to be a number between 0 and 100';
      }
      break;
    case 'custom_metric':
      if (config.operator !== undefined) {
        const validOps = ['gt', 'gte', 'lt', 'lte', 'eq'];
        if (!validOps.includes(config.operator as string)) {
          return `custom_metric operator must be one of: ${validOps.join(', ')}`;
        }
      }
      break;
  }
  return null;
}

export function guardrailRoutes(guardrailStore: GuardrailStore) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // Helper to get tenant ID from auth
  function getTenantId(c: any): string {
    const apiKeyInfo = c.get('apiKey');
    return apiKeyInfo?.tenantId ?? 'default';
  }

  // POST / — Create guardrail rule
  app.post('/', async (c) => {
    const tenantId = getTenantId(c);
    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const result = CreateGuardrailRuleSchema.safeParse(rawBody);
    if (!result.success) {
      return c.json({
        error: 'Validation failed',
        status: 400,
        details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      }, 400);
    }

    // H4: Validate that conditionConfig has required fields for the condition type
    const configError = validateConditionConfig(result.data.conditionType, result.data.conditionConfig);
    if (configError) {
      return c.json({ error: 'Validation failed', status: 400, details: [{ path: 'conditionConfig', message: configError }] }, 400);
    }

    const now = new Date().toISOString();
    const rule = {
      id: ulid(),
      tenantId,
      ...result.data,
      createdAt: now,
      updatedAt: now,
    };

    guardrailStore.createRule(rule);
    return c.json(rule, 201);
  });

  // GET / — List guardrail rules
  app.get('/', async (c) => {
    const tenantId = getTenantId(c);
    const rules = guardrailStore.listRules(tenantId);
    return c.json({ rules });
  });

  // GET /history — List trigger history (BEFORE :id routes to avoid route conflict)
  app.get('/history', async (c) => {
    const tenantId = getTenantId(c);
    const ruleId = c.req.query('ruleId');
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);

    const { triggers, total } = guardrailStore.listTriggerHistory(tenantId, {
      ruleId: ruleId || undefined,
      limit: Math.min(Math.max(1, limit), 200),
      offset: Math.max(0, offset),
    });

    return c.json({ triggers, total });
  });

  // GET /:id — Get single rule
  app.get('/:id', async (c) => {
    const tenantId = getTenantId(c);
    const ruleId = c.req.param('id');
    const rule = guardrailStore.getRule(tenantId, ruleId);
    if (!rule) {
      return c.json({ error: 'Guardrail rule not found', status: 404 }, 404);
    }
    return c.json(rule);
  });

  // PUT /:id — Update rule
  app.put('/:id', async (c) => {
    const tenantId = getTenantId(c);
    const ruleId = c.req.param('id');
    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const result = UpdateGuardrailRuleSchema.safeParse(rawBody);
    if (!result.success) {
      return c.json({
        error: 'Validation failed',
        status: 400,
        details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      }, 400);
    }

    // Handle null agentId (clearing scope)
    const updates: Record<string, unknown> = { ...result.data };
    if (updates.agentId === null) {
      updates.agentId = undefined;
    }

    const updated = guardrailStore.updateRule(tenantId, ruleId, updates);
    if (!updated) {
      return c.json({ error: 'Guardrail rule not found', status: 404 }, 404);
    }

    const rule = guardrailStore.getRule(tenantId, ruleId);
    return c.json(rule);
  });

  // DELETE /:id — Delete rule
  app.delete('/:id', async (c) => {
    const tenantId = getTenantId(c);
    const ruleId = c.req.param('id');
    const deleted = guardrailStore.deleteRule(tenantId, ruleId);
    if (!deleted) {
      return c.json({ error: 'Guardrail rule not found', status: 404 }, 404);
    }
    return c.json({ ok: true });
  });

  // GET /:id/status — Get rule status + recent triggers
  app.get('/:id/status', async (c) => {
    const tenantId = getTenantId(c);
    const ruleId = c.req.param('id');
    const rule = guardrailStore.getRule(tenantId, ruleId);
    if (!rule) {
      return c.json({ error: 'Guardrail rule not found', status: 404 }, 404);
    }

    const state = guardrailStore.getState(tenantId, ruleId);
    const recentTriggers = guardrailStore.getRecentTriggers(tenantId, ruleId, 10);

    return c.json({ rule, state, recentTriggers });
  });

  return app;
}
