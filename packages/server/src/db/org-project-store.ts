/**
 * Org → project → member store (#147, sub-PR 1).
 *
 * Dialect-agnostic (#172): runs on both SQLite and Postgres via the `dialect-db`
 * helpers, so the org hierarchy that the OSS path scopes data by works on either
 * backend. Roles use the unified set (`owner|admin|member|viewer|auditor`).
 */
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { type AnyDb, dbRun, dbAll, dbGet } from './dialect-db.js';

export interface Org {
  id: string;
  name: string;
  slug: string;
  plan: string;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface OrgMember {
  orgId: string;
  userId: string;
  role: string;
  invitedBy?: string;
  joinedAt: string;
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: string;
  joinedAt: string;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'item'
  );
}

interface OrgRow { id: string; name: string; slug: string; plan: string; settings: string; created_at: string; updated_at: string }
interface ProjectRow { id: string; org_id: string; name: string; slug: string; settings: string; created_at: string; updated_at: string }
interface OrgMemberRow { org_id: string; user_id: string; role: string; invited_by: string | null; joined_at: string }
interface ProjectMemberRow { project_id: string; user_id: string; role: string; joined_at: string }

const toOrg = (r: OrgRow): Org => ({ id: r.id, name: r.name, slug: r.slug, plan: r.plan, settings: JSON.parse(r.settings), createdAt: r.created_at, updatedAt: r.updated_at });
const toProject = (r: ProjectRow): Project => ({ id: r.id, orgId: r.org_id, name: r.name, slug: r.slug, settings: JSON.parse(r.settings), createdAt: r.created_at, updatedAt: r.updated_at });
const toOrgMember = (r: OrgMemberRow): OrgMember => ({ orgId: r.org_id, userId: r.user_id, role: r.role, invitedBy: r.invited_by ?? undefined, joinedAt: r.joined_at });
const toProjectMember = (r: ProjectMemberRow): ProjectMember => ({ projectId: r.project_id, userId: r.user_id, role: r.role, joinedAt: r.joined_at });

export class OrgProjectStore {
  constructor(private readonly db: AnyDb) {}

  async createOrg(input: { name: string; slug?: string; plan?: string }): Promise<Org> {
    const now = new Date().toISOString();
    const row: OrgRow = {
      id: `org_${randomUUID()}`,
      name: input.name,
      slug: input.slug ? slugify(input.slug) : slugify(input.name),
      plan: input.plan ?? 'free',
      settings: '{}',
      created_at: now,
      updated_at: now,
    };
    await dbRun(this.db, sql`INSERT INTO orgs (id, name, slug, plan, settings, created_at, updated_at)
      VALUES (${row.id}, ${row.name}, ${row.slug}, ${row.plan}, ${row.settings}, ${row.created_at}, ${row.updated_at})`);
    return toOrg(row);
  }

  async getOrg(id: string): Promise<Org | undefined> {
    const r = await dbGet<OrgRow>(this.db, sql`SELECT * FROM orgs WHERE id = ${id}`);
    return r ? toOrg(r) : undefined;
  }

  async listOrgs(): Promise<Org[]> {
    return (await dbAll<OrgRow>(this.db, sql`SELECT * FROM orgs ORDER BY created_at ASC`)).map(toOrg);
  }

  async createProject(orgId: string, input: { name: string; slug?: string }): Promise<Project> {
    const now = new Date().toISOString();
    const row: ProjectRow = {
      id: `proj_${randomUUID()}`,
      org_id: orgId,
      name: input.name,
      slug: input.slug ? slugify(input.slug) : slugify(input.name),
      settings: '{}',
      created_at: now,
      updated_at: now,
    };
    await dbRun(this.db, sql`INSERT INTO projects (id, org_id, name, slug, settings, created_at, updated_at)
      VALUES (${row.id}, ${row.org_id}, ${row.name}, ${row.slug}, ${row.settings}, ${row.created_at}, ${row.updated_at})`);
    return toProject(row);
  }

  async getProject(id: string): Promise<Project | undefined> {
    const r = await dbGet<ProjectRow>(this.db, sql`SELECT * FROM projects WHERE id = ${id}`);
    return r ? toProject(r) : undefined;
  }

