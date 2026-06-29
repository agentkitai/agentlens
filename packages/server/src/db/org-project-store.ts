/**
 * Org → project → member store (#147, sub-PR 1).
 *
 * The SQLite-backed hierarchy that the OSS path will scope data by once
 * `TenantScopedStore` moves to `(org_id, project_id)` in the next sub-PR. Roles
 * use the cloud set for now (`owner|admin|member|viewer`); `auditor` is folded in
 * by the role-unification sub-PR.
 */
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { SqliteDb } from './index.js';

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
  constructor(private readonly db: SqliteDb) {}

  createOrg(input: { name: string; slug?: string; plan?: string }): Org {
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
    this.db.run(sql`INSERT INTO orgs (id, name, slug, plan, settings, created_at, updated_at)
      VALUES (${row.id}, ${row.name}, ${row.slug}, ${row.plan}, ${row.settings}, ${row.created_at}, ${row.updated_at})`);
    return toOrg(row);
  }

  getOrg(id: string): Org | undefined {
    const r = this.db.get<OrgRow>(sql`SELECT * FROM orgs WHERE id = ${id}`);
    return r ? toOrg(r) : undefined;
  }

  listOrgs(): Org[] {
    return this.db.all<OrgRow>(sql`SELECT * FROM orgs ORDER BY created_at ASC`).map(toOrg);
  }

  createProject(orgId: string, input: { name: string; slug?: string }): Project {
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
    this.db.run(sql`INSERT INTO projects (id, org_id, name, slug, settings, created_at, updated_at)
      VALUES (${row.id}, ${row.org_id}, ${row.name}, ${row.slug}, ${row.settings}, ${row.created_at}, ${row.updated_at})`);
    return toProject(row);
  }

  getProject(id: string): Project | undefined {
    const r = this.db.get<ProjectRow>(sql`SELECT * FROM projects WHERE id = ${id}`);
    return r ? toProject(r) : undefined;
  }

  listProjects(orgId: string): Project[] {
    return this.db.all<ProjectRow>(sql`SELECT * FROM projects WHERE org_id = ${orgId} ORDER BY created_at ASC`).map(toProject);
  }

  addOrgMember(orgId: string, userId: string, role: string, invitedBy?: string): OrgMember {
    const now = new Date().toISOString();
    this.db.run(sql`INSERT OR REPLACE INTO org_members (org_id, user_id, role, invited_by, joined_at)
      VALUES (${orgId}, ${userId}, ${role}, ${invitedBy ?? null}, ${now})`);
    return { orgId, userId, role, invitedBy, joinedAt: now };
  }

  listOrgMembers(orgId: string): OrgMember[] {
    return this.db.all<OrgMemberRow>(sql`SELECT * FROM org_members WHERE org_id = ${orgId} ORDER BY joined_at ASC`).map(toOrgMember);
  }

  addProjectMember(projectId: string, userId: string, role: string): ProjectMember {
    const now = new Date().toISOString();
    this.db.run(sql`INSERT OR REPLACE INTO project_members (project_id, user_id, role, joined_at)
      VALUES (${projectId}, ${userId}, ${role}, ${now})`);
    return { projectId, userId, role, joinedAt: now };
  }

  listProjectMembers(projectId: string): ProjectMember[] {
    return this.db.all<ProjectMemberRow>(sql`SELECT * FROM project_members WHERE project_id = ${projectId} ORDER BY joined_at ASC`).map(toProjectMember);
  }
}
