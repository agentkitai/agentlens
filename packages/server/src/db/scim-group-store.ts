/**
 * SCIM 2.0 group store (#148) — dialect-agnostic CRUD over scim_groups +
 * scim_group_members. Runs on both SQLite and Postgres via the dialect-db helpers.
 */
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { type AnyDb, dbRun, dbAll, dbGet, dbRunCount } from './dialect-db.js';

export interface ScimGroup {
  id: string;
  tenantId: string;
  displayName: string;
  externalId?: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface GroupRow {
  id: string;
  tenant_id: string;
  display_name: string;
  external_id: string | null;
  created_at: string;
  updated_at: string;
}

export class ScimGroupStore {
  constructor(private readonly db: AnyDb) {}

  private async withMembers(row: GroupRow): Promise<ScimGroup> {
    const members = await dbAll<{ user_id: string }>(this.db, sql`SELECT user_id FROM scim_group_members WHERE group_id = ${row.id} ORDER BY user_id ASC`);
    return {
      id: row.id,
      tenantId: row.tenant_id,
      displayName: row.display_name,
      externalId: row.external_id ?? undefined,
      memberIds: members.map((m) => m.user_id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async create(input: { tenantId?: string; displayName: string; externalId?: string; memberIds?: string[] }): Promise<ScimGroup> {
    const id = `grp_${randomUUID()}`;
    const now = new Date().toISOString();
    await dbRun(this.db, sql`
      INSERT INTO scim_groups (id, tenant_id, display_name, external_id, created_at, updated_at)
      VALUES (${id}, ${input.tenantId ?? 'default'}, ${input.displayName}, ${input.externalId ?? null}, ${now}, ${now})`);
    for (const uid of input.memberIds ?? []) await this.addMember(id, uid);
    return (await this.getById(id))!;
  }

  async getById(id: string): Promise<ScimGroup | undefined> {
    const r = await dbGet<GroupRow>(this.db, sql`SELECT * FROM scim_groups WHERE id = ${id}`);
    return r ? this.withMembers(r) : undefined;
  }

  async list(tenantId: string, opts?: { displayName?: string; limit?: number; offset?: number }): Promise<{ groups: ScimGroup[]; total: number }> {
    const limit = Math.min(opts?.limit ?? 100, 500);
    const offset = opts?.offset ?? 0;
    let where = sql`tenant_id = ${tenantId}`;
    if (opts?.displayName) where = sql`${where} AND display_name = ${opts.displayName}`;
    const rows = await dbAll<GroupRow>(this.db, sql`SELECT * FROM scim_groups WHERE ${where} ORDER BY created_at ASC LIMIT ${limit} OFFSET ${offset}`);
    const totalRow = await dbGet<{ count: number }>(this.db, sql`SELECT COUNT(*) as count FROM scim_groups WHERE ${where}`);
    const groups = await Promise.all(rows.map((r) => this.withMembers(r)));
    return { groups, total: Number(totalRow?.count ?? 0) };
  }

  async update(id: string, patch: { displayName?: string }): Promise<ScimGroup | undefined> {
    if (!(await this.getById(id))) return undefined;
    if (patch.displayName !== undefined) {
      await dbRun(this.db, sql`UPDATE scim_groups SET display_name = ${patch.displayName}, updated_at = ${new Date().toISOString()} WHERE id = ${id}`);
    }
    return this.getById(id);
  }

  async delete(id: string): Promise<boolean> {
    await dbRun(this.db, sql`DELETE FROM scim_group_members WHERE group_id = ${id}`);
    return (await dbRunCount(this.db, sql`DELETE FROM scim_groups WHERE id = ${id}`)) > 0;
  }

  async addMember(groupId: string, userId: string): Promise<void> {
    await dbRun(this.db, sql`
      INSERT INTO scim_group_members (group_id, user_id) VALUES (${groupId}, ${userId})
      ON CONFLICT (group_id, user_id) DO NOTHING`);
    await this.touch(groupId);
  }

  async removeMember(groupId: string, userId: string): Promise<void> {
    await dbRun(this.db, sql`DELETE FROM scim_group_members WHERE group_id = ${groupId} AND user_id = ${userId}`);
    await this.touch(groupId);
  }

  async setMembers(groupId: string, userIds: string[]): Promise<void> {
    await dbRun(this.db, sql`DELETE FROM scim_group_members WHERE group_id = ${groupId}`);
    for (const uid of userIds) {
      await dbRun(this.db, sql`INSERT INTO scim_group_members (group_id, user_id) VALUES (${groupId}, ${uid}) ON CONFLICT (group_id, user_id) DO NOTHING`);
    }
    await this.touch(groupId);
  }

  private async touch(groupId: string): Promise<void> {
    await dbRun(this.db, sql`UPDATE scim_groups SET updated_at = ${new Date().toISOString()} WHERE id = ${groupId}`);
  }
}
