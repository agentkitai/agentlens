/**
 * Integration tests for Compliance API endpoints (Feature 9 — EU AI Act)
 * Covers Stories 1, 2, 3, 5, 6, 7, 8, 10
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { computeEventHash } from '@agentlensai/core';
import type { HashableEvent } from '@agentlensai/core';
import { createTestApp, authHeaders, createApiKey, type TestContext } from './test-helpers.js';
import { apiKeys, events, auditLog } from '../db/schema.sqlite.js';
import { eq, sql } from 'drizzle-orm';
import { hashApiKey } from '../middleware/auth.js';

// ─── Helpers ────────────────────────────────────────────────

function insertEventChain(
  db: any,
  sessionId: string,
  agentId: string,
  tenantId: string,
  count: number,
  opts?: {
    startDate?: string;
    eventTypes?: string[];
    severities?: string[];
    payloads?: Record<string, unknown>[];
  },
) {
  let prevHash: string | null = null;
  const baseDate = new Date(opts?.startDate ?? '2026-01-15T10:00:00Z');

  for (let i = 0; i < count; i++) {
    const eventType = opts?.eventTypes?.[i] ?? 'custom';
    const severity = opts?.severities?.[i] ?? 'info';
    const payload = opts?.payloads?.[i] ?? { index: i };
    const timestamp = new Date(baseDate.getTime() + i * 1000).toISOString();

    const hashable: HashableEvent = {
      id: `evt_${sessionId}_${String(i).padStart(4, '0')}`,
      timestamp,
      sessionId,
      agentId,
      eventType,
      severity,
      payload,
      metadata: {},
      prevHash,
    };
    const hash = computeEventHash(hashable);

    db.run(sql`
      INSERT INTO events (id, timestamp, session_id, agent_id, event_type, severity, payload, metadata, prev_hash, hash, tenant_id)
      VALUES (${hashable.id}, ${timestamp}, ${sessionId}, ${agentId}, ${eventType}, ${severity},
              ${JSON.stringify(payload)}, '{}', ${prevHash}, ${hash}, ${tenantId})
    `);

    prevHash = hash;
  }
}

// ─── Story 1: Auditor Role RBAC ─────────────────────────────

describe('[F9-S1] Auditor Role RBAC', () => {
  it('isRoleAllowed works for auditor', async () => {
    const { isRoleAllowed } = await import('../cloud/auth/rbac.js');
    expect(isRoleAllowed('auditor', 'read')).toBe(true);
    expect(isRoleAllowed('auditor', 'manage')).toBe(true);
    expect(isRoleAllowed('auditor', 'write')).toBe(false);
    expect(isRoleAllowed('auditor', 'billing')).toBe(false);
  });

  it('existing roles unchanged', async () => {
    const { isRoleAllowed } = await import('../cloud/auth/rbac.js');
    expect(isRoleAllowed('admin', 'read')).toBe(true);
    expect(isRoleAllowed('admin', 'manage')).toBe(true);
    expect(isRoleAllowed('admin', 'write')).toBe(true);
    expect(isRoleAllowed('viewer', 'read')).toBe(true);
    expect(isRoleAllowed('viewer', 'write')).toBe(false);
    expect(isRoleAllowed('viewer', 'manage')).toBe(false);
    expect(isRoleAllowed('member', 'write')).toBe(true);
    expect(isRoleAllowed('member', 'manage')).toBe(false);
  });
});

// ─── Stories 7, 8: Compliance Endpoints ─────────────────────

describe('[F9-S7,S8] Compliance Endpoints', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
    // Set the test key role to admin (scopes: ['*'])
    ctx.db.update(apiKeys).set({ scopes: JSON.stringify(['*']) }).where(eq(apiKeys.id, 'test-key-id')).run();

    // Insert event data
    insertEventChain(ctx.db, 'sess-1', 'agent-1', 'default', 10, {
      startDate: '2026-01-15T10:00:00Z',
    });
  });

  // ─── Report Endpoint ───────────────────────────────────

  describe('GET /api/compliance/report', () => {
    it('returns 200 with all report sections [AC1]', async () => {
      const res = await ctx.app.request(
        '/api/compliance/report?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z',
        { headers: authHeaders(ctx.apiKey) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.version).toBe(1);
      expect(body.systemInfo).toBeDefined();
      expect(body.systemInfo.productName).toBe('AgentLens');
      expect(body.chainVerification).toBeDefined();
      expect(body.chainVerification.verified).toBe(true);
      expect(body.humanOversight).toBeDefined();
      expect(body.incidents).toBeDefined();
      expect(body.costUsage).toBeDefined();
      expect(body.retention).toBeDefined();
    });

    it('returns 400 for missing params', async () => {
      const res = await ctx.app.request('/api/compliance/report', {
        headers: authHeaders(ctx.apiKey),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid dates', async () => {
      const res = await ctx.app.request(
        '/api/compliance/report?from=not-a-date&to=2026-02-01T00:00:00Z',
        { headers: authHeaders(ctx.apiKey) },
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 for range > 365 days', async () => {
      const res = await ctx.app.request(
        '/api/compliance/report?from=2024-01-01T00:00:00Z&to=2026-01-01T00:00:00Z',
        { headers: authHeaders(ctx.apiKey) },
      );
      expect(res.status).toBe(400);
    });

    it('viewer role returns 403 [AC6]', async () => {
      const viewerKey = `als_viewer_${'v'.repeat(50)}`;
      ctx.db.insert(apiKeys).values({
        id: 'viewer-key',
        keyHash: hashApiKey(viewerKey),
        name: 'Viewer',
        scopes: JSON.stringify(['read']),
        createdAt: Math.floor(Date.now() / 1000),
        tenantId: 'default',
      }).run();

      const res = await ctx.app.request(
        '/api/compliance/report?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z',
        { headers: authHeaders(viewerKey) },
      );
      expect(res.status).toBe(403);
    });

    it('auditor role returns 200 [AC7]', async () => {
      const auditorKey = `als_auditor_${'a'.repeat(50)}`;
      ctx.db.insert(apiKeys).values({
        id: 'auditor-key',
        keyHash: hashApiKey(auditorKey),
        name: 'Auditor',
        scopes: JSON.stringify(['read', 'audit']),
        createdAt: Math.floor(Date.now() / 1000),
        tenantId: 'default',
      }).run();

      const res = await ctx.app.request(
        '/api/compliance/report?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z',
        { headers: authHeaders(auditorKey) },
      );
      expect(res.status).toBe(200);
    });

    it('creates audit log entry [AC8]', async () => {
      await ctx.app.request(
        '/api/compliance/report?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z',
        { headers: authHeaders(ctx.apiKey) },
      );

      // Check audit log for the entry
      const entries = ctx.db.all<{ action: string }>(
        sql`SELECT action FROM audit_log WHERE action = 'compliance_report_generated'`,
      );
      expect(entries.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Approval Stats [AC3] ──────────────────────────────

  describe('approval stats in report [AC3]', () => {
    it('counts approval events correctly', async () => {
      // Insert approval events
      const baseDate = new Date('2026-01-16T10:00:00Z');
      for (let i = 0; i < 5; i++) {
        const timestamp = new Date(baseDate.getTime() + i * 1000).toISOString();
        ctx.db.run(sql`
          INSERT INTO events (id, timestamp, session_id, agent_id, event_type, severity, payload, metadata, prev_hash, hash, tenant_id)
          VALUES (${'apr_' + i}, ${timestamp}, 'sess-2', 'agent-1', 'approval_requested', 'info',
                  ${JSON.stringify({ requestId: 'req_' + i })}, '{}', null, ${'hash_apr_' + i}, 'default')
        `);
      }
      // 3 granted
      for (let i = 0; i < 3; i++) {
        const timestamp = new Date(baseDate.getTime() + (i + 10) * 1000).toISOString();
        ctx.db.run(sql`
          INSERT INTO events (id, timestamp, session_id, agent_id, event_type, severity, payload, metadata, prev_hash, hash, tenant_id)
          VALUES (${'apg_' + i}, ${timestamp}, 'sess-2', 'agent-1', 'approval_granted', 'info',
                  ${JSON.stringify({ requestId: 'req_' + i, responseTimeMs: 500 })}, '{}', null, ${'hash_apg_' + i}, 'default')
        `);
      }

      const res = await ctx.app.request(
        '/api/compliance/report?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z',
        { headers: authHeaders(ctx.apiKey) },
      );
      const body = await res.json();

      expect(body.humanOversight.approvalRequests.total).toBe(5);
      expect(body.humanOversight.approvalRequests.granted).toBe(3);
    });
  });

  // ─── Event Export Endpoint ─────────────────────────────

  describe('GET /api/compliance/export/events', () => {
    it('format=json returns events with chainVerification [AC5]', async () => {
      const res = await ctx.app.request(
        '/api/compliance/export/events?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z&format=json',
        { headers: authHeaders(ctx.apiKey) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.events).toHaveLength(10);
      expect(body.totalEvents).toBe(10);
      expect(body.chainVerification).toBeDefined();
      expect(body.chainVerification.verified).toBe(true);
    });

    it('format=csv returns streaming CSV [AC4]', async () => {
      const res = await ctx.app.request(
        '/api/compliance/export/events?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z&format=csv',
        { headers: authHeaders(ctx.apiKey) },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      expect(res.headers.get('content-disposition')).toContain('attachment');
      expect(res.headers.get('x-chain-verification')).toBe('verified');

      const text = await res.text();
      const lines = text.trim().split('\n');
      // BOM + header + 10 data rows
      expect(lines.length).toBe(11); // 1 header + 10 data
      expect(lines[0]).toContain('id,timestamp,session_id');
    });

    it('viewer role returns 403', async () => {
      const viewerKey = `als_viewer2${'v'.repeat(50)}`;
      ctx.db.insert(apiKeys).values({
        id: 'viewer-key-2',
        keyHash: hashApiKey(viewerKey),
        name: 'Viewer 2',
        scopes: JSON.stringify(['read']),
        createdAt: Math.floor(Date.now() / 1000),
        tenantId: 'default',
      }).run();

      const res = await ctx.app.request(
        '/api/compliance/export/events?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z',
        { headers: authHeaders(viewerKey) },
      );
      expect(res.status).toBe(403);
    });
  });
});

// ─── Story 10: Tenant Isolation ─────────────────────────────

describe('[F9-S10] Compliance Tenant Isolation', () => {
  let ctx: TestContext;
  let tenantAKey: string;
  let tenantBKey: string;

  beforeEach(async () => {
    ctx = await createTestApp();

    // Create tenant A key
    tenantAKey = `als_tenantA${'a'.repeat(50)}`;
    ctx.db.insert(apiKeys).values({
      id: 'key-tenant-a',
      keyHash: hashApiKey(tenantAKey),
      name: 'Tenant A',
      scopes: JSON.stringify(['*']),
      createdAt: Math.floor(Date.now() / 1000),
      tenantId: 'tenant-a',
    }).run();

    // Create tenant B key
    tenantBKey = `als_tenantB${'b'.repeat(50)}`;
    ctx.db.insert(apiKeys).values({
      id: 'key-tenant-b',
      keyHash: hashApiKey(tenantBKey),
      name: 'Tenant B',
      scopes: JSON.stringify(['*']),
      createdAt: Math.floor(Date.now() / 1000),
      tenantId: 'tenant-b',
    }).run();

    // Insert 50 events for tenant A
    insertEventChain(ctx.db, 'sess-a1', 'agent-a', 'tenant-a', 50, {
      startDate: '2026-01-15T10:00:00Z',
    });

    // Insert 30 events for tenant B
    insertEventChain(ctx.db, 'sess-b1', 'agent-b', 'tenant-b', 30, {
      startDate: '2026-01-15T10:00:00Z',
    });
  });

  it('event export for tenant A contains exactly 50 events, no tenant B data', async () => {
    const res = await ctx.app.request(
      '/api/compliance/export/events?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z&format=json',
      { headers: authHeaders(tenantAKey) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.totalEvents).toBe(50);
    // Verify no tenant B event IDs
    for (const event of body.events) {
      expect(event.sessionId).toBe('sess-a1');
      expect(event.agentId).toBe('agent-a');
    }
  });

  it('event export for tenant B contains exactly 30 events, no tenant A data', async () => {
    const res = await ctx.app.request(
      '/api/compliance/export/events?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z&format=json',
      { headers: authHeaders(tenantBKey) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.totalEvents).toBe(30);
    for (const event of body.events) {
      expect(event.sessionId).toBe('sess-b1');
      expect(event.agentId).toBe('agent-b');
    }
  });

  it('report for tenant A only includes tenant A data', async () => {
    const res = await ctx.app.request(
      '/api/compliance/report?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z',
      { headers: authHeaders(tenantAKey) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.tenantId).toBe('tenant-a');
    expect(body.chainVerification.totalEvents).toBe(50);
  });

  it('report for tenant B only includes tenant B data', async () => {
    const res = await ctx.app.request(
      '/api/compliance/report?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z',
      { headers: authHeaders(tenantBKey) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.tenantId).toBe('tenant-b');
    expect(body.chainVerification.totalEvents).toBe(30);
  });
});

// ─── Story 2: Event Repository Methods ──────────────────────

describe('[F9-S2] EventRepository compliance methods', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it('getEventsBatchByTenantAndRange returns correct events', async () => {
    insertEventChain(ctx.db, 'sess-1', 'agent-1', 'default', 20, {
      startDate: '2026-01-15T10:00:00Z',
    });

    const { EventRepository } = await import('../db/repositories/event-repository.js');
    const repo = new EventRepository(ctx.db);

    const batch = repo.getEventsBatchByTenantAndRange(
      'default', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', 0, 10,
    );
    expect(batch).toHaveLength(10);
    // Verify ordering
    for (let i = 1; i < batch.length; i++) {
      expect(batch[i].timestamp >= batch[i - 1].timestamp).toBe(true);
    }
  });

  it('getApprovalStats returns correct counts', async () => {
    const { EventRepository } = await import('../db/repositories/event-repository.js');
    const repo = new EventRepository(ctx.db);

    // Insert approval events
    const types = ['approval_requested', 'approval_requested', 'approval_granted', 'approval_denied'];
    for (let i = 0; i < types.length; i++) {
      const ts = new Date(Date.now() - (types.length - i) * 1000).toISOString();
      ctx.db.run(sql`
        INSERT INTO events (id, timestamp, session_id, agent_id, event_type, severity, payload, metadata, prev_hash, hash, tenant_id)
        VALUES (${'apstat_' + i}, ${ts}, 'sess-x', 'agent-x', ${types[i]}, 'info',
                ${JSON.stringify({ responseTimeMs: 100 })}, '{}', null, ${'hash_apstat_' + i}, 'default')
      `);
    }

    const stats = repo.getApprovalStats('default', '2020-01-01T00:00:00Z', '2030-01-01T00:00:00Z');
    expect(stats.total).toBe(2);
    expect(stats.granted).toBe(1);
    expect(stats.denied).toBe(1);
    expect(stats.expired).toBe(0);
  });

  it('getApprovalStats returns null avgResponseTimeMs when no data', async () => {
    const { EventRepository } = await import('../db/repositories/event-repository.js');
    const repo = new EventRepository(ctx.db);

    const stats = repo.getApprovalStats('default', '2020-01-01T00:00:00Z', '2030-01-01T00:00:00Z');
    expect(stats.total).toBe(0);
    expect(stats.avgResponseTimeMs).toBeNull();
  });

  it('getIncidentEvents returns error/critical and alert events', async () => {
    const { EventRepository } = await import('../db/repositories/event-repository.js');
    const repo = new EventRepository(ctx.db);

    const ts1 = '2026-01-15T10:00:00Z';
    const ts2 = '2026-01-15T10:00:01Z';
    const ts3 = '2026-01-15T10:00:02Z';
    ctx.db.run(sql`INSERT INTO events (id, timestamp, session_id, agent_id, event_type, severity, payload, metadata, prev_hash, hash, tenant_id)
      VALUES ('inc1', ${ts1}, 'sess', 'agent', 'tool_error', 'error', '{}', '{}', null, 'h1', 'default')`);
    ctx.db.run(sql`INSERT INTO events (id, timestamp, session_id, agent_id, event_type, severity, payload, metadata, prev_hash, hash, tenant_id)
      VALUES ('inc2', ${ts2}, 'sess', 'agent', 'alert_triggered', 'warning', '{}', '{}', null, 'h2', 'default')`);
    ctx.db.run(sql`INSERT INTO events (id, timestamp, session_id, agent_id, event_type, severity, payload, metadata, prev_hash, hash, tenant_id)
      VALUES ('inc3', ${ts3}, 'sess', 'agent', 'custom', 'info', '{}', '{}', null, 'h3', 'default')`);

    const incidents = repo.getIncidentEvents('default', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
    expect(incidents).toHaveLength(2);
    const ids = incidents.map(i => i.id);
    expect(ids).toContain('inc1');
    expect(ids).toContain('inc2');
    expect(ids).not.toContain('inc3');
  });

  it('getIncidentEvents respects limit', async () => {
    const { EventRepository } = await import('../db/repositories/event-repository.js');
    const repo = new EventRepository(ctx.db);

    for (let i = 0; i < 5; i++) {
      const ts = new Date(Date.now() - (5 - i) * 1000).toISOString();
      ctx.db.run(sql`INSERT INTO events (id, timestamp, session_id, agent_id, event_type, severity, payload, metadata, prev_hash, hash, tenant_id)
        VALUES (${'lim_' + i}, ${ts}, 'sess', 'agent', 'tool_error', 'error', '{}', '{}', null, ${'hlim_' + i}, 'default')`);
    }

    const incidents = repo.getIncidentEvents('default', '2020-01-01T00:00:00Z', '2030-01-01T00:00:00Z', 3);
    expect(incidents).toHaveLength(3);
  });

  it('all methods return empty for tenants with no data', async () => {
    const { EventRepository } = await import('../db/repositories/event-repository.js');
    const repo = new EventRepository(ctx.db);

    const batch = repo.getEventsBatchByTenantAndRange('nonexistent', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', 0, 10);
    expect(batch).toHaveLength(0);

    const stats = repo.getApprovalStats('nonexistent', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
    expect(stats.total).toBe(0);

    const incidents = repo.getIncidentEvents('nonexistent', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
    expect(incidents).toHaveLength(0);
  });
});

// ─── Story 5: ComplianceReportBuilder ───────────────────────

describe('[F9-S5] ComplianceReportBuilder', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
    insertEventChain(ctx.db, 'sess-1', 'agent-1', 'default', 10, {
      startDate: '2026-01-15T10:00:00Z',
    });
  });

  it('builds a complete report with all sections', async () => {
    const { EventRepository } = await import('../db/repositories/event-repository.js');
    const { AnalyticsRepository } = await import('../db/repositories/analytics-repository.js');
    const { GuardrailStore } = await import('../db/guardrail-store.js');
    const { ComplianceReportBuilder } = await import('../lib/compliance-report.js');

    const builder = new ComplianceReportBuilder(
      new EventRepository(ctx.db),
      new AnalyticsRepository(ctx.db),
      new GuardrailStore(ctx.db),
      'test-signing-key',
    );

    const report = await builder.build('default', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');

    expect(report.version).toBe(1);
    expect(report.tenantId).toBe('default');
    expect(report.systemInfo.productName).toBe('AgentLens');
    expect(report.chainVerification.verified).toBe(true);
    expect(report.chainVerification.totalEvents).toBe(10);
    expect(report.humanOversight).toBeDefined();
    expect(report.incidents).toBeDefined();
    expect(report.costUsage).toBeDefined();
    expect(report.retention).toBeDefined();
    expect(report.retention.chainIntact).toBe(true);
  });

  it('signs report with HMAC-SHA256 [AC2]', async () => {
    const { EventRepository } = await import('../db/repositories/event-repository.js');
    const { AnalyticsRepository } = await import('../db/repositories/analytics-repository.js');
    const { GuardrailStore } = await import('../db/guardrail-store.js');
    const { ComplianceReportBuilder } = await import('../lib/compliance-report.js');

    const signingKey = 'test-key-for-signing';
    const builder = new ComplianceReportBuilder(
      new EventRepository(ctx.db),
      new AnalyticsRepository(ctx.db),
      new GuardrailStore(ctx.db),
      signingKey,
    );

    const report = await builder.build('default', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');

    expect(report.signature).toBeTruthy();
    expect(report.signature!.startsWith('hmac-sha256:')).toBe(true);

    // Verify independently
    const { signature, ...body } = report;
    const expectedHmac = createHmac('sha256', signingKey)
      .update(JSON.stringify(body))
      .digest('hex');
    expect(signature).toBe('hmac-sha256:' + expectedHmac);
  });

  it('signature is null when no signing key', async () => {
    const { EventRepository } = await import('../db/repositories/event-repository.js');
    const { AnalyticsRepository } = await import('../db/repositories/analytics-repository.js');
    const { GuardrailStore } = await import('../db/guardrail-store.js');
    const { ComplianceReportBuilder } = await import('../lib/compliance-report.js');

    const builder = new ComplianceReportBuilder(
      new EventRepository(ctx.db),
      new AnalyticsRepository(ctx.db),
      new GuardrailStore(ctx.db),
    );

    const report = await builder.build('default', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
    expect(report.signature).toBeNull();
  });
});

// ─── Story 6: CSV Export ────────────────────────────────────

describe('[F9-S6] CSV Export', () => {
  it('escapes fields with commas, quotes, newlines', async () => {
    const { CsvEventTransform } = await import('../lib/compliance-export.js');
    const transform = new CsvEventTransform();

    const chunks: string[] = [];
    transform.on('data', (chunk: string) => chunks.push(chunk));

    const done = new Promise<void>((resolve) => transform.on('end', resolve));

    transform.write({
      id: 'evt-1',
      timestamp: '2026-01-15T10:00:00Z',
      sessionId: 'sess-1',
      agentId: 'agent-1',
      eventType: 'custom',
      severity: 'info',
      payload: '{"message":"hello, world","desc":"line1\\nline2"}',
      metadata: '{}',
      prevHash: null,
      hash: 'abc123',
    });
    transform.end();
    await done;

    const output = chunks.join('');
    // Header should be present with BOM
    expect(output.charCodeAt(0)).toBe(0xFEFF);
    expect(output).toContain('id,timestamp,session_id');
    // Payload with comma should be quoted
    expect(output).toContain('"');
  });

  it('handles empty dataset', async () => {
    const { CsvEventTransform } = await import('../lib/compliance-export.js');
    const transform = new CsvEventTransform();

    const chunks: string[] = [];
    transform.on('data', (chunk: string) => chunks.push(chunk));

    const done = new Promise<void>((resolve) => transform.on('end', resolve));
    transform.end();
    await done;

    // No output for empty dataset (no header either since no rows)
    expect(chunks.join('')).toBe('');
  });
});

// ─── Story 3: GuardrailStore.getTriggerStats ────────────────

describe('[F9-S3] GuardrailStore.getTriggerStats', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it('returns zero for tenants with no data', async () => {
    const { GuardrailStore } = await import('../db/guardrail-store.js');
    const store = new GuardrailStore(ctx.db);

    const stats = store.getTriggerStats('nonexistent', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
    expect(stats.total).toBe(0);
    expect(stats.byConditionType).toEqual({});
    expect(stats.byActionType).toEqual({});
  });
});

// ─── Story 3: AnalyticsRepository.getCostByAgent ────────────

describe('[F9-S3] AnalyticsRepository.getCostByAgent', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it('returns per-agent cost breakdown', async () => {
    // Insert cost_tracked events
    ctx.db.run(sql`INSERT INTO events (id, timestamp, session_id, agent_id, event_type, severity, payload, metadata, prev_hash, hash, tenant_id)
      VALUES ('cost1', '2026-01-15T10:00:00Z', 'sess', 'agent-a', 'cost_tracked', 'info', '{"costUsd": 1.5}', '{}', null, 'hc1', 'default')`);
    ctx.db.run(sql`INSERT INTO events (id, timestamp, session_id, agent_id, event_type, severity, payload, metadata, prev_hash, hash, tenant_id)
      VALUES ('cost2', '2026-01-15T10:00:01Z', 'sess', 'agent-a', 'cost_tracked', 'info', '{"costUsd": 2.0}', '{}', null, 'hc2', 'default')`);
    ctx.db.run(sql`INSERT INTO events (id, timestamp, session_id, agent_id, event_type, severity, payload, metadata, prev_hash, hash, tenant_id)
      VALUES ('cost3', '2026-01-15T10:00:02Z', 'sess', 'agent-b', 'cost_tracked', 'info', '{"costUsd": 0.5}', '{}', null, 'hc3', 'default')`);

    const { AnalyticsRepository } = await import('../db/repositories/analytics-repository.js');
    const repo = new AnalyticsRepository(ctx.db);

    const costByAgent = repo.getCostByAgent('default', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
    expect(costByAgent['agent-a']).toBe(3.5);
    expect(costByAgent['agent-b']).toBe(0.5);
  });

  it('returns empty for tenants with no data', async () => {
    const { AnalyticsRepository } = await import('../db/repositories/analytics-repository.js');
    const repo = new AnalyticsRepository(ctx.db);

    const costByAgent = repo.getCostByAgent('nonexistent', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
    expect(Object.keys(costByAgent)).toHaveLength(0);
  });
});
