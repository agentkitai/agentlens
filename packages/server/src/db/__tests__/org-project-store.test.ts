/**
 * Org → project → member hierarchy (#147, sub-PR 1): default backfill + store CRUD.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { OrgProjectStore } from '../org-project-store.js';

let db: SqliteDb;
let store: OrgProjectStore;

beforeEach(() => {
  db = createTestDb();
  runMigrations(db);
  store = new OrgProjectStore(db);
});

describe('OrgProjectStore', () => {
  it('backfills a default org + default project', async () => {
    const def = await store.getOrg('default');
    expect(def?.slug).toBe('default');
    expect((await store.getProject('default'))?.orgId).toBe('default');
  });

  it('creates orgs, projects, and members', async () => {
    const org = await store.createOrg({ name: 'Acme Inc' });
    expect(org.slug).toBe('acme-inc');
    expect((await store.listOrgs()).some((o) => o.id === org.id)).toBe(true);

    const proj = await store.createProject(org.id, { name: 'Web App' });
    expect(proj.orgId).toBe(org.id);
    expect((await store.listProjects(org.id)).map((p) => p.id)).toContain(proj.id);

    await store.addOrgMember(org.id, 'user-1', 'owner');
    await store.addOrgMember(org.id, 'user-2', 'viewer');
    const members = await store.listOrgMembers(org.id);
    expect(members).toHaveLength(2);
    expect(members.find((m) => m.userId === 'user-1')?.role).toBe('owner');

    // membership upsert (role change)
    await store.addOrgMember(org.id, 'user-2', 'admin');
    expect((await store.listOrgMembers(org.id)).find((m) => m.userId === 'user-2')?.role).toBe('admin');

    await store.addProjectMember(proj.id, 'user-2', 'admin');
    expect(await store.listProjectMembers(proj.id)).toHaveLength(1);
  });
});
