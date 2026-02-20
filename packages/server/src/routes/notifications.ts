/**
 * Notification Channel & Log endpoints (Feature 12, Story 12.10)
 *
 * POST   /api/notifications/channels         — create channel
 * GET    /api/notifications/channels         — list channels
 * GET    /api/notifications/channels/:id     — get channel
 * PUT    /api/notifications/channels/:id     — update channel
 * DELETE /api/notifications/channels/:id     — delete channel
 * POST   /api/notifications/channels/:id/test — test channel
 * GET    /api/notifications/log              — list notification log
 */

import { Hono } from 'hono';
import { ulid } from 'ulid';
import {
  createNotificationChannelSchema,
  updateNotificationChannelSchema,
  validateChannelConfig,
} from '@agentlensai/core';
import type { NotificationChannel } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import type { NotificationChannelRepository } from '../db/repositories/notification-channel-repository.js';
import type { NotificationRouter } from '../lib/notifications/router.js';
import { NotFoundError } from '../db/errors.js';

/** Secret fields that should be redacted in API responses (SEC-3) */
const SECRET_FIELDS = ['smtpPass', 'routingKey', 'webhookUrl', 'headers'];

function redactSecrets(config: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...config };
  for (const field of SECRET_FIELDS) {
    if (redacted[field] && typeof redacted[field] === 'string') {
      redacted[field] = '***';
    }
  }
  return redacted;
}

function redactChannel(ch: NotificationChannel): NotificationChannel {
  return { ...ch, config: redactSecrets(ch.config) };
}

export function notificationRoutes(repo: NotificationChannelRepository, router: NotificationRouter) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // POST /channels — create
  app.post('/channels', async (c) => {
    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) return c.json({ error: 'Invalid JSON body', status: 400 }, 400);

    const parseResult = createNotificationChannelSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return c.json({ error: 'Validation failed', status: 400, details: parseResult.error.issues }, 400);
    }

    const input = parseResult.data;

    // Validate type-specific config
    const configCheck = validateChannelConfig(input.type, input.config as Record<string, unknown>);
    if (!configCheck.valid) {
      return c.json({ error: `Invalid config for type ${input.type}: ${configCheck.error}`, status: 400 }, 400);
    }

    const now = new Date().toISOString();
    const tenantId = (c.get as any)('tenantId') ?? 'default';

    const channel: NotificationChannel = {
      id: ulid(),
      tenantId,
      type: input.type,
      name: input.name,
      config: input.config as Record<string, unknown>,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };

    await repo.createChannel(channel);
    return c.json(redactChannel(channel), 201);
  });

  // GET /channels — list
  app.get('/channels', async (c) => {
    const tenantId = (c.get as any)('tenantId') ?? 'default';
    const channels = await repo.listChannels(tenantId);
    return c.json({ channels: channels.map(redactChannel) });
  });

  // GET /channels/:id
  app.get('/channels/:id', async (c) => {
    const tenantId = (c.get as any)('tenantId') ?? 'default';
    const channel = await repo.getChannel(c.req.param('id'), tenantId);
    if (!channel) return c.json({ error: 'Not found', status: 404 }, 404);
    return c.json(redactChannel(channel));
  });

  // PUT /channels/:id
  app.put('/channels/:id', async (c) => {
    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) return c.json({ error: 'Invalid JSON body', status: 400 }, 400);

    const parseResult = updateNotificationChannelSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return c.json({ error: 'Validation failed', status: 400, details: parseResult.error.issues }, 400);
    }

    const tenantId = (c.get as any)('tenantId') ?? 'default';
    const now = new Date().toISOString();

    try {
      await repo.updateChannel(c.req.param('id'), { ...parseResult.data, updatedAt: now } as Partial<NotificationChannel>, tenantId);
      const updated = await repo.getChannel(c.req.param('id'), tenantId);
      return c.json(updated ? redactChannel(updated) : {});
    } catch (err) {
      if (err instanceof NotFoundError) return c.json({ error: 'Not found', status: 404 }, 404);
      throw err;
    }
  });

  // DELETE /channels/:id
  app.delete('/channels/:id', async (c) => {
    const tenantId = (c.get as any)('tenantId') ?? 'default';
    try {
      await repo.deleteChannel(c.req.param('id'), tenantId);
      return c.json({ success: true });
    } catch (err) {
      if (err instanceof NotFoundError) return c.json({ error: 'Not found', status: 404 }, 404);
      throw err;
    }
  });

  // POST /channels/:id/test — test send
  app.post('/channels/:id/test', async (c) => {
    const tenantId = (c.get as any)('tenantId') ?? 'default';
    const result = await router.testChannel(c.req.param('id'), tenantId);
    return c.json(result, result.success ? 200 : 502);
  });

  // GET /log — notification delivery log
  app.get('/log', async (c) => {
    const tenantId = (c.get as any)('tenantId') ?? 'default';
    const channelId = c.req.query('channelId');
    const ruleId = c.req.query('ruleId');
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);

    const result = await repo.listLog({ tenantId, channelId, ruleId, limit, offset });
    return c.json(result);
  });

  return app;
}
