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
import type { ContentGuardrailEngine } from '../lib/guardrails/content-engine.js';
import { invalidateScanner } from '../lib/guardrails/scanners/scanner-registry.js';
import { getTenantId } from './tenant-helper.js';
import { parseBody, notFound, created } from './helpers.js';

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

export function guardrailRoutes(guardrailStore: GuardrailStore, contentEngine?: ContentGuardrailEngine) {
  const app = new Hono<{ Variables: AuthVariables }>();

  /**
   * @summary Create a new guardrail rule
   * @description Creates a guardrail rule with a condition type, action type, and their configs.
   * Validates the body against CreateGuardrailRuleSchema, checks conditionConfig fields,
   * and validates webhook URLs for notify_webhook actions.
   * @body {CreateGuardrailRule} — name, conditionType, conditionConfig, actionType, actionConfig, agentId, etc.
   * @returns {201} `GuardrailRule` — the created rule with generated id and timestamps
   * @throws {400} Validation failed (schema, conditionConfig, or webhook URL)
   */
  app.post('/', async (c) => {
    const tenantId = getTenantId(c);
    const parsed = await parseBody(c, CreateGuardrailRuleSchema);
    if (!parsed.success) return parsed.response;

    // H4: Validate that conditionConfig has required fields for the condition type
    const configError = validateConditionConfig(parsed.data.conditionType, parsed.data.conditionConfig);
    if (configError) {
      return c.json({ error: 'Validation failed', status: 400, details: [{ path: 'conditionConfig', message: configError }] }, 400);
    }

    // H2: Validate webhook URL if action is notify_webhook
    if (parsed.data.actionType === 'notify_webhook') {
      const url = parsed.data.actionConfig?.url;
      if (typeof url === 'string' && !/^https?:\/\//.test(url)) {
        return c.json({ error: 'Validation failed', status: 400, details: [{ path: 'actionConfig.url', message: 'Webhook URL must start with http:// or https://' }] }, 400);
      }
    }

    const now = new Date().toISOString();
    const rule = {
      id: ulid(),
      tenantId,
      ...parsed.data,
      createdAt: now,
      updatedAt: now,
    };

    guardrailStore.createRule(rule);
    return created(c, rule);
  });

  /**
   * @summary Evaluate content against guardrail rules (Feature 8)
   */
  app.post('/evaluate', async (c) => {
    const tenantId = getTenantId(c);
    const body = await c.req.json().catch(() => null);

    // Feature 5 (v2): evaluate a request against all active guardrails, return actions
    if (body?.request) {
      const agentId = body.request.agentId;
      const model = body.request.model;
      if (!agentId) {
        return c.json({ error: 'Missing request.agentId', status: 400 }, 400);
      }
      const rules = guardrailStore.listEnabledRules(tenantId, agentId);
      const actions: Array<{
        ruleId: string;
        ruleName: string;
        actionType: string;
        actionConfig: Record<string, unknown>;
        message: string;
      }> = [];

      for (const rule of rules) {
        if (rule.actionType === 'rate_limit') {
          const rpm = (rule.actionConfig.requests_per_minute as number) ?? 60;
          actions.push({
            ruleId: rule.id,
            ruleName: rule.name,
            actionType: 'rate_limit',
            actionConfig: { requests_per_minute: rpm, window: rule.actionConfig.window ?? 60 },
            message: `Rate limited to ${rpm} requests/min`,
          });
        } else if (rule.actionType === 'block') {
          actions.push({
            ruleId: rule.id,
            ruleName: rule.name,
            actionType: 'block',
            actionConfig: rule.actionConfig,
            message: (rule.actionConfig.message as string) ?? 'Request blocked by guardrail',
          });
        } else if (rule.actionType === 'downgrade_model') {
          const target = (rule.actionConfig.target_model as string) ?? 'gpt-3.5-turbo';
          actions.push({
            ruleId: rule.id,
            ruleName: rule.name,
            actionType: 'downgrade_model',
            actionConfig: { target_model: target, original_model: model },
            message: `Model downgraded from ${model ?? 'unknown'} to ${target}`,
          });
        } else if (rule.actionType === 'alert') {
          actions.push({
            ruleId: rule.id,
            ruleName: rule.name,
            actionType: 'alert',
            actionConfig: rule.actionConfig,
            message: 'Alert triggered',
          });
        }
      }

      // Record actions as trigger history
      const now = new Date().toISOString();
      for (const action of actions) {
        guardrailStore.insertTrigger({
          id: ulid(),
          ruleId: action.ruleId,
          tenantId,
          triggeredAt: now,
          conditionValue: 0,
          conditionThreshold: 0,
          actionExecuted: true,
          actionResult: action.actionType,
          metadata: { agentId, model, message: action.message },
        });
      }

      const blocked = actions.some((a) => a.actionType === 'block');
      return c.json({ allowed: !blocked, actions });
    }

    // Feature 8 (content engine): existing content evaluation
    if (!contentEngine) {
      return c.json({ error: 'Content engine not available', status: 501 }, 501);
    }
    if (!body?.content || !body?.context?.tenantId || !body?.context?.agentId) {
      return c.json({ error: 'Missing content or context (tenantId, agentId required)', status: 400 }, 400);
    }

    const result = await contentEngine.evaluateContentSync(
      body.content,
      {
        tenantId: body.context.tenantId,
        agentId: body.context.agentId,
        toolName: body.context.toolName ?? 'unknown',
        direction: body.context.direction ?? 'input',
      },
      body.timeoutMs,
    );

    return c.json(result);
  });

  /**
   * @summary List triggered actions for a guardrail rule (Feature 5 — Phase 2)
   * @param {string} id — Rule ID (path)
   * @param {number} [limit] — max results 1-200, default 50 (query param)
   * @param {number} [offset] — pagination offset, default 0 (query param)
   * @returns {200} `{ actions: TriggerRecord[], total: number }`
   * @throws {404} Rule not found
   */
  app.get('/:id/actions', async (c) => {
    const tenantId = getTenantId(c);
    const ruleId = c.req.param('id');
    const rule = guardrailStore.getRule(tenantId, ruleId);
    if (!rule) {
      return notFound(c, 'Guardrail rule');
    }

    const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)), 200);
    const offset = Math.max(0, parseInt(c.req.query('offset') ?? '0', 10));

    const { triggers, total } = guardrailStore.listTriggerHistory(tenantId, {
      ruleId,
      limit,
      offset,
    });

    // Map triggers to action records
    const actions = triggers.map((t) => ({
      id: t.id,
      ruleId: t.ruleId,
      actionType: t.actionResult ?? 'unknown',
      triggeredAt: t.triggeredAt,
      metadata: t.metadata,
    }));

    return c.json({ actions, total });
  });

  /**
   * @summary List guardrail rules
   * @description Returns all guardrail rules for the tenant, optionally filtered by agent.
   * @param {string} [agentId] — filter by agent ID (query param)
   * @param {string} [type] — filter: 'content' for content rules only (query param)
   * @returns {200} `{ rules: GuardrailRule[] }`
   */
  app.get('/', async (c) => {
    const tenantId = getTenantId(c);
    const agentId = c.req.query('agentId');
    const type = c.req.query('type');
    let rules = guardrailStore.listRules(tenantId, agentId || undefined);

    if (type === 'content') {
      const contentTypes = new Set(['pii_detection', 'secrets_detection', 'content_regex', 'toxicity_detection', 'prompt_injection']);
      rules = rules.filter((r) => contentTypes.has(r.conditionType));
    }

    return c.json({ rules });
  });

  /**
   * @summary List guardrail trigger history
   * @description Returns paginated trigger history, optionally filtered by rule ID.
   * @param {string} [ruleId] — filter by rule ID (query param)
   * @param {number} [limit] — max results 1-200, default 50 (query param)
   * @param {number} [offset] — pagination offset, default 0 (query param)
   * @returns {200} `{ triggers: TriggerRecord[], total: number }`
   */
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

  /**
   * @summary Get a single guardrail rule
   * @description Returns the full guardrail rule by ID.
   * @param {string} id — Rule ID (path)
   * @returns {200} `GuardrailRule`
   * @throws {404} Rule not found
   */
  app.get('/:id', async (c) => {
    const tenantId = getTenantId(c);
    const ruleId = c.req.param('id');
    const rule = guardrailStore.getRule(tenantId, ruleId);
    if (!rule) {
      return notFound(c, 'Guardrail rule');
    }
    return c.json(rule);
  });

  /**
   * @summary Update a guardrail rule
   * @description Partially updates a guardrail rule. Validates against UpdateGuardrailRuleSchema
   * and checks webhook URLs for notify_webhook actions. Setting agentId to null clears the scope.
   * @param {string} id — Rule ID (path)
   * @body {UpdateGuardrailRule} — partial rule fields to update
   * @returns {200} `GuardrailRule` — the updated rule
   * @throws {400} Invalid JSON body or validation failed
   * @throws {404} Rule not found
   */
  app.put('/:id', async (c) => {
    const tenantId = getTenantId(c);
    const ruleId = c.req.param('id');
    const parsed = await parseBody(c, UpdateGuardrailRuleSchema);
    if (!parsed.success) return parsed.response;

    // H2: Validate webhook URL if action is notify_webhook
    if (parsed.data.actionType === 'notify_webhook') {
      const url = parsed.data.actionConfig?.url;
      if (typeof url === 'string' && !/^https?:\/\//.test(url)) {
        return c.json({ error: 'Validation failed', status: 400, details: [{ path: 'actionConfig.url', message: 'Webhook URL must start with http:// or https://' }] }, 400);
      }
    }

    // Handle null agentId (clearing scope)
    const updates: Record<string, unknown> = { ...parsed.data };
    if (updates.agentId === null) {
      updates.agentId = undefined;
    }

    const updated = guardrailStore.updateRule(tenantId, ruleId, updates);
    if (!updated) {
      return notFound(c, 'Guardrail rule');
    }

    invalidateScanner(ruleId);

    const rule = guardrailStore.getRule(tenantId, ruleId);
    return c.json(rule);
  });

  /**
   * @summary Delete a guardrail rule
   * @description Permanently removes a guardrail rule by ID.
   * @param {string} id — Rule ID (path)
   * @returns {200} `{ ok: true }`
   * @throws {404} Rule not found
   */
  app.delete('/:id', async (c) => {
    const tenantId = getTenantId(c);
    const ruleId = c.req.param('id');
    const deleted = guardrailStore.deleteRule(tenantId, ruleId);
    if (!deleted) {
      return notFound(c, 'Guardrail rule');
    }
    invalidateScanner(ruleId);
    return c.json({ ok: true });
  });

  /**
   * @summary Get guardrail rule status and recent triggers
   * @description Returns the rule definition, its current state, and the 10 most recent trigger events.
   * @param {string} id — Rule ID (path)
   * @returns {200} `{ rule: GuardrailRule, state: GuardrailState, recentTriggers: TriggerRecord[] }`
   * @throws {404} Rule not found
   */
  app.get('/:id/status', async (c) => {
    const tenantId = getTenantId(c);
    const ruleId = c.req.param('id');
    const rule = guardrailStore.getRule(tenantId, ruleId);
    if (!rule) {
      return notFound(c, 'Guardrail rule');
    }

    const state = guardrailStore.getState(tenantId, ruleId);
    const recentTriggers = guardrailStore.getRecentTriggers(tenantId, ruleId, 10);

    return c.json({ rule, state, recentTriggers });
  });

  return app;
}
