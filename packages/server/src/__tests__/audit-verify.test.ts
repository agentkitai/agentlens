/**
 * Integration tests for GET /api/audit/verify (Feature 3, Story 4)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { computeEventHash } from '@agentlensai/core';
import type { HashableEvent } from '@agentlensai/core';
import { createTestApp, authHeaders, createApiKey, type TestContext } from './test-helpers.js';
import { events } from '../db/schema.sqlite.js';
import { apiKeys } from '../db/schema.sqlite.js';
import { eq } from 'drizzle-orm';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestApp();
  // Set the test key to admin role for audit access
  ctx.db.update(apiKeys).set({ role: 'admin' }).where(eq(apiKeys.id, 'test-key-id')).run();
});

function buildAndInsertChain(
  db: typeof ctx.db,
  n: number,
  sessionId: string,
  tenantId = 'default',
  baseTimestamp = '2026-01-15T10:00:00Z',
): void {
  let prevHash: string | null = null;
  for (let i = 0; i < n; i++) {
    const ts = new Date(new Date(baseTimestamp).getTime() + i * 1000).toISOString();
    const event: HashableEvent = {
      id: `evt_${sessionId}_${String(i).padStart(4, '0')}`,
      timestamp: ts,
      sessionId,
      agentId: 'agent_1',
      eventType: 'custom',
      severity: 'info',
      payload: { index: i },
      metadata: {},
      prevHash,
    };
    const hash = computeEventHash(event);
    db.insert(events).values({
      id: event.id,
      timestamp: event.timestamp,
      sessionId: event.sessionId,
      agentId: event.agentId,
      eventType: event.eventType,
      severity: event.severity,
      payload: JSON.stringify(event.payload),
      metadata: JSON.stringify(event.metadata),
      prevHash: event.prevHash,
      hash,
      tenantId,
    }).run();
    prevHash = hash;
  }
}

describe('GET /api/audit/verify', () => {
  it('AC 4.1 — range verification returns valid report', async () => {
    buildAndInsertChain(ctx.db, 20, 'sess_1');
    buildAndInsertChain(ctx.db, 10, 'sess_2');

    const res = await ctx.app.request(
      '/api/audit/verify?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z',
      { headers: authHeaders(ctx.apiKey) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.sessionsVerified).toBe(2);
    expect(body.totalEvents).toBe(30);
    expect(body.brokenChains).toEqual([]);
    expect(body.verifiedAt).toBeTruthy();
    expect(body.range).toEqual({ from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' });
  });

  it('AC 4.2 — single session verification', async () => {
    buildAndInsertChain(ctx.db, 15, 'sess_abc');

    const res = await ctx.app.request(
      '/api/audit/verify?sessionId=sess_abc',
      { headers: authHeaders(ctx.apiKey) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.sessionsVerified).toBe(1);
    expect(body.totalEvents).toBe(15);
    expect(body.range).toBeNull();
    expect(body.sessionId).toBe('sess_abc');
  });

  it('AC 4.3 — missing parameters returns 400', async () => {
    const res = await ctx.app.request(
      '/api/audit/verify',
      { headers: authHeaders(ctx.apiKey) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Provide from/to or sessionId');
  });

  it('AC 4.4 — invalid date format returns 400', async () => {
    const res = await ctx.app.request(
      '/api/audit/verify?from=not-a-date&to=2026-02-01',
      { headers: authHeaders(ctx.apiKey) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid ISO 8601 date');
  });

  it('AC 4.5 — range exceeds 1 year returns 400', async () => {
    const res = await ctx.app.request(
      '/api/audit/verify?from=2024-01-01T00:00:00Z&to=2026-02-01T00:00:00Z',
      { headers: authHeaders(ctx.apiKey) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Range must not exceed 1 year');
  });

  it('AC 4.6 — role enforcement (viewer gets 403)', async () => {
    // Create a key with viewer role
    const viewerKey = createApiKey(ctx.db, { id: 'viewer-key', tenantId: 'default' });
    // Set role to viewer
    ctx.db.update(apiKeys).set({ role: 'viewer' }).where(eq(apiKeys.id, 'viewer-key')).run();

    const res = await ctx.app.request(
      '/api/audit/verify?sessionId=sess_1',
      { headers: authHeaders(viewerKey) },
    );
    expect(res.status).toBe(403);
  });

  it('AC 4.7 — tenant isolation', async () => {
    buildAndInsertChain(ctx.db, 10, 'sess_t1', 'tenant_a');
    buildAndInsertChain(ctx.db, 5, 'sess_t2', 'tenant_b');

    // Query as default tenant — should see nothing
    const res = await ctx.app.request(
      '/api/audit/verify?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z',
      { headers: authHeaders(ctx.apiKey) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionsVerified).toBe(0);
  });

  it('detects broken chain', async () => {
    buildAndInsertChain(ctx.db, 20, 'sess_broken');
    // Tamper event at index 10
    ctx.db.update(events)
      .set({ payload: JSON.stringify({ tampered: true }) })
      .where(eq(events.id, 'evt_sess_broken_0010'))
      .run();

    const res = await ctx.app.request(
      '/api/audit/verify?sessionId=sess_broken',
      { headers: authHeaders(ctx.apiKey) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(false);
    expect(body.brokenChains).toHaveLength(1);
    expect(body.brokenChains[0].failedAtIndex).toBe(10);
    expect(body.brokenChains[0].reason).toContain('hash mismatch');
  });
});