  async listProjects(orgId: string): Promise<Project[]> {
    return (await dbAll<ProjectRow>(this.db, sql`SELECT * FROM projects WHERE org_id = ${orgId} ORDER BY created_at ASC`)).map(toProject);
  }

  async addOrgMember(orgId: string, userId: string, role: string, invitedBy?: string): Promise<OrgMember> {
    const now = new Date().toISOString();
    await dbRun(this.db, sql`INSERT INTO org_members (org_id, user_id, role, invited_by, joined_at)
      VALUES (${orgId}, ${userId}, ${role}, ${invitedBy ?? null}, ${now})
      ON CONFLICT (org_id, user_id) DO UPDATE SET role = excluded.role, invited_by = excluded.invited_by, joined_at = excluded.joined_at`);
    return { orgId, userId, role, invitedBy, joinedAt: now };
  }

  async listOrgMembers(orgId: string): Promise<OrgMember[]> {
    return (await dbAll<OrgMemberRow>(this.db, sql`SELECT * FROM org_members WHERE org_id = ${orgId} ORDER BY joined_at ASC`)).map(toOrgMember);
  }

  async addProjectMember(projectId: string, userId: string, role: string): Promise<ProjectMember> {
    const now = new Date().toISOString();
    await dbRun(this.db, sql`INSERT INTO project_members (project_id, user_id, role, joined_at)
      VALUES (${projectId}, ${userId}, ${role}, ${now})
      ON CONFLICT (project_id, user_id) DO UPDATE SET role = excluded.role, joined_at = excluded.joined_at`);
    return { projectId, userId, role, joinedAt: now };
  }

  async listProjectMembers(projectId: string): Promise<ProjectMember[]> {
    return (await dbAll<ProjectMemberRow>(this.db, sql`SELECT * FROM project_members WHERE project_id = ${projectId} ORDER BY joined_at ASC`)).map(toProjectMember);
  }

  // ─── User-centric membership (#147) — a user may belong to many orgs/projects ──

  /** Orgs the user is a member of, with their org-level role. */
  async listUserOrgs(userId: string): Promise<Array<{ org: Org; role: string }>> {
    const rows = await dbAll<OrgRow & { member_role: string }>(this.db, sql`
      SELECT o.id, o.name, o.slug, o.plan, o.settings, o.created_at, o.updated_at, m.role as member_role
      FROM org_members m JOIN orgs o ON o.id = m.org_id
      WHERE m.user_id = ${userId}
      ORDER BY m.joined_at ASC`);
    return rows.map((r) => ({ org: toOrg(r), role: r.member_role }));
  }

  /** A user's org-level role for an org, or null if they are not a member. */
  async getOrgRole(orgId: string, userId: string): Promise<string | null> {
    const row = await dbGet<{ role: string }>(this.db, sql`
      SELECT role FROM org_members WHERE org_id = ${orgId} AND user_id = ${userId}`);
    return row?.role ?? null;
  }

  /**
   * Effective role for a user on a project: the per-project override wins, else
   * the user's org-level role for the project's org, else null (no access).
   */
  async getEffectiveRole(projectId: string, userId: string): Promise<string | null> {
    const proj = await dbGet<{ org_id: string }>(this.db, sql`SELECT org_id FROM projects WHERE id = ${projectId}`);
    if (!proj) return null;
    const override = await dbGet<{ role: string }>(this.db, sql`
      SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId}`);
    if (override) return override.role;
    return this.getOrgRole(proj.org_id, userId);
  }

  /** Projects the user can access (a direct project membership, or via their org). */
  async listUserProjects(userId: string): Promise<Array<{ project: Project; role: string }>> {
    const rows = await dbAll<ProjectRow>(this.db, sql`
      SELECT DISTINCT p.id, p.org_id, p.name, p.slug, p.settings, p.created_at, p.updated_at
      FROM projects p
      WHERE p.org_id IN (SELECT org_id FROM org_members WHERE user_id = ${userId})
         OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ${userId})
      ORDER BY p.created_at ASC`);
    const out: Array<{ project: Project; role: string }> = [];
    for (const r of rows) {
      const role = await this.getEffectiveRole(r.id, userId);
      if (role) out.push({ project: toProject(r), role });
    }
    return out;
  }
}
