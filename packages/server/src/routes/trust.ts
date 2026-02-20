/**
 * Trust REST API (Story 6.3)
 *
 * GET /api/agents/:id/trust — get trust score for an agent
 */

import { Hono } from 'hono';
import type { AuthVariables } from '../middleware/auth.js';
import type { SqliteDb } from '../db/index.js';
import { TrustService } from '../services/trust-service.js';
import { getTenantId } from './tenant-helper.js';

export function trustRoutes(db: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const service = new TrustService(db);

  // GET /:id/trust — get trust score
  app.get('/:id/trust', async (c) => {
    const tenantId = getTenantId(c);
    const agentId = c.req.param('id');

    const score = service.getTrustScore(tenantId, agentId);
    return c.json({ trust: score });
  });

  return { app, service };
}
