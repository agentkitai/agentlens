/**
 * User store (#148) — dialect-agnostic CRUD over the `users` table, used by SCIM
 * provisioning. Runs on both SQLite and Postgres via the dialect-db helpers. The
 * cloud auth-service stays the pg-only login path; this store shares the same
 * `users` table for provisioning/deprovisioning. Timestamps are unix-epoch ms
 * integers (matching the schema on both dialects).
 */
import { sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { type AnyDb, dbRun, dbAll, dbGet, dbRunCount } from './dialect-db.js';

export interface SsoUser {
  id: string;
  tenantId: string;
  email: string;
  displayName?: string;
  role: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  display_name: string | null;
  role: string;
  created_at: number;
  updated_at: number;
  disabled_at: number | null;
}

const toUser = (r: UserRow): SsoUser => ({
  id: r.id,
  tenantId: r.tenant_id,
  email: r.email,
  displayName: r.display_name ?? undefined,
  role: r.role,
  active: r.disabled_at == null,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

export class UserStore {
  constructor(private readonly db: AnyDb) {}

  async create(input: { tenantId?: string; email: string; displayName?: string; role?: string }): Promise<SsoUser> {
    const id = `usr_${randomUUID()}`;
    const now = Date.now();
    await dbRun(this.db, sql`
      INSERT INTO users (id, tenant_id, email, display_name, role, created_at, updated_at)
      VALUES (${id}, ${input.tenantId ?? 'default'}, ${input.email}, ${input.displayName ?? null}, ${input.role ?? 'viewer'}, ${now}, ${now})`);
    return (await this.getById(id))!;
  }

  async getById(id: string): Promise<SsoUser | undefined> {
    const r = await dbGet<UserRow>(this.db, sql`SELECT * FROM users WHERE id = ${id}`);
    return r ? toUser(r) : undefined;
  }

  async getByEmail(tenantId: string, email: string): Promise<SsoUser | undefined> {
    const r = await dbGet<UserRow>(this.db, sql`SELECT * FROM users WHERE tenant_id = ${tenantId} AND email = ${email}`);
    return r ? toUser(r) : undefined;
  }

  async list(tenantId: string, opts?: { email?: string; limit?: number; offset?: number }): Promise<{ users: SsoUser[]; total: number }> {
    const limit = Math.min(opts?.limit ?? 100, 500);
    const offset = opts?.offset ?? 0;
    let where = sql`tenant_id = ${tenantId}`;
    if (opts?.email) where = sql`${where} AND email = ${opts.email}`;
    const rows = await dbAll<UserRow>(this.db, sql`SELECT * FROM users WHERE ${where} ORDER BY created_at ASC LIMIT ${limit} OFFSET ${offset}`);
    const totalRow = await dbGet<{ count: number }>(this.db, sql`SELECT COUNT(*) as count FROM users WHERE ${where}`);
    return { users: rows.map(toUser), total: Number(totalRow?.count ?? 0) };
  }

  async update(id: string, patch: { displayName?: string | null; role?: string; active?: boolean }): Promise<SsoUser | undefined> {
    const sets: SQL[] = [sql`updated_at = ${Date.now()}`];
    if (patch.displayName !== undefined) sets.push(sql`display_name = ${patch.displayName}`);
    if (patch.role !== undefined) sets.push(sql`role = ${patch.role}`);
    if (patch.active !== undefined) sets.push(sql`disabled_at = ${patch.active ? null : Date.now()}`);
    if (!(await this.getById(id))) return undefined;
    await dbRun(this.db, sql`UPDATE users SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`);
    return this.getById(id);
  }

  async delete(id: string): Promise<boolean> {
    return (await dbRunCount(this.db, sql`DELETE FROM users WHERE id = ${id}`)) > 0;
  }
}
