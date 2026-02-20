/**
 * SSE Stream Endpoint (Story 14.1, Arch §7.2)
 *
 * GET /api/stream — Server-Sent Events endpoint for real-time dashboard updates.
 *
 * Authentication:
 *   - Bearer token via Authorization header, OR
 *   - ?token=als_xxx query param (for EventSource compatibility — browsers can't set headers)
 *   - In dev mode (authDisabled), authentication is skipped
 *
 * Query params:
 *   token?      — API key for auth (EventSource compat)
 *   sessionId?  — filter to a specific session
 *   agentId?    — filter to a specific agent
 *   eventType?  — filter by event type (comma-separated)
 */

import { Hono } from 'hono';
import type { IApiKeyLookup } from '../db/api-key-lookup.js';
import { hashApiKey, type AuthVariables, type ApiKeyInfo } from '../middleware/auth.js';
import { createSSEStream, type SSEFilters } from '../lib/sse.js';

export function streamRoutes(apiKeyLookup?: IApiKeyLookup, authDisabled?: boolean) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get('/', async (c) => {
    // ─── Authenticate ────────────────────────────────────
    let apiKeyInfo: ApiKeyInfo | undefined;

    if (authDisabled) {
      // Dev mode: allow unauthenticated access with default tenant
      apiKeyInfo = { id: 'dev', name: 'dev-mode', scopes: ['*'], tenantId: 'default' };
    } else if (apiKeyLookup) {
      // Try Authorization header first
      const authHeader = c.req.header('Authorization');
      const headerMatch = authHeader?.match(/^Bearer\s+(als_\w+)$/);
      const rawKey = headerMatch?.[1] ?? c.req.query('token');

      if (!rawKey || !rawKey.startsWith('als_')) {
        return c.json({ error: 'Authentication required. Provide Bearer token or ?token=als_xxx query param.', status: 401 }, 401);
      }

      const keyHash = hashApiKey(rawKey);
      const row = await apiKeyLookup.findByHash(keyHash);

      if (!row) {
        return c.json({ error: 'Invalid or revoked API key', status: 401 }, 401);
      }

      const scopes: string[] = (() => {
        if (Array.isArray(row.scopes)) return row.scopes;
        try { return JSON.parse(row.scopes as string) as string[]; } catch { return []; }
      })();

      apiKeyInfo = {
        id: row.id,
        name: row.name,
        scopes,
        tenantId: row.tenantId,
      };
    } else {
      // No lookup and not dev mode — cannot authenticate
      return c.json({ error: 'Authentication not available', status: 500 }, 500);
    }

    // ─── Parse filter params ─────────────────────────────
    const filters: SSEFilters = {};

    const sessionId = c.req.query('sessionId');
    if (sessionId) filters.sessionId = sessionId;

    const agentId = c.req.query('agentId');
    if (agentId) filters.agentId = agentId;

    const eventType = c.req.query('eventType');
    if (eventType) {
      filters.eventTypes = eventType.split(',').filter(Boolean);
    }

    // Tenant filtering — ALWAYS from authenticated context, never from query param
    filters.tenantId = apiKeyInfo.tenantId;

    // Create SSE stream
    const stream = createSSEStream(filters, c.req.raw.signal);

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      },
    });
  });

  return app;
}
