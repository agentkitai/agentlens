/**
 * Integration tests for GET /api/audit endpoint (SH-2)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, authHeaders, type TestContext } from './test-helpers.js';
import { auditLog } from '../db/schema.sqlite.js';
import { apiKeys } from '../db/schema.sqlite.js';
import { eq } from 'drizzle-orm';

describe('GET /api/audit', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
    // Set the test key role to admin
    ctx.db.update(apiKeys).set({ role: 'admin' }).where(eq(apiKeys.id, 'test-key-id')).run();
  });

  it('returns 403 for non-admin role', async () => {
    // Set role to viewer
    ctx.db.update(apiKeys).set({ role: 'viewer' }).where(eq(apiKeys.id, 'test-key-id')).run();

    const res = await ctx.app.request('/api/audit', {
      headers: authHeaders(ctx.apiKey),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('admin');
  });

  it('returns empty list when no audit entries', async () => {
    const res = await ctx.app.request('/api/audit', {
      headers: authHeaders(ctx.apiKey),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.page).toBe(1);
  });

  it('returns audit entries with pagination', async () => {
    // Insert some audit entries
    for (let i = 0; i < 5; i++) {
      ctx.db.insert(auditLog).values({
        id: `entry-${i}`,
        timestamp: new Date(Date.now() - i * 1000).toISOString(),
        tenantId: 'default',
        actorType: 'user',
        actorId: 'user-1',
        action: 'test.action',
        details: '{}',
      }).run();
    }

    const res = await ctx.app.request('/api/audit?limit=2&page=1', {
      headers: authHeaders(ctx.apiKey),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.total).toBe(5);
    expect(body.totalPages).toBe(3);
    expect(body.page).toBe(1);
  });

  it('filters by action', async () => {
    ctx.db.insert(auditLog).values({
      id: 'a1',
      timestamp: new Date().toISOString(),
      tenantId: 'default',
      actorType: 'user',
      actorId: 'u1',
      action: 'key.create',
      details: '{}',
    }).run();
    ctx.db.insert(auditLog).values({
      id: 'a2',
      timestamp: new Date().toISOString(),
      tenantId: 'default',
      actorType: 'user',
      actorId: 'u1',
      action: 'key.delete',
      details: '{}',
    }).run();

    const res = await ctx.app.request('/api/audit?action=key.create', {
      headers: authHeaders(ctx.apiKey),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].action).toBe('key.create');
  });

  it('filters by from/to date range', async () => {
    const old = new Date('2024-01-01T00:00:00Z').toISOString();
    const recent = new Date('2025-06-01T00:00:00Z').toISOString();

    ctx.db.insert(auditLog).values({
      id: 'old-1',
      timestamp: old,
      tenantId: 'default',
      actorType: 'system',
      actorId: 'system',
      action: 'test',
      details: '{}',
    }).run();
    ctx.db.insert(auditLog).values({
      id: 'recent-1',
      timestamp: recent,
      tenantId: 'default',
      actorType: 'system',
      actorId: 'system',
      action: 'test',
      details: '{}',
    }).run();

    const res = await ctx.app.request(`/api/audit?from=2025-01-01T00:00:00Z`, {
      headers: authHeaders(ctx.apiKey),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe('recent-1');
  });

  it('enforces tenant isolation', async () => {
    ctx.db.insert(auditLog).values({
      id: 'other-tenant',
      timestamp: new Date().toISOString(),
      tenantId: 'other-tenant',
      actorType: 'user',
      actorId: 'u1',
      action: 'test',
      details: '{}',
    }).run();

    const res = await ctx.app.request('/api/audit', {
      headers: authHeaders(ctx.apiKey),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(0);
  });
});
