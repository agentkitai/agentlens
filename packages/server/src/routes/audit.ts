/**
 * Audit Log API Endpoint (SH-2)
 *
 * GET /api/audit — paginated, filterable by action, from, to.
 * Requires admin role.
 */

import { Hono } from 'hono';
import { desc, eq, and, gte, lte, sql } from 'drizzle-orm';
import type { SqliteDb } from '../db/index.js';
import { auditLog } from '../db/schema.sqlite.js';
import { apiKeys } from '../db/schema.sqlite.js';
import type { AuthVariables } from '../middleware/auth.js';

export function auditRoutes(db: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get('/', async (c) => {
    // Role check now handled by RBAC middleware (requireCategory('manage'))
    // Keep reading tenantId from legacy apiKey context for backward compat
    const keyInfo = c.get('apiKey');
    const tenantId = keyInfo?.tenantId ?? 'default';

    // Parse query params
    const action = c.req.query('action');
    const from = c.req.query('from');
    const to = c.req.query('to');
    const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)));
    const offset = (page - 1) * limit;

    // Build conditions
    const conditions = [eq(auditLog.tenantId, tenantId)];
    if (action) conditions.push(eq(auditLog.action, action));
    if (from) conditions.push(gte(auditLog.timestamp, from));
    if (to) conditions.push(lte(auditLog.timestamp, to));

    const where = and(...conditions);

    // Count total
    const countResult = db
      .select({ count: sql<number>`count(*)` })
      .from(auditLog)
      .where(where)
      .get();
    const total = countResult?.count ?? 0;

    // Fetch page
    const rows = db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.timestamp))
      .limit(limit)
      .offset(offset)
      .all();

    const items = rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      tenantId: r.tenantId,
      actorType: r.actorType,
      actorId: r.actorId,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      details: JSON.parse(r.details),
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
    }));

    return c.json({
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  });

  return app;
}
