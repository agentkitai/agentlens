/**
 * Alert Endpoints (Story 12.1)
 *
 * POST   /api/alerts/rules       — create alert rule
 * GET    /api/alerts/rules       — list alert rules
 * GET    /api/alerts/rules/:id   — get single alert rule
 * PUT    /api/alerts/rules/:id   — update alert rule
 * DELETE /api/alerts/rules/:id   — delete alert rule
 * GET    /api/alerts/history     — list alert history
 */

import { Hono } from 'hono';
import { ulid } from 'ulid';
import { createAlertRuleSchema, updateAlertRuleSchema } from '@agentlensai/core';
import type { AlertRule } from '@agentlensai/core';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import { NotFoundError } from '../db/errors.js';

export function alertsRoutes(store: IEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // POST /api/alerts/rules — create alert rule
  app.post('/rules', async (c) => {
    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const parseResult = createAlertRuleSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return c.json(
        {
          error: 'Validation failed',
          status: 400,
          details: parseResult.error.issues.map((issue: { path: (string | number)[]; message: string }) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        400,
      );
    }

    const input = parseResult.data;
    const now = new Date().toISOString();

    const rule: AlertRule = {
      id: ulid(),
      name: input.name,
      enabled: input.enabled,
      condition: input.condition,
      threshold: input.threshold,
      windowMinutes: input.windowMinutes,
      scope: input.scope,
      notifyChannels: input.notifyChannels,
      createdAt: now,
      updatedAt: now,
    };

    await store.createAlertRule(rule);

    return c.json(rule, 201);
  });

  // GET /api/alerts/rules — list all alert rules
  app.get('/rules', async (c) => {
    const rules = await store.listAlertRules();
    return c.json({ rules });
  });

  // GET /api/alerts/rules/:id — get single alert rule
  app.get('/rules/:id', async (c) => {
    const id = c.req.param('id');
    const rule = await store.getAlertRule(id);

    if (!rule) {
      return c.json({ error: 'Alert rule not found', status: 404 }, 404);
    }

    return c.json(rule);
  });

  // PUT /api/alerts/rules/:id — update alert rule
  app.put('/rules/:id', async (c) => {
    const id = c.req.param('id');
    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) {
      return c.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const parseResult = updateAlertRuleSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return c.json(
        {
          error: 'Validation failed',
          status: 400,
          details: parseResult.error.issues.map((issue: { path: (string | number)[]; message: string }) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        400,
      );
    }

    const updates = parseResult.data;

    try {
      await store.updateAlertRule(id, {
        ...updates,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return c.json({ error: 'Alert rule not found', status: 404 }, 404);
      }
      throw err;
    }

    const updated = await store.getAlertRule(id);
    return c.json(updated);
  });

  // DELETE /api/alerts/rules/:id — delete alert rule
  app.delete('/rules/:id', async (c) => {
    const id = c.req.param('id');

    try {
      await store.deleteAlertRule(id);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return c.json({ error: 'Alert rule not found', status: 404 }, 404);
      }
      throw err;
    }

    return c.json({ id, deleted: true });
  });

  // GET /api/alerts/history — list alert history
  app.get('/history', async (c) => {
    const ruleId = c.req.query('ruleId');
    const limitStr = c.req.query('limit');
    const offsetStr = c.req.query('offset');

    const limit = limitStr ? Math.max(1, Math.min(parseInt(limitStr, 10) || 50, 500)) : 50;
    const offset = offsetStr ? Math.max(0, parseInt(offsetStr, 10) || 0) : 0;

    const result = await store.listAlertHistory({
      ruleId: ruleId ?? undefined,
      limit,
      offset,
    });

    return c.json({
      entries: result.entries,
      total: result.total,
      hasMore: offset + result.entries.length < result.total,
    });
  });

  return app;
}
