/**
 * Audit Trail Verification Endpoint (Feature 3)
 *
 * GET /api/audit/verify — verifies hash chain integrity across sessions.
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { SqliteDb } from '../db/index.js';
import { apiKeys } from '../db/schema.sqlite.js';
import { EventRepository } from '../db/repositories/event-repository.js';
import { runVerification } from '../lib/audit-verify.js';
import type { AuthVariables } from '../middleware/auth.js';

export function auditVerifyRoutes(db: SqliteDb, signingKey?: string) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const repo = new EventRepository(db);

  app.get('/', async (c) => {
    // Role check: require admin or auditor
    const keyInfo = c.get('apiKey');
    const tenantId = keyInfo?.tenantId ?? 'default';

    let role = 'viewer';
    if (keyInfo?.id === 'dev') {
      role = 'admin';
    } else if (keyInfo?.id) {
      const row = db.select({ role: apiKeys.role }).from(apiKeys).where(eq(apiKeys.id, keyInfo.id)).get();
      role = row?.role ?? 'viewer';
    }

    if (role !== 'admin' && role !== 'auditor') {
      return c.json({ error: 'Forbidden: admin or auditor role required', status: 403 }, 403);
    }

    // Parse params
    const sessionId = c.req.query('sessionId');
    const from = c.req.query('from');
    const to = c.req.query('to');

    if (!sessionId && (!from || !to)) {
      return c.json({ error: 'Provide from/to or sessionId' }, 400);
    }

    // Validate dates
    if (from && isNaN(Date.parse(from))) {
      return c.json({ error: `Invalid ISO 8601 date: ${from}` }, 400);
    }
    if (to && isNaN(Date.parse(to))) {
      return c.json({ error: `Invalid ISO 8601 date: ${to}` }, 400);
    }

    // Range max 1 year
    if (from && to) {
      const diffMs = new Date(to).getTime() - new Date(from).getTime();
      const oneYearMs = 365.25 * 24 * 60 * 60 * 1000;
      if (diffMs > oneYearMs) {
        return c.json({ error: 'Range must not exceed 1 year' }, 400);
      }
    }

    const report = runVerification(repo, {
      tenantId,
      from: from || undefined,
      to: to || undefined,
      sessionId: sessionId || undefined,
      signingKey,
    });

    return c.json(report, 200);
  });

  return app;
}
