/**
 * Diagnose REST Endpoints (Story 18.8)
 *
 * POST /api/agents/:id/diagnose — Agent-level AI diagnostics
 * POST /api/sessions/:id/diagnose — Session-level AI diagnostics
 */

import { Hono } from 'hono';
import { rateLimiter } from 'hono-rate-limiter';
import type { IEventStore } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantStore } from './tenant-helper.js';
import {
  DiagnosticEngine,
  DiagnosticCache,
  createLLMProvider,
  getLLMConfigFromEnv,
  type DiagnosticReport,
} from '../lib/diagnostics/index.js';

const DIAGNOSE_RATE_MAX = Number(process.env['AGENTLENS_DIAGNOSTIC_RATE_LIMIT'] ?? 5);
const CACHE_TTL_S = Number(process.env['AGENTLENS_DIAGNOSTIC_CACHE_TTL'] ?? 900);

/**
 * Create diagnose routes sub-app.
 */
export function diagnoseRoutes(store: IEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // Diagnose-specific rate limiter (tighter than general API)
  const diagnoseRateLimit = rateLimiter({
    windowMs: 60_000,
    limit: DIAGNOSE_RATE_MAX,
    standardHeaders: 'draft-7',
    keyGenerator: (c) => {
      const authHeader = c.req.header('authorization');
      if (authHeader?.startsWith('Bearer ')) return `diag:${authHeader.slice(7)}`;
      return `diag:${c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'}`;
    },
    handler: (c) => c.json({ error: 'Too Many Requests' }, 429),
  });

  // LLM provider (null if no API key — feature degrades gracefully)
  const llmConfig = getLLMConfigFromEnv();
  const llmProvider = llmConfig ? createLLMProvider(llmConfig) : null;
  const cacheTtlMs = CACHE_TTL_S * 1000;
  const cache = new DiagnosticCache(cacheTtlMs);
  const inflight = new Map<string, Promise<DiagnosticReport>>();

  // POST /agents/:id/diagnose
  app.post('/agents/:id/diagnose', diagnoseRateLimit, async (c) => {
    const tenantStore = getTenantStore(store, c);
    const agentId = c.req.param('id');
    const windowStr = c.req.query('window') ?? '7';
    const refresh = c.req.query('refresh') === 'true';

    const window = parseInt(windowStr, 10);
    if (isNaN(window) || window < 1 || window > 90) {
      return c.json({ error: 'Window must be between 1 and 90', status: 400 }, 400);
    }

    const engine = new DiagnosticEngine(tenantStore, llmProvider, cache, cacheTtlMs, inflight);

    try {
      const report = await engine.diagnoseAgent(agentId, window, { refresh });
      const status = report.source === 'fallback' && llmProvider ? 503 : 200;
      return c.json(report, status as 200);
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 404) {
        return c.json(
          { error: (err as Error).message, status: 404 },
          404,
        );
      }
      throw err;
    }
  });

  // POST /sessions/:id/diagnose
  app.post('/sessions/:id/diagnose', diagnoseRateLimit, async (c) => {
    const tenantStore = getTenantStore(store, c);
    const sessionId = c.req.param('id');
    const refresh = c.req.query('refresh') === 'true';

    const engine = new DiagnosticEngine(tenantStore, llmProvider, cache, cacheTtlMs, inflight);

    try {
      const report = await engine.diagnoseSession(sessionId, { refresh });
      const status = report.source === 'fallback' && llmProvider ? 503 : 200;
      return c.json(report, status as 200);
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 404) {
        return c.json(
          { error: (err as Error).message, status: 404 },
          404,
        );
      }
      throw err;
    }
  });

  return app;
}
