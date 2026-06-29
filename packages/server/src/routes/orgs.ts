/**
 * Orgs / projects / members API (#147, sub-PR 1) — manage-guarded.
 *
 * Read + create over the new hierarchy. Data scoping still runs on `tenant_id`
 * (TenantScopedStore moves to (org_id, project_id) in the next sub-PR), so these
 * routes manage the structure without yet repartitioning event data.
 */
import { Hono } from 'hono';
import type { SqliteDb } from '../db/index.js';
import type { AuthVariables } from '../middleware/auth.js';
import { OrgProjectStore } from '../db/org-project-store.js';

export function orgRoutes(db: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const store = new OrgProjectStore(db);

  app.get('/', (c) => c.json({ orgs: store.listOrgs() }));

  app.post('/', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { name?: string; slug?: string; plan?: string };
    if (!b.name?.trim()) return c.json({ error: 'name is required' }, 400);
    return c.json({ org: store.createOrg({ name: b.name.trim(), slug: b.slug, plan: b.plan }) }, 201);
  });

  app.get('/:id', (c) => {
    const org = store.getOrg(c.req.param('id'));
    if (!org) return c.json({ error: 'Org not found' }, 404);
    return c.json({ org, projects: store.listProjects(org.id), members: store.listOrgMembers(org.id) });
  });

  app.get('/:id/projects', (c) => c.json({ projects: store.listProjects(c.req.param('id')) }));

  app.post('/:id/projects', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { name?: string; slug?: string };
    if (!b.name?.trim()) return c.json({ error: 'name is required' }, 400);
    if (!store.getOrg(c.req.param('id'))) return c.json({ error: 'Org not found' }, 404);
    return c.json({ project: store.createProject(c.req.param('id'), { name: b.name.trim(), slug: b.slug }) }, 201);
  });

  app.get('/:id/members', (c) => c.json({ members: store.listOrgMembers(c.req.param('id')) }));

  app.post('/:id/members', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { userId?: string; role?: string; invitedBy?: string };
    if (!b.userId || !b.role) return c.json({ error: 'userId and role are required' }, 400);
    return c.json({ member: store.addOrgMember(c.req.param('id'), b.userId, b.role, b.invitedBy) }, 201);
  });

  return app;
}
