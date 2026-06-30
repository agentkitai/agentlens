/**
 * resolveProjectScope (#228) — project selection + membership gate + org resolution.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type SqliteDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { OrgProjectStore } from '../../db/org-project-store.js';
import { resolveProjectScope } from '../resolve-project-scope.js';

interface MockAuth {
  type: 'api-key' | 'jwt';
  userId: string | null;
  projectId: string;
  orgId: string;
  role: string;
  scopes: string[];
  keyId: string | null;
}

function mockCtx(auth: MockAuth | undefined, header?: string) {
  let status = 0;
  const c = {
    get: (k: string) => (k === 'auth' ? auth : undefined),
    req: {
      header: (h: string) => (h === 'X-Project-Id' ? header : undefined),
      param: (_p: string) => undefined,
    },
    json: (_b: unknown, s: number) => {
      status = s;
      return { status };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { c: c as any, getStatus: () => status };
}

describe('resolveProjectScope (#228)', () => {
  let db: SqliteDb;
  let orgId: string;
  let projA: string;
  let projB: string;

  beforeEach(async () => {
    db = createTestDb();
    runMigrations(db);
    const store = new OrgProjectStore(db);
    orgId = (await store.createOrg({ name: 'Acme' })).id;
    projA = (await store.createProject(orgId, { name: 'support' })).id;
    projB = (await store.createProject(orgId, { name: 'sales' })).id;
    await store.addProjectMember(projA, 'alice', 'member');
  });

  const jwtAuth = (): MockAuth => ({ type: 'jwt', userId: 'alice', projectId: orgId, orgId, role: 'viewer', scopes: ['*'], keyId: null });

  it('JWT: selecting a member project sets projectId + the effective role + real org', async () => {
    const auth = jwtAuth();
    const { c } = mockCtx(auth, projA);
    let nexted = false;
    await resolveProjectScope(db)(c, async () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(auth.projectId).toBe(projA);
    expect(auth.orgId).toBe(orgId);
    expect(auth.role).toBe('member');
  });

  it('JWT: selecting a NON-member project → 403, scope unchanged', async () => {
    const auth = jwtAuth();
    const { c, getStatus } = mockCtx(auth, projB);
    let nexted = false;
    await resolveProjectScope(db)(c, async () => { nexted = true; });
    expect(getStatus()).toBe(403);
    expect(nexted).toBe(false);
    expect(auth.projectId).toBe(orgId);
  });

  it('api-key: resolves the bound project\'s real org (no membership check)', async () => {
    const auth: MockAuth = { type: 'api-key', userId: null, projectId: projA, orgId: projA, role: 'admin', scopes: ['*'], keyId: 'k' };
    const { c } = mockCtx(auth);
    let nexted = false;
    await resolveProjectScope(db)(c, async () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(auth.orgId).toBe(orgId);
  });

  it('passes through with no auth context', async () => {
    const { c } = mockCtx(undefined);
    let nexted = false;
    await resolveProjectScope(db)(c, async () => { nexted = true; });
    expect(nexted).toBe(true);
  });
});
