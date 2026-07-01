/**
 * Audit Log API Endpoint (SH-2)
 *
 * GET /api/audit — paginated, filterable by action, from, to.
 * Requires admin role.
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { getTenantId } from './tenant-helper.js';
import { desc, eq, and, gte, lte, sql } from 'drizzle-orm';
import type { SqliteDb } from '../db/index.js';
import { auditLog } from '../db/schema.sqlite.js';
import { apiKeys } from '../db/schema.sqlite.js';
import type { AuthVariables } from '../middleware/auth.js';
import { dbRun, dbGet } from '../db/dialect-db.js';
import { requestTimestamp, verifyTimestampToken } from '../lib/rfc3161.js';

/** Default RFC 3161 TSA (overridable per-request or via env). */
const DEFAULT_TSA = process.env['AGENTLENS_TSA_URL'] || 'https://freetsa.org/tsr';

export function auditRoutes(db: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get('/', async (c) => {
    // Role check now handled by RBAC middleware (requireCategory('manage'))
    // Keep reading tenantId from legacy apiKey context for backward compat
    const keyInfo = c.get('apiKey');
    const tenantId = getTenantId(c);

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

  // ── #99: RFC 3161 trusted timestamping of audit-export digests ──

  // POST /api/audit/timestamp — anchor a SHA-256 digest via a TSA; stores the token.
  app.post('/timestamp', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { hash?: string; tsaUrl?: string };
    if (!body.hash || !/^[0-9a-fA-F]{64}$/.test(body.hash)) {
      return c.json({ error: 'hash must be a 64-char SHA-256 hex digest', status: 400 }, 400);
    }
    const tsaUrl = body.tsaUrl || DEFAULT_TSA;
    let result;
    try {
      result = await requestTimestamp(tsaUrl, body.hash);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'TSA request failed', status: 502 }, 502);
    }
    const id = randomUUID();
    await dbRun(
      db,
      sql`INSERT INTO audit_timestamps (id, tenant_id, subject_hash, tsa_url, token, gen_time, granted, created_at)
          VALUES (${id}, ${getTenantId(c)}, ${body.hash}, ${tsaUrl}, ${result.token}, ${result.genTime ?? null}, ${result.granted ? 1 : 0}, ${new Date().toISOString()})`,
    );
    return c.json({ id, granted: result.granted, genTime: result.genTime, tsaUrl }, 201);
  });

  // GET /api/audit/timestamp/:id — retrieve a stored token (tenant-scoped).
  app.get('/timestamp/:id', async (c) => {
    const row = await dbGet<{ subject_hash: string; tsa_url: string; token: string; gen_time: string | null; granted: number; created_at: string }>(
      db,
      sql`SELECT subject_hash, tsa_url, token, gen_time, granted, created_at FROM audit_timestamps WHERE id = ${c.req.param('id')} AND tenant_id = ${getTenantId(c)}`,
    );
    if (!row) return c.json({ error: 'Not found', status: 404 }, 404);
    return c.json({
      subjectHash: row.subject_hash, tsaUrl: row.tsa_url, token: row.token,
      genTime: row.gen_time, granted: !!row.granted, createdAt: row.created_at,
    });
  });

  // GET /api/audit/timestamp/:id/verify — offline-verify the stored token binds to
  // its subject hash and is a granted response (TSA signature check is a follow-up).
  app.get('/timestamp/:id/verify', async (c) => {
    const row = await dbGet<{ subject_hash: string; token: string; tsa_url: string }>(
      db,
      sql`SELECT subject_hash, token, tsa_url FROM audit_timestamps WHERE id = ${c.req.param('id')} AND tenant_id = ${getTenantId(c)}`,
    );
    if (!row) return c.json({ error: 'Not found', status: 404 }, 404);
    const v = verifyTimestampToken(row.token, row.subject_hash);
    return c.json({ ...v, subjectHash: row.subject_hash, tsaUrl: row.tsa_url, signatureVerified: false });
  });

  return app;
}
