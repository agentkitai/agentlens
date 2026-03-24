/**
 * Audit Trail Verification & Export Endpoints (Feature 3, Feature-4)
 *
 * GET /api/audit/verify          — verifies hash chain integrity across sessions.
 * GET /api/audit/verify/export   — export audit trail as signed JSON for compliance.
 */

import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { getTenantId } from './tenant-helper.js';
import { eq } from 'drizzle-orm';
import type { SqliteDb } from '../db/index.js';
import { apiKeys } from '../db/schema.sqlite.js';
import { EventRepository } from '../db/repositories/event-repository.js';
import { runVerification } from '../lib/audit-verify.js';
import { collectAllEvents } from '../lib/compliance-export.js';
import type { AuthVariables } from '../middleware/auth.js';

/** Resolve role for the current API key */
function resolveRole(db: SqliteDb, keyInfo: { id: string } | undefined): string {
  if (!keyInfo) return 'viewer';
  if (keyInfo.id === 'dev') return 'admin';
  const row = db.select({ role: apiKeys.role }).from(apiKeys).where(eq(apiKeys.id, keyInfo.id)).get();
  return row?.role ?? 'viewer';
}

/** Validate and parse from/to date params */
function parseDateRange(from: string | undefined, to: string | undefined): { error?: string; from?: string; to?: string } {
  if (from && isNaN(Date.parse(from))) return { error: `Invalid ISO 8601 date: ${from}` };
  if (to && isNaN(Date.parse(to))) return { error: `Invalid ISO 8601 date: ${to}` };
  if (from && to) {
    const diffMs = new Date(to).getTime() - new Date(from).getTime();
    const oneYearMs = 365.25 * 24 * 60 * 60 * 1000;
    if (diffMs > oneYearMs) return { error: 'Range must not exceed 1 year' };
  }
  return { from, to };
}

export function auditVerifyRoutes(db: SqliteDb, signingKey?: string) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const repo = new EventRepository(db);

  // GET / — verify hash chain integrity
  app.get('/', async (c) => {
    const keyInfo = c.get('apiKey');
    const tenantId = getTenantId(c);
    const role = resolveRole(db, keyInfo);

    if (role !== 'admin' && role !== 'auditor') {
      return c.json({ error: 'Forbidden: admin or auditor role required', status: 403 }, 403);
    }

    const sessionId = c.req.query('sessionId');
    const from = c.req.query('from');
    const to = c.req.query('to');

    if (!sessionId && (!from || !to)) {
      return c.json({ error: 'Provide from/to or sessionId' }, 400);
    }

    const dateRange = parseDateRange(from, to);
    if (dateRange.error) return c.json({ error: dateRange.error }, 400);

    const TIMEOUT_MS = 30_000;

    const verificationPromise = runVerification(repo, {
      tenantId,
      from: from || undefined,
      to: to || undefined,
      sessionId: sessionId || undefined,
      signingKey,
    });

    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), TIMEOUT_MS),
    );

    const result = await Promise.race([verificationPromise, timeoutPromise]);

    if (result === null) {
      return c.json(
        {
          error: 'Verification timed out',
          message: 'Verification did not complete within 30 seconds. Try a smaller date range or a specific sessionId.',
          status: 504,
        },
        504,
      );
    }

    return c.json(result, 200);
  });

  // GET /export — export audit trail as signed JSON (Feature-4)
  app.get('/export', async (c) => {
    const keyInfo = c.get('apiKey');
    const tenantId = getTenantId(c);
    const role = resolveRole(db, keyInfo);

    if (role !== 'admin' && role !== 'auditor') {
      return c.json({ error: 'Forbidden: admin or auditor role required', status: 403 }, 403);
    }

    const from = c.req.query('from');
    const to = c.req.query('to');

    if (!from || !to) {
      return c.json({ error: 'Both "from" and "to" query parameters are required (ISO 8601)', status: 400 }, 400);
    }

    const dateRange = parseDateRange(from, to);
    if (dateRange.error) return c.json({ error: dateRange.error, status: 400 }, 400);

    // Collect events and verify chain
    const events = collectAllEvents(repo, tenantId, from, to);
    const verification = await runVerification(repo, {
      tenantId,
      from,
      to,
      signingKey,
    });

    const exportBody = {
      exportedAt: new Date().toISOString(),
      tenantId,
      range: { from, to },
      totalEvents: events.length,
      chainVerification: {
        verified: verification.verified,
        sessionsVerified: verification.sessionsVerified,
        firstHash: verification.firstHash,
        lastHash: verification.lastHash,
        brokenChains: verification.brokenChains,
      },
      events: events.map((e) => ({
        id: e.id,
        timestamp: e.timestamp,
        sessionId: e.sessionId,
        agentId: e.agentId,
        eventType: e.eventType,
        severity: e.severity,
        prevHash: e.prevHash,
        hash: e.hash,
      })),
    };

    // Sign the export if signing key is available
    let signature: string | null = null;
    if (signingKey) {
      const canonical = JSON.stringify(exportBody);
      signature = 'hmac-sha256:' + createHmac('sha256', signingKey).update(canonical).digest('hex');
    }

    return c.json({
      ...exportBody,
      signature,
    }, 200);
  });

  return app;
}
