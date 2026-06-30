/**
 * Orgs / projects / members API (#147) — manage-guarded.
 *
 * Read + create over the org→project→member hierarchy. Every mutation writes an
 * append-only audit-log entry. Data scoping runs on tenant_id (== project_id);
 * events carry org_id/project_id (see the cutover) for future (org, project) reads.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AnyDb } from '../db/dialect-db.js';
import type { AuthVariables } from '../middleware/auth.js';
import type { AuditVariables } from '../middleware/audit.js';
import { getTenantId } from './tenant-helper.js';
import { OrgProjectStore } from '../db/org-project-store.js';

type OrgVars = { Variables: AuthVariables & AuditVariables };

/** Append-only audit-log entry for an org/project/member mutation (#147). */
function auditOrgMutation(c: Context<OrgVars>, action: string, resourceType: string, resourceId: string, details?: Record<string, unknown>): void {
  c.get('audit')?.log({
    tenantId: getTenantId(c),
    actorType: 'api_key',
    actorId: c.get('apiKey')?.id ?? 'unknown',
    action,
    resourceType,
    resourceId,
    ...(details ? { details } : {}),
  });
}

export function orgRoutes(db: AnyDb) {
  const app = new Hono<OrgVars>();
  const store = new OrgProjectStore(db);

  app.get('/', async (c) => c.json({ orgs: await store.listOrgs() }));

  app.post('/', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { name?: string; slug?: string; plan?: string };
    if (!b.name?.trim()) return c.json({ error: 'name is required' }, 400);
    const org = await store.createOrg({ name: b.name.trim(), slug: b.slug, plan: b.plan });
    auditOrgMutation(c, 'org_created', 'org', org.id, { name: org.name, slug: org.slug });
    return c.json({ org }, 201);
  });

  app.get('/:id', async (c) => {
    const org = await store.getOrg(c.req.param('id'));
    if (!org) return c.json({ error: 'Org not found' }, 404);
    const [projects, members] = await Promise.all([store.listProjects(org.id), store.listOrgMembers(org.id)]);
    return c.json({ org, projects, members });
  });

  app.get('/:id/projects', async (c) => c.json({ projects: await store.listProjects(c.req.param('id')) }));

  app.post('/:id/projects', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { name?: string; slug?: string };
    if (!b.name?.trim()) return c.json({ error: 'name is required' }, 400);
    if (!(await store.getOrg(c.req.param('id')))) return c.json({ error: 'Org not found' }, 404);
    const project = await store.createProject(c.req.param('id'), { name: b.name.trim(), slug: b.slug });
    auditOrgMutation(c, 'project_created', 'project', project.id, { orgId: project.orgId, name: project.name });
    return c.json({ project }, 201);
  });

  app.get('/:id/members', async (c) => c.json({ members: await store.listOrgMembers(c.req.param('id')) }));

  app.post('/:id/members', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { userId?: string; role?: string; invitedBy?: string };
    if (!b.userId || !b.role) return c.json({ error: 'userId and role are required' }, 400);
    const member = await store.addOrgMember(c.req.param('id'), b.userId, b.role, b.invitedBy);
    auditOrgMutation(c, 'member_added', 'org_member', `${member.orgId}:${member.userId}`, { role: member.role });
    return c.json({ member }, 201);
  });

  return app;
}
