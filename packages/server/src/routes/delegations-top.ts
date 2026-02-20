/**
 * Top-level Delegation Log Routes (dashboard-facing)
 *
 * GET /api/delegations — list all delegation log entries with filters
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { AuthVariables } from '../middleware/auth.js';
import type { SqliteDb } from '../db/index.js';
import * as schema from '../db/schema.sqlite.js';
import { getTenantId } from './tenant-helper.js';

export function delegationTopRoutes(db: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // GET / — list delegation log entries
  app.get('/', async (c) => {
    const tenantId = getTenantId(c);
    const direction = c.req.query('direction') || undefined;
    const status = c.req.query('status') || undefined;
    const from = c.req.query('from') || undefined;
    const to = c.req.query('to') || undefined;
    const limitStr = c.req.query('limit');
    const limit = limitStr ? Math.min(Math.max(1, parseInt(limitStr, 10) || 100), 500) : 100;

    let rows = db
      .select()
      .from(schema.delegationLog)
      .where(eq(schema.delegationLog.tenantId, tenantId))
      .all();

    if (direction) rows = rows.filter((r) => r.direction === direction);
    if (status) rows = rows.filter((r) => r.status === status);
    if (from) rows = rows.filter((r) => r.createdAt >= from);
    if (to) rows = rows.filter((r) => r.createdAt <= to);

    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const total = rows.length;
    const paged = rows.slice(0, limit);

    return c.json({ delegations: paged, total });
  });

  return app;
}
