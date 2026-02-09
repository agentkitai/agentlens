/**
 * Tests for S-2.5 (RBAC Middleware) and S-2.6 (Audit Log)
 *
 * Unit tests run without Postgres.
 * Integration tests run when DATABASE_URL is set.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  requireRole,
  requireActionCategory,
  isRoleAllowed,
  categorizeAction,
  PERMISSION_MATRIX,
  type Role,
  type ActionCategory,
  type RbacRequest,
} from '../auth/rbac.js';
import {
  AuditLogService,
  type AuditAction,
  type WriteAuditEntry,
} from '../auth/audit-log.js';
import { runMigrations, type MigrationClient } from '../migrate.js';
import { join } from 'path';

const MIGRATIONS_DIR = join(import.meta.dirname ?? __dirname, '..', 'migrations');

// ═══════════════════════════════════════════
// S-2.5: RBAC Unit Tests
// ═══════════════════════════════════════════

describe('S-2.5: Permission matrix', () => {
  it('read: all roles allowed', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer'] as Role[]) {
      expect(isRoleAllowed(role, 'read')).toBe(true);
    }
  });

  it('write: viewer blocked', () => {
    expect(isRoleAllowed('owner', 'write')).toBe(true);
    expect(isRoleAllowed('admin', 'write')).toBe(true);
    expect(isRoleAllowed('member', 'write')).toBe(true);
    expect(isRoleAllowed('viewer', 'write')).toBe(false);
  });

  it('manage: member and viewer blocked', () => {
    expect(isRoleAllowed('owner', 'manage')).toBe(true);
    expect(isRoleAllowed('admin', 'manage')).toBe(true);
    expect(isRoleAllowed('member', 'manage')).toBe(false);
    expect(isRoleAllowed('viewer', 'manage')).toBe(false);
  });

  it('billing: only owner', () => {
    expect(isRoleAllowed('owner', 'billing')).toBe(true);
    expect(isRoleAllowed('admin', 'billing')).toBe(false);
    expect(isRoleAllowed('member', 'billing')).toBe(false);
    expect(isRoleAllowed('viewer', 'billing')).toBe(false);
  });
});

describe('S-2.5: requireRole middleware', () => {
  const makeReq = (role: Role): RbacRequest => ({
    orgId: 'org-1',
    userId: 'user-1',
    role,
    path: '/test',
  });

  // 4 roles × 4 categories = 16 tests
  const categories: ActionCategory[] = ['read', 'write', 'manage', 'billing'];
  const roles: Role[] = ['owner', 'admin', 'member', 'viewer'];

  for (const category of categories) {
    for (const role of roles) {
      const allowed = (PERMISSION_MATRIX[category] as readonly string[]).includes(role);
      it(`${role} ${allowed ? 'CAN' : 'CANNOT'} perform ${category}`, async () => {
        const check = requireActionCategory(category);
        const result = await check(makeReq(role));
        expect(result.allowed).toBe(allowed);
        if (!allowed) {
          expect(result.statusCode).toBe(403);
          expect(result.error).toContain('Insufficient permissions');
        }
      });
    }
  }
});

describe('S-2.5: requireRole with explicit roles', () => {
  it('allows listed roles only', async () => {
    const check = requireRole(['owner', 'admin']);
    expect((await check({ orgId: 'o', userId: 'u', role: 'owner' })).allowed).toBe(true);
    expect((await check({ orgId: 'o', userId: 'u', role: 'admin' })).allowed).toBe(true);
    expect((await check({ orgId: 'o', userId: 'u', role: 'member' })).allowed).toBe(false);
    expect((await check({ orgId: 'o', userId: 'u', role: 'viewer' })).allowed).toBe(false);
  });
});

describe('S-2.5: categorizeAction', () => {
  it('billing routes', () => {
    expect(categorizeAction('billing')).toBe('billing');
    expect(categorizeAction('invoice')).toBe('billing');
    expect(categorizeAction('upgrade')).toBe('billing');
    expect(categorizeAction('org.delete')).toBe('billing');
    expect(categorizeAction('transfer.ownership')).toBe('billing');
  });

  it('manage routes', () => {
    expect(categorizeAction('api_key')).toBe('manage');
    expect(categorizeAction('member')).toBe('manage');
    expect(categorizeAction('invitation')).toBe('manage');
    expect(categorizeAction('settings')).toBe('manage');
    expect(categorizeAction('audit')).toBe('manage');
    expect(categorizeAction('export')).toBe('manage');
  });

  it('write routes', () => {
    expect(categorizeAction('create')).toBe('write');
    expect(categorizeAction('update')).toBe('write');
  });

  it('defaults to read', () => {
    expect(categorizeAction('dashboard')).toBe('read');
    expect(categorizeAction('view')).toBe('read');
  });
});

// ═══════════════════════════════════════════
// S-2.5 + S-2.6: Integration Tests (require Postgres)
// ═══════════════════════════════════════════

let pg: typeof import('pg') | null = null;
let pool: InstanceType<typeof import('pg').Pool> | null = null;
let pgAvailable = false;

async function tryConnectPg() {
  try {
    pg = await import('pg');
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return false;
    pool = new pg.Pool({ connectionString: dbUrl, max: 5 });
    const res = await pool.query('SELECT 1 as ok');
    return res.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}

async function resetDatabase() {
  if (!pool) return;
  await pool.query(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;
  `);
}

describe('Integration: S-2.6 Audit Log', () => {
  let auditLog: AuditLogService;
  let orgId: string;

  beforeAll(async () => {
    pgAvailable = await tryConnectPg();
    if (pgAvailable && pool) {
      await resetDatabase();
      await runMigrations(pool, MIGRATIONS_DIR);

      // Create test org
      const orgResult = await pool.query(
        `INSERT INTO orgs (name, slug) VALUES ('Test Org', 'test-org') RETURNING id`,
      );
      orgId = (orgResult.rows as any[])[0].id;

      auditLog = new AuditLogService(pool);
    }
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  // S-2.6: Audit log writes
  it.skipIf(!pgAvailable)('writes an audit entry', async () => {
    const entry = await auditLog.write({
      org_id: orgId,
      actor_type: 'user',
      actor_id: 'user-123',
      action: 'auth.login',
      resource_type: 'session',
      result: 'success',
    });
    expect(entry.id).toBeDefined();
    expect(entry.action).toBe('auth.login');
    expect(entry.result).toBe('success');
  });

  it.skipIf(!pgAvailable)('writes entry with all fields', async () => {
    const entry = await auditLog.write({
      org_id: orgId,
      actor_type: 'user',
      actor_id: 'user-456',
      action: 'api_key.created',
      resource_type: 'api_key',
      resource_id: 'key-789',
      details: { name: 'My Key', environment: 'production' },
      ip_address: '192.168.1.1',
      result: 'success',
    });
    expect(entry.resource_id).toBe('key-789');
    expect(entry.ip_address).toBe('192.168.1.1');
    expect(entry.details).toEqual({ name: 'My Key', environment: 'production' });
  });

  it.skipIf(!pgAvailable)('writes failure entries', async () => {
    const entry = await auditLog.write({
      org_id: orgId,
      actor_type: 'user',
      actor_id: 'user-bad',
      action: 'auth.login_failed',
      resource_type: 'session',
      ip_address: '10.0.0.1',
      result: 'failure',
    });
    expect(entry.result).toBe('failure');
  });

  // S-2.6: Query with filters
  it.skipIf(!pgAvailable)('queries entries by org', async () => {
    const result = await auditLog.query({ org_id: orgId });
    expect(result.entries.length).toBeGreaterThanOrEqual(3);
    expect(result.total).toBeGreaterThanOrEqual(3);
  });

  it.skipIf(!pgAvailable)('filters by action', async () => {
    const result = await auditLog.query({ org_id: orgId, action: 'auth.login' });
    expect(result.entries.every((e) => e.action === 'auth.login')).toBe(true);
  });

  it.skipIf(!pgAvailable)('filters by actor', async () => {
    const result = await auditLog.query({ org_id: orgId, actor_id: 'user-456' });
    expect(result.entries.length).toBeGreaterThanOrEqual(1);
    expect(result.entries.every((e) => e.actor_id === 'user-456')).toBe(true);
  });

  it.skipIf(!pgAvailable)('filters by time range', async () => {
    const from = new Date(Date.now() - 60000); // 1 min ago
    const to = new Date(Date.now() + 60000); // 1 min from now
    const result = await auditLog.query({ org_id: orgId, from, to });
    expect(result.entries.length).toBeGreaterThanOrEqual(1);
  });

  it.skipIf(!pgAvailable)('paginates results', async () => {
    const page1 = await auditLog.query({ org_id: orgId, limit: 1, offset: 0 });
    const page2 = await auditLog.query({ org_id: orgId, limit: 1, offset: 1 });
    expect(page1.entries.length).toBe(1);
    expect(page2.entries.length).toBe(1);
    expect(page1.entries[0].id).not.toBe(page2.entries[0].id);
  });

  // S-2.6: Export
  it.skipIf(!pgAvailable)('exports all entries as JSON', async () => {
    const entries = await auditLog.export(orgId);
    expect(entries.length).toBeGreaterThanOrEqual(3);
    // Ordered by created_at ASC
    const timestamps = entries.map((e) => new Date(e.created_at).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  // S-2.5 + S-2.6: RBAC logs denial to audit log
  it.skipIf(!pgAvailable)('RBAC denial is logged to audit log', async () => {
    const check = requireRole(['owner'], auditLog);
    const result = await check({
      orgId,
      userId: 'user-viewer',
      role: 'viewer',
      path: '/api/v1/org/billing',
      ip: '10.0.0.99',
    });
    expect(result.allowed).toBe(false);

    // Verify it was logged
    const logs = await auditLog.query({
      org_id: orgId,
      action: 'permission.denied',
      actor_id: 'user-viewer',
    });
    expect(logs.entries.length).toBeGreaterThanOrEqual(1);
    const denial = logs.entries[0];
    expect(denial.details).toEqual({
      role: 'viewer',
      required_roles: ['owner'],
    });
    expect(denial.resource_id).toBe('/api/v1/org/billing');
  });
});
