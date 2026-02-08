/**
 * Replay REST Endpoint (Stories 2.2, 2.3)
 *
 * GET /api/sessions/:id/replay — Returns ReplayState for session replay UI.
 *
 * Supports pagination, event type filtering, and server-side LRU caching.
 */

import { Hono } from 'hono';
import type { IEventStore, EventType, ReplayState } from '@agentlensai/core';
import { EVENT_TYPES } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantStore } from './tenant-helper.js';
import { ReplayBuilder } from '../lib/replay/builder.js';

// ─── LRU Cache (Story 2.3) ────────────────────────────────

const MAX_CACHE_SIZE = 100;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const LLM_HISTORY_CAP = 50;

interface CacheEntry {
  state: ReplayState;
  createdAt: number;
}

/** Simple Map-based LRU cache with TTL. Exported for testing. */
export const replayCache = new Map<string, CacheEntry>();

function cacheKey(tenantId: string, sessionId: string): string {
  return `${tenantId}:${sessionId}`;
}

function getCached(tenantId: string, sessionId: string): ReplayState | null {
  const key = cacheKey(tenantId, sessionId);
  const entry = replayCache.get(key);
  if (!entry) return null;

  // TTL check
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    replayCache.delete(key);
    return null;
  }

  // Move to end (most-recently-used)
  replayCache.delete(key);
  replayCache.set(key, entry);
  return entry.state;
}

function putCache(tenantId: string, sessionId: string, state: ReplayState): void {
  const key = cacheKey(tenantId, sessionId);

  // Evict if at capacity (remove oldest = first entry)
  if (replayCache.size >= MAX_CACHE_SIZE && !replayCache.has(key)) {
    const firstKey = replayCache.keys().next().value;
    if (firstKey !== undefined) {
      replayCache.delete(firstKey);
    }
  }

  replayCache.set(key, { state, createdAt: Date.now() });
}

/**
 * Cap LLM history in context to the last N entries (memory guard).
 */
function capLlmHistory(state: ReplayState): ReplayState {
  for (const step of state.steps) {
    if (step.context.llmHistory.length > LLM_HISTORY_CAP) {
      step.context.llmHistory = step.context.llmHistory.slice(-LLM_HISTORY_CAP);
    }
  }
  return state;
}

// ─── Route Registration ────────────────────────────────────

/**
 * Register the replay route directly on the provided Hono app.
 * Path: GET /api/sessions/:id/replay
 *
 * Uses `registerReplayRoutes(app, store)` pattern (like health routes)
 * since the path nests under /api/sessions which already has auth middleware.
 */
export function registerReplayRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  store: IEventStore,
): void {
  app.get('/api/sessions/:id/replay', async (c) => {
    const tenantStore = getTenantStore(store, c);
    const sessionId = c.req.param('id');

    // ── Parse & validate query params ──

    // offset
    const offsetStr = c.req.query('offset');
    let offset = 0;
    if (offsetStr !== undefined && offsetStr !== '') {
      const parsed = parseInt(offsetStr, 10);
      if (isNaN(parsed) || parsed < 0) {
        return c.json(
          { error: 'Invalid offset: must be a non-negative integer', status: 400 },
          400,
        );
      }
      offset = parsed;
    }

    // limit
    const limitStr = c.req.query('limit');
    let limit = 1000;
    if (limitStr !== undefined && limitStr !== '') {
      const parsed = parseInt(limitStr, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 5000) {
        return c.json(
          { error: 'Invalid limit: must be an integer between 1 and 5000', status: 400 },
          400,
        );
      }
      limit = parsed;
    }

    // eventTypes
    const eventTypesStr = c.req.query('eventTypes');
    let eventTypes: EventType[] | undefined;
    if (eventTypesStr !== undefined && eventTypesStr !== '') {
      const types = eventTypesStr.split(',').map((s) => s.trim()) as EventType[];
      const validTypes = new Set<string>(EVENT_TYPES);
      for (const t of types) {
        if (!validTypes.has(t)) {
          return c.json(
            { error: `Invalid event type: ${t}`, status: 400 },
            400,
          );
        }
      }
      eventTypes = types;
    }

    // includeContext
    const includeContextStr = c.req.query('includeContext');
    let includeContext = true;
    if (includeContextStr !== undefined && includeContextStr !== '') {
      if (includeContextStr === 'false' || includeContextStr === '0') {
        includeContext = false;
      } else if (includeContextStr !== 'true' && includeContextStr !== '1') {
        return c.json(
          { error: 'Invalid includeContext: must be true or false', status: 400 },
          400,
        );
      }
    }

    try {
      const builder = new ReplayBuilder(tenantStore);
      const state = await builder.build(sessionId, {
        offset,
        limit,
        eventTypes,
        includeContext,
      });

      if (!state) {
        return c.json(
          { error: 'Session not found', status: 404 },
          404,
        );
      }

      // Apply memory guard: cap LLM history
      capLlmHistory(state);

      // Cache the state (LLM history has been capped for memory efficiency)
      const apiKeyInfo = c.get('apiKey');
      const tenantId = apiKeyInfo?.tenantId ?? 'default';
      putCache(tenantId, sessionId, state);

      return c.json(state);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal error';
      return c.json({ error: message, status: 500 }, 500);
    }
  });
}
