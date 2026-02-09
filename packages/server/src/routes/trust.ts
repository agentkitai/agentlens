/**
 * Trust REST API (Story 6.3)
 *
 * GET /api/agents/:id/trust — get trust score for an agent
 */

import { Hono } from 'hono';
import type { AuthVariables } from '../middleware/auth.js';
import type { SqliteDb } from '../db/index.js';
import { TrustService } from '../services/trust-service.js';

export function trustRoutes(db: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const service = new TrustService(db);

  function getTenantId(c: { get(key: 'apiKey'): { tenantId?: string } | undefined }): string {
    return c.get('apiKey')?.tenantId ?? 'default';
  }

  // GET /:id/trust — get trust score
  app.get('/:id/trust', async (c) => {
    const tenantId = getTenantId(c);
    const agentId = c.req.param('id');

    const score = service.getTrustScore(tenantId, agentId);
    return c.json({ trust: score });
  });

  return { app, service };
}
