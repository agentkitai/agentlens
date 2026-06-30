/**
 * Project & membership management API (#229) — project members + GET /api/projects.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestApp, authHeaders } from './test-helpers.js';
import { apiKeys } from '../db/schema.sqlite.js';
import { hashApiKey } from '../middleware/auth.js';
import { OrgProjectStore } from '../db/org-project-store.js';
import { signJwt } from '../cloud/auth/jwt.js';
import type { Hono } from 'hono';
import type { SqliteDb } from '../db/index.js';

const JWT_SECRET = 'test-jwt-secret';

function adminKey(db: SqliteDb): string {
  const raw = `als_admin_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  db.insert(apiKeys)
    .values({
      id: `k-${Math.random().toString(36).slice(2)}`,
      keyHash: hashApiKey(raw),
      name: 'admin',
      scopes: JSON.stringify(['*']),
      createdAt: Math.floor(Date.now() / 1000),
      tenantId: 'default',
      role: 'owner',
    })
    .run();
  return raw;
}

describe('Project & membership management API (#229)', () => {
  let app: Hono;
  let db: SqliteDb;
  let admin: string;
  let orgId: string;
  let projId: string;
  let prev: string | undefined;

  beforeEach(async () => {
    prev = process.env['JWT_SECRET'];
    process.env['JWT_SECRET'] = JWT_SECRET;
    const ctx = await createTestApp();
    app = ctx.app;
    db = ctx.db;
    admin = adminKey(db);
    const store = new OrgProjectStore(db);
    orgId = (await store.createOrg({ name: 'Acme' })).id;
    projId = (await store.createProject(orgId, { name: 'support' })).id;
  });

  afterEach(() => {
    process.env['JWT_SECRET'] = prev;
  });

  it('adds and lists project members', async () => {
    const add = await app.request(`/api/orgs/${orgId}/projects/${projId}/members`, {
      method: 'POST',
      headers: authHeaders(admin),
      body: JSON.stringify({ userId: 'alice', role: 'member' }),
    });
    expect(add.status).toBe(201);

    const list = await app.request(`/api/orgs/${orgId}/projects/${projId}/members`, { headers: authHeaders(admin) });
    const body = (await list.json()) as { members: Array<{ userId: string; role: string }> };
    expect(body.members.map((m) => m.userId)).toEqual(['alice']);
    expect(body.members[0]!.role).toBe('member');
  });

  it('404s adding a member to a missing project', async () => {
    const res = await app.request(`/api/orgs/${orgId}/projects/nope/members`, {
      method: 'POST',
      headers: authHeaders(admin),
      body: JSON.stringify({ userId: 'alice', role: 'member' }),
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/projects returns a JWT user\'s accessible projects', async () => {
    await new OrgProjectStore(db).addProjectMember(projId, 'alice', 'member');
    const jwt = signJwt({ sub: 'alice', email: 'a@t.co', name: 'Alice', orgs: [{ org_id: orgId, role: 'member' }] }, JWT_SECRET);
    const res = await app.request('/api/projects', { headers: { Authorization: `Bearer ${jwt}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: Array<{ project: { id: string }; role: string }> };
    expect(body.projects.map((p) => p.project.id)).toContain(projId);
  });
});
