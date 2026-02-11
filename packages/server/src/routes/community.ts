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
import { createLogger } from '../lib/logger.js';

const log = createLogger('Community');

const VALID_CATEGORIES = new Set(LESSON_SHARING_CATEGORIES);

export function communityRoutes(db: SqliteDb, transport?: PoolTransport) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const poolTransport = transport ?? new LocalCommunityPoolTransport();
  const service = new CommunityService(db, { transport: poolTransport });

  function getTenantId(c: { get(key: 'apiKey'): { tenantId?: string } | undefined }): string {
    return c.get('apiKey')?.tenantId ?? 'default';
  }

  // ─── Share ─────────────────────────────────────────

  /**
   * @summary Share a lesson with the community pool
   * @description Publishes a lesson to the community sharing pool. Subject to tenant/agent sharing
   * config, deny-list filtering, rate limiting, and optional human review.
   * @body {{ lessonId: string }}
   * @returns {201} `{ status: 'shared', ... }` — successfully shared
   * @returns {202} `{ status: 'pending_review', ... }` — queued for human review
   * @throws {400} Missing or invalid lessonId
   * @throws {403} Sharing disabled for this tenant/agent
   * @throws {422} Lesson blocked by deny-list
   * @throws {429} Rate limit exceeded
   * @throws {500} Internal sharing error
   */
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

  /**
   * @summary Search shared community lessons
   * @description Queries the community pool for shared lessons, with optional category and reputation filters.
   * @param {string} [q|query] — search text (query param)
   * @param {string} [category] — filter by lesson category (query param)
   * @param {number} [minReputation] — minimum reputation score (query param)
   * @param {number} [limit] — max results, capped at 50 (query param, default 50)
   * @returns {200} `{ lessons: SharedLesson[], total: number }`
   * @throws {400} Invalid category value
   */
  app.get('/search', async (c) => {
    const tenantId = getTenantId(c);
    const query = c.req.query('q') || c.req.query('query') || '';

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

  /**
   * @summary Get tenant sharing configuration
   * @description Returns the current community sharing settings for the tenant.
   * @returns {200} `SharingConfig` — enabled, humanReviewEnabled, rateLimitPerHour, etc.
   */
  app.get('/config', async (c) => {
    const tenantId = getTenantId(c);
    const config = service.getSharingConfig(tenantId);
    return c.json(config);
  });

  /**
   * @summary Update tenant sharing configuration
   * @description Partially updates the community sharing settings for the tenant.
   * @body {{ enabled?: boolean, humanReviewEnabled?: boolean, poolEndpoint?: string, rateLimitPerHour?: number, volumeAlertThreshold?: number, categories?: string[] }}
   * @returns {200} `SharingConfig` — the updated configuration
   * @throws {400} Invalid JSON body, invalid field values, or invalid category
   */
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

  /**
   * @summary List all agent sharing configurations
   * @description Returns sharing configs for all agents in the tenant.
   * @returns {200} `{ configs: AgentSharingConfig[] }`
   */
  app.get('/agents', async (c) => {
    const tenantId = getTenantId(c);
    const configs = service.getAgentSharingConfigs(tenantId);
    return c.json({ configs });
  });

  // ─── Agent Config ──────────────────────────────────

  /**
   * @summary Get agent-level sharing configuration
   * @description Returns the sharing config for a specific agent within the tenant.
   * @param {string} agentId — Agent ID (path)
   * @returns {200} `{ config: AgentSharingConfig }`
   */
  app.get('/config/agents/:agentId', async (c) => {
    const tenantId = getTenantId(c);
    const agentId = c.req.param('agentId');
    const config = service.getAgentSharingConfig(tenantId, agentId);
    return c.json({ config });
  });

  /**
   * @summary Update agent-level sharing configuration
   * @description Partially updates the sharing config for a specific agent.
   * @param {string} agentId — Agent ID (path)
   * @body {{ enabled?: boolean, categories?: string[] }}
   * @returns {200} `{ config: AgentSharingConfig }`
   * @throws {400} Invalid JSON body or invalid category
   */
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

  /**
   * @summary Get agent sharing config (dashboard shorthand)
   * @description Alias for GET /config/agents/:agentId, returns config directly.
   * @param {string} agentId — Agent ID (path)
   * @returns {200} `AgentSharingConfig`
   */
  app.get('/agents/:agentId', async (c) => {
    const tenantId = getTenantId(c);
    const agentId = c.req.param('agentId');
    const config = service.getAgentSharingConfig(tenantId, agentId);
    return c.json(config);
  });

  /**
   * @summary Update agent sharing config (dashboard shorthand)
   * @description Alias for PUT /config/agents/:agentId.
   * @param {string} agentId — Agent ID (path)
   * @body {{ enabled?: boolean, categories?: string[] }}
   * @returns {200} `AgentSharingConfig`
   * @throws {400} Invalid JSON body or invalid category
   */
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

  /**
   * @summary Rate a shared community lesson
   * @description Upvote or downvote a shared lesson, affecting its reputation score.
   * @body {{ lessonId: string, delta: 1 | -1 }}
   * @returns {200} `{ status: 'rated', reputationScore: number }`
   * @throws {400} Missing lessonId or invalid delta (must be 1 or -1)
   * @throws {500} Rating operation failed
   */
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

  /**
   * @summary Get community sharing statistics
   * @description Returns aggregate stats for the tenant's community sharing activity.
   * @returns {200} `CommunityStats` — shared count, rating totals, etc.
   */
  app.get('/stats', async (c) => {
    const tenantId = getTenantId(c);
    const stats = service.getStats(tenantId);
    return c.json(stats);
  });

  // (Agent list endpoint already defined above as GET /agents)

  // ─── Purge ─────────────────────────────────────────

  /**
   * @summary Purge all shared lessons for the tenant
   * @description Deletes all community-shared lessons for the tenant. Requires a confirmation string.
   * @body {{ confirmation: string }}
   * @returns {200} `{ status: 'purged', deleted: number }`
   * @throws {400} Missing confirmation or invalid confirmation string
   */
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

  /**
   * @summary List deny-list rules
   * @description Returns all content deny-list rules for the tenant.
   * @returns {200} `{ rules: DenyListRule[] }`
   */
  app.get('/deny-list', async (c) => {
    const tenantId = getTenantId(c);
    const rules = service.getDenyList(tenantId);
    return c.json({ rules });
  });

  /**
   * @summary Add a deny-list rule
   * @description Creates a new content filtering rule. Can be a plain string or regex pattern.
   * @body {{ pattern: string, isRegex?: boolean, reason?: string }}
   * @returns {201} `{ rule: DenyListRule }`
   * @throws {400} Missing pattern or rule creation failed
   */
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
      log.error('addDenyListRule failed', { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: 'Failed to add deny-list rule' }, 400);
    }
  });

  /**
   * @summary Delete a deny-list rule
   * @description Removes a deny-list rule by ID.
   * @param {string} id — Deny-list rule ID (path)
   * @returns {200} `{ deleted: true }`
   * @throws {404} Rule not found
   */
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
