/**
 * org→project scoping columns on events (#147 cutover, additive step):
 * events are stamped with org_id/project_id; isolation still holds via tenant_id.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createEvent } from '@agentkitai/agentlens-core';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { SqliteEventStore } from '../sqlite-store.js';
import { TenantScopedStore } from '../tenant-scoped-store.js';

let db: SqliteDb;
let store: SqliteEventStore;

beforeEach(() => {
  db = createTestDb();
  runMigrations(db);
  store = new SqliteEventStore(db);
});

describe('org/project scoping (#147)', () => {
  it('stamps org_id + project_id (= tenant_id) on inserted events', async () => {
    const e = createEvent({ sessionId: 's1', agentId: 'a', tenantId: 'acme', prevHash: null, eventType: 'custom', payload: { type: 'x', data: {} } as never, metadata: {} });
    await store.insertEvents([e]);
    const row = db.get<{ org_id: string; project_id: string; tenant_id: string }>(sql`SELECT org_id, project_id, tenant_id FROM events WHERE id = ${e.id}`);
    expect(row).toMatchObject({ org_id: 'default', project_id: 'acme', tenant_id: 'acme' });
  });

  it('TenantScopedStore exposes (orgId, projectId); projectId defaults to tenantId', () => {
    const scoped = new TenantScopedStore(store, 'acme');
    expect(scoped.orgId).toBe('default');
    expect(scoped.projectId).toBe('acme');
    const explicit = new TenantScopedStore(store, 'acme', { orgId: 'org_1', projectId: 'proj_9' });
    expect(explicit.orgId).toBe('org_1');
    expect(explicit.projectId).toBe('proj_9');
  });

  it('stamps org_id + project_id on the sessions + agents projections too (#147)', async () => {
    const e = createEvent({ sessionId: 'sess9', agentId: 'agent9', tenantId: 'acme', prevHash: null, eventType: 'session_started', payload: { agentName: 'A' } as never, metadata: {} });
    await store.insertEvents([e]);
    const s = db.get<{ org_id: string; project_id: string }>(sql`SELECT org_id, project_id FROM sessions WHERE id = 'sess9'`);
    expect(s).toMatchObject({ org_id: 'default', project_id: 'acme' });
    const a = db.get<{ org_id: string; project_id: string }>(sql`SELECT org_id, project_id FROM agents WHERE id = 'agent9' AND tenant_id = 'acme'`);
    expect(a).toMatchObject({ org_id: 'default', project_id: 'acme' });
  });

  it('keeps cross-tenant (cross-project) isolation', async () => {
    await store.insertEvents([createEvent({ sessionId: 's1', agentId: 'a', tenantId: 't1', prevHash: null, eventType: 'custom', payload: { type: 'x', data: {} } as never, metadata: {} })]);
    const t2 = await store.queryEvents({ tenantId: 't2' });
    expect(t2.events).toHaveLength(0);
  });
});
