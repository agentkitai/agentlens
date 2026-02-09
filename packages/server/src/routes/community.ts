/**
 * Community Sharing REST API (Stories 4.1–4.3)
 *
 * POST /api/community/share           — share a lesson
 * GET  /api/community/search          — search shared lessons
 * GET  /api/community/config          — get tenant sharing config
 * PUT  /api/community/config          — update tenant sharing config
 * GET  /api/community/config/agents/:agentId — get agent sharing config
 * PUT  /api/community/config/agents/:agentId — update agent sharing config
 * GET  /api/community/deny-list       — list deny-list rules
 * POST /api/community/deny-list       — add deny-list rule
 * DELETE /api/community/deny-list/:id — delete deny-list rule
 */

import { Hono } from 'hono';
import type { AuthVariables } from '../middleware/auth.js';
import type { SqliteDb } from '../db/index.js';
import { CommunityService, LocalCommunityPoolTransport, type PoolTransport } from '../services/community-service.js';
import { LESSON_SHARING_CATEGORIES } from '@agentlensai/core';

const VALID_CATEGORIES = new Set(LESSON_SHARING_CATEGORIES);

export function communityRoutes(db: SqliteDb, transport?: PoolTransport) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const poolTransport = transport ?? new LocalCommunityPoolTransport();
  const service = new CommunityService(db, { transport: poolTransport });

  function getTenantId(c: { get(key: 'apiKey'): { tenantId?: string } | undefined }): string {
    return c.get('apiKey')?.tenantId ?? 'default';
  }

  // ─── Share ─────────────────────────────────────────

  app.post('/share', async (c) => {
    const tenantId = getTenantId(c);
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const lessonId = body.lessonId as string;
    if (!lessonId || typeof lessonId !== 'string') {
      return c.json({ error: 'lessonId is required' }, 400);
    }

    const result = await service.share(tenantId, lessonId, 'api');
    
    switch (result.status) {
      case 'shared':
        return c.json(result, 201);
      case 'rate_limited':
        return c.json({ error: 'Rate limit exceeded', status: 'rate_limited' }, 429);
      case 'disabled':
        return c.json({ error: result.reason, status: 'disabled' }, 403);
      case 'blocked':
        return c.json({ error: result.reason, status: 'blocked' }, 422);
      case 'pending_review':
        return c.json(result, 202);
      case 'error':
        return c.json({ error: result.error, status: 'error' }, 500);
    }
  });

  // ─── Search ────────────────────────────────────────

  app.get('/search', async (c) => {
    const tenantId = getTenantId(c);
    const query = c.req.query('q') || c.req.query('query');
    if (!query) {
      return c.json({ error: 'q (query) parameter is required' }, 400);
    }

    const category = c.req.query('category') || undefined;
    if (category && !VALID_CATEGORIES.has(category as any)) {
      return c.json({ error: `Invalid category. Must be one of: ${LESSON_SHARING_CATEGORIES.join(', ')}` }, 400);
    }

    const minReputation = c.req.query('minReputation') ? Number(c.req.query('minReputation')) : undefined;
    const limit = c.req.query('limit') ? Math.min(Number(c.req.query('limit')), 50) : 50;

    const result = await service.search(tenantId, query, { category, minReputation, limit }, 'api');
    return c.json(result);
  });

  // ─── Tenant Config ────────────────────────────────

  app.get('/config', async (c) => {
    const tenantId = getTenantId(c);
    const config = service.getSharingConfig(tenantId);
    return c.json(config);
  });

  app.put('/config', async (c) => {
    const tenantId = getTenantId(c);
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const updates: Record<string, unknown> = {};
    if (body.enabled !== undefined) updates.enabled = Boolean(body.enabled);
    if (body.humanReviewEnabled !== undefined) updates.humanReviewEnabled = Boolean(body.humanReviewEnabled);
    if (body.poolEndpoint !== undefined) updates.poolEndpoint = body.poolEndpoint;
    if (body.rateLimitPerHour !== undefined) {
      const val = Number(body.rateLimitPerHour);
      if (isNaN(val) || val < 1) return c.json({ error: 'rateLimitPerHour must be >= 1' }, 400);
      updates.rateLimitPerHour = val;
    }
    if (body.volumeAlertThreshold !== undefined) {
      const val = Number(body.volumeAlertThreshold);
      if (isNaN(val) || val < 1) return c.json({ error: 'volumeAlertThreshold must be >= 1' }, 400);
      updates.volumeAlertThreshold = val;
    }
    if (body.categories !== undefined) {
      if (!Array.isArray(body.categories)) return c.json({ error: 'categories must be an array' }, 400);
      for (const cat of body.categories) {
        if (!VALID_CATEGORIES.has(cat)) {
          return c.json({ error: `Invalid category: ${cat}` }, 400);
        }
      }
    }

    const config = service.updateSharingConfig(tenantId, updates as any);
    return c.json(config);
  });

  // ─── Agent Config (list all) ────────────────────────

  app.get('/agents', async (c) => {
    const tenantId = getTenantId(c);
    const configs = service.getAgentSharingConfigs(tenantId);
    return c.json({ configs });
  });

  // ─── Agent Config ──────────────────────────────────

  app.get('/config/agents/:agentId', async (c) => {
    const tenantId = getTenantId(c);
    const agentId = c.req.param('agentId');
    const config = service.getAgentSharingConfig(tenantId, agentId);
    return c.json({ config });
  });

  app.put('/config/agents/:agentId', async (c) => {
    const tenantId = getTenantId(c);
    const agentId = c.req.param('agentId');
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const updates: Record<string, unknown> = {};
    if (body.enabled !== undefined) updates.enabled = Boolean(body.enabled);
    if (body.categories !== undefined) {
      if (!Array.isArray(body.categories)) return c.json({ error: 'categories must be an array' }, 400);
      for (const cat of body.categories) {
        if (!VALID_CATEGORIES.has(cat)) {
          return c.json({ error: `Invalid category: ${cat}` }, 400);
        }
      }
      updates.categories = body.categories;
    }

    const config = service.updateAgentSharingConfig(tenantId, agentId, updates as any);
    return c.json({ config });
  });

  // ─── Agent Config (dashboard shorthand) ─────────────

  app.get('/agents/:agentId', async (c) => {
    const tenantId = getTenantId(c);
    const agentId = c.req.param('agentId');
    const config = service.getAgentSharingConfig(tenantId, agentId);
    return c.json(config);
  });

  app.put('/agents/:agentId', async (c) => {
    const tenantId = getTenantId(c);
    const agentId = c.req.param('agentId');
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const updates: Record<string, unknown> = {};
    if (body.enabled !== undefined) updates.enabled = Boolean(body.enabled);
    if (body.categories !== undefined) {
      if (!Array.isArray(body.categories)) return c.json({ error: 'categories must be an array' }, 400);
      updates.categories = body.categories;
    }

    const config = service.updateAgentSharingConfig(tenantId, agentId, updates as any);
    return c.json(config);
  });

  // ─── Rate ──────────────────────────────────────────

  app.post('/rate', async (c) => {
    const tenantId = getTenantId(c);
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const lessonId = body.lessonId as string;
    const delta = Number(body.delta);
    if (!lessonId) return c.json({ error: 'lessonId is required' }, 400);
    if (isNaN(delta) || (delta !== 1 && delta !== -1)) return c.json({ error: 'delta must be 1 or -1' }, 400);

    const result = await service.rate(tenantId, lessonId, delta, 'vote', 'api');
    if (result.status === 'rated') {
      return c.json({ status: 'rated', reputationScore: result.reputationScore });
    }
    return c.json({ error: result.error }, 500);
  });

  // ─── Stats ─────────────────────────────────────────

  app.get('/stats', async (c) => {
    const tenantId = getTenantId(c);
    const stats = service.getStats(tenantId);
    return c.json(stats);
  });

  // (Agent list endpoint already defined above as GET /agents)

  // ─── Purge ─────────────────────────────────────────

  app.post('/purge', async (c) => {
    const tenantId = getTenantId(c);
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const confirmation = body.confirmation as string;
    if (!confirmation) return c.json({ error: 'confirmation is required' }, 400);

    const result = await service.purge(tenantId, confirmation, 'api');
    if (result.status === 'purged') {
      return c.json({ status: 'purged', deleted: result.deleted });
    }
    return c.json({ error: result.error }, 400);
  });

  // ─── Deny List ─────────────────────────────────────

  app.get('/deny-list', async (c) => {
    const tenantId = getTenantId(c);
    const rules = service.getDenyList(tenantId);
    return c.json({ rules });
  });

  app.post('/deny-list', async (c) => {
    const tenantId = getTenantId(c);
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const pattern = body.pattern as string;
    if (!pattern || typeof pattern !== 'string') {
      return c.json({ error: 'pattern is required' }, 400);
    }
    const reason = (body.reason as string) || 'No reason provided';
    const isRegex = Boolean(body.isRegex);

    try {
      const rule = service.addDenyListRule(tenantId, pattern, isRegex, reason);
      return c.json({ rule }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.delete('/deny-list/:id', async (c) => {
    const tenantId = getTenantId(c);
    const ruleId = c.req.param('id');
    const ok = service.deleteDenyListRule(tenantId, ruleId);
    if (!ok) {
      return c.json({ error: 'Rule not found' }, 404);
    }
    return c.json({ deleted: true });
  });

  return { app, service };
}
