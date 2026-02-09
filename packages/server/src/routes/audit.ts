/**
 * Sharing Audit & Export Routes (Story 7.4)
 *
 * GET  /api/community/audit          — query audit log with filters
 * GET  /api/community/audit/export   — JSON export of sharing audit events
 * GET  /api/community/alerts         — get volume alert config
 * PUT  /api/community/alerts         — update volume alert config
 */

import { Hono } from 'hono';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import type { AuthVariables } from '../middleware/auth.js';
import type { SqliteDb } from '../db/index.js';
import * as schema from '../db/schema.sqlite.js';
import type { SharingAuditEvent } from '@agentlensai/core';

export function auditRoutes(db: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();

  function getTenantId(c: { get(key: 'apiKey'): { tenantId?: string } | undefined }): string {
    return c.get('apiKey')?.tenantId ?? 'default';
  }

  // ─── GET /audit — query audit log with filters ─────

  app.get('/', async (c) => {
    const tenantId = getTenantId(c);
    const eventType = c.req.query('type') || c.req.query('eventType');
    const agentId = c.req.query('agentId');
    const dateFrom = c.req.query('dateFrom') || c.req.query('from');
    const dateTo = c.req.query('dateTo') || c.req.query('to');
    const limitStr = c.req.query('limit');
    const offsetStr = c.req.query('offset');

    const limit = limitStr ? Math.min(Math.max(1, parseInt(limitStr, 10) || 50), 500) : 50;
    const offset = offsetStr ? Math.max(0, parseInt(offsetStr, 10) || 0) : 0;

    // Query all rows for this tenant, then filter in JS (sqlite doesn't have great dynamic WHERE)
    let rows = db
      .select()
      .from(schema.sharingAuditLog)
      .where(eq(schema.sharingAuditLog.tenantId, tenantId))
      .all();

    // Apply filters
    if (eventType) {
      rows = rows.filter((r) => r.eventType === eventType);
    }
    if (agentId) {
      // agentId filtering: match initiatedBy field
      rows = rows.filter((r) => r.initiatedBy === agentId);
    }
    if (dateFrom) {
      rows = rows.filter((r) => r.timestamp >= dateFrom);
    }
    if (dateTo) {
      rows = rows.filter((r) => r.timestamp <= dateTo);
    }

    // Sort by timestamp descending
    rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const total = rows.length;
    const paged = rows.slice(offset, offset + limit);

    const events: SharingAuditEvent[] = paged.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      eventType: r.eventType as SharingAuditEvent['eventType'],
      lessonId: r.lessonId ?? undefined,
      anonymousLessonId: r.anonymousLessonId ?? undefined,
      lessonHash: r.lessonHash ?? undefined,
      redactionFindings: r.redactionFindings ? JSON.parse(r.redactionFindings) : undefined,
      queryText: r.queryText ?? undefined,
      resultIds: r.resultIds ? JSON.parse(r.resultIds) : undefined,
      poolEndpoint: r.poolEndpoint ?? undefined,
      initiatedBy: r.initiatedBy ?? 'system',
      timestamp: r.timestamp,
    }));

    return c.json({ events, total, hasMore: offset + paged.length < total });
  });

  // ─── GET /audit/export — JSON export ───────────────

  app.get('/export', async (c) => {
    const tenantId = getTenantId(c);
    const type = c.req.query('type'); // optional filter by event type

    let rows = db
      .select()
      .from(schema.sharingAuditLog)
      .where(eq(schema.sharingAuditLog.tenantId, tenantId))
      .all();

    if (type) {
      rows = rows.filter((r) => r.eventType === type);
    }

    rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const events = rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      eventType: r.eventType,
      lessonId: r.lessonId,
      anonymousLessonId: r.anonymousLessonId,
      lessonHash: r.lessonHash,
      redactionFindings: r.redactionFindings ? JSON.parse(r.redactionFindings) : null,
      queryText: r.queryText,
      resultIds: r.resultIds ? JSON.parse(r.resultIds) : null,
      poolEndpoint: r.poolEndpoint,
      initiatedBy: r.initiatedBy,
      timestamp: r.timestamp,
    }));

    c.header('Content-Type', 'application/json');
    c.header('Content-Disposition', `attachment; filename="audit-export-${tenantId}-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json({ exportedAt: new Date().toISOString(), tenantId, count: events.length, events });
  });

  // ─── GET /alerts — get volume alert config ─────────

  app.get('/alerts', async (c) => {
    const tenantId = getTenantId(c);
    const config = db
      .select()
      .from(schema.sharingConfig)
      .where(eq(schema.sharingConfig.tenantId, tenantId))
      .get();

    return c.json({
      threshold: config?.volumeAlertThreshold ?? 100,
      rateLimitPerHour: config?.rateLimitPerHour ?? 50,
      enabled: config?.enabled ?? false,
    });
  });

  // ─── PUT /alerts — update volume alert config ──────

  app.put('/alerts', async (c) => {
    const tenantId = getTenantId(c);
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const updates: Record<string, unknown> = {};
    if (body.threshold !== undefined) {
      const val = Number(body.threshold);
      if (isNaN(val) || val < 1) return c.json({ error: 'threshold must be >= 1' }, 400);
      updates.volumeAlertThreshold = val;
    }
    if (body.rateLimitPerHour !== undefined) {
      const val = Number(body.rateLimitPerHour);
      if (isNaN(val) || val < 1) return c.json({ error: 'rateLimitPerHour must be >= 1' }, 400);
      updates.rateLimitPerHour = val;
    }

    if (Object.keys(updates).length === 0) {
      return c.json({ error: 'No valid fields to update' }, 400);
    }

    const existing = db
      .select()
      .from(schema.sharingConfig)
      .where(eq(schema.sharingConfig.tenantId, tenantId))
      .get();

    const now = new Date().toISOString();
    if (existing) {
      db.update(schema.sharingConfig)
        .set({ ...updates, updatedAt: now })
        .where(eq(schema.sharingConfig.tenantId, tenantId))
        .run();
    } else {
      db.insert(schema.sharingConfig).values({
        tenantId,
        enabled: false,
        humanReviewEnabled: false,
        poolEndpoint: null,
        anonymousContributorId: null,
        purgeToken: null,
        rateLimitPerHour: (updates.rateLimitPerHour as number) ?? 50,
        volumeAlertThreshold: (updates.volumeAlertThreshold as number) ?? 100,
        updatedAt: now,
      }).run();
    }

    const config = db
      .select()
      .from(schema.sharingConfig)
      .where(eq(schema.sharingConfig.tenantId, tenantId))
      .get();

    return c.json({
      threshold: config?.volumeAlertThreshold ?? 100,
      rateLimitPerHour: config?.rateLimitPerHour ?? 50,
      enabled: config?.enabled ?? false,
    });
  });

  return app;
}
