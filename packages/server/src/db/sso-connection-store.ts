/**
 * SSO connection store (#148) — per-org SAML/OIDC connection config, the
 * foundation for SAML, OIDC enterprise connections, and SSO enforcement.
 * Dialect-agnostic (runs on both SQLite and Postgres via the dialect-db helpers).
 * Booleans are INTEGER 0/1 on both dialects (no boolean-bind divergence).
 */
import { sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { type AnyDb, dbRun, dbAll, dbGet, dbRunCount } from './dialect-db.js';

export type SsoConnectionType = 'saml' | 'oidc';

export interface SsoConnection {
  id: string;
  orgId: string;
  type: SsoConnectionType;
  name: string;
  enabled: boolean;
  domain?: string;
  domainVerified: boolean;
  enforced: boolean;
  config: Record<string, unknown>;
  groupRoleMappings: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

interface ConnRow {
  id: string;
  org_id: string;
  type: string;
  name: string;
  enabled: number;
  domain: string | null;
  domain_verified: number;
  enforced: number;
  config: string;
  group_role_mappings: string;
  created_at: string;
  updated_at: string;
}

const toConn = (r: ConnRow): SsoConnection => ({
  id: r.id,
  orgId: r.org_id,
  type: r.type as SsoConnectionType,
  name: r.name,
  enabled: Boolean(r.enabled),
  domain: r.domain ?? undefined,
  domainVerified: Boolean(r.domain_verified),
  enforced: Boolean(r.enforced),
  config: JSON.parse(r.config) as Record<string, unknown>,
  groupRoleMappings: JSON.parse(r.group_role_mappings) as Record<string, string>,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface CreateSsoConnectionInput {
  orgId?: string;
  type: SsoConnectionType;
  name: string;
  enabled?: boolean;
  domain?: string;
  enforced?: boolean;
  config?: Record<string, unknown>;
  groupRoleMappings?: Record<string, string>;
}

export class SsoConnectionStore {
  constructor(private readonly db: AnyDb) {}

  async create(input: CreateSsoConnectionInput): Promise<SsoConnection> {
    const id = `sso_${randomUUID()}`;
    const now = new Date().toISOString();
    await dbRun(this.db, sql`
      INSERT INTO sso_connections (id, org_id, type, name, enabled, domain, domain_verified, enforced, config, group_role_mappings, created_at, updated_at)
      VALUES (
        ${id}, ${input.orgId ?? 'default'}, ${input.type}, ${input.name}, ${input.enabled ? 1 : 0},
        ${input.domain ?? null}, 0, ${input.enforced ? 1 : 0},
        ${JSON.stringify(input.config ?? {})}, ${JSON.stringify(input.groupRoleMappings ?? {})}, ${now}, ${now}
      )`);
    return (await this.getById(id))!;
  }

  async getById(id: string): Promise<SsoConnection | undefined> {
    const r = await dbGet<ConnRow>(this.db, sql`SELECT * FROM sso_connections WHERE id = ${id}`);
    return r ? toConn(r) : undefined;
  }

  async listByOrg(orgId: string): Promise<SsoConnection[]> {
    const rows = await dbAll<ConnRow>(this.db, sql`SELECT * FROM sso_connections WHERE org_id = ${orgId} ORDER BY created_at ASC`);
    return rows.map(toConn);
  }

  /** The enabled, domain-verified connection for an email domain — used by SSO enforcement. */
  async getEnforcedByDomain(domain: string): Promise<SsoConnection | undefined> {
    const r = await dbGet<ConnRow>(this.db, sql`
      SELECT * FROM sso_connections
      WHERE domain = ${domain} AND enabled = 1 AND domain_verified = 1 AND enforced = 1
      ORDER BY created_at ASC`);
    return r ? toConn(r) : undefined;
  }

  async update(id: string, patch: Partial<Omit<SsoConnection, 'id' | 'orgId' | 'createdAt' | 'updatedAt'>>): Promise<SsoConnection | undefined> {
    if (!(await this.getById(id))) return undefined;
    const sets: SQL[] = [sql`updated_at = ${new Date().toISOString()}`];
    if (patch.type !== undefined) sets.push(sql`type = ${patch.type}`);
    if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
    if (patch.enabled !== undefined) sets.push(sql`enabled = ${patch.enabled ? 1 : 0}`);
    if (patch.domain !== undefined) sets.push(sql`domain = ${patch.domain}`);
    if (patch.domainVerified !== undefined) sets.push(sql`domain_verified = ${patch.domainVerified ? 1 : 0}`);
    if (patch.enforced !== undefined) sets.push(sql`enforced = ${patch.enforced ? 1 : 0}`);
    if (patch.config !== undefined) sets.push(sql`config = ${JSON.stringify(patch.config)}`);
    if (patch.groupRoleMappings !== undefined) sets.push(sql`group_role_mappings = ${JSON.stringify(patch.groupRoleMappings)}`);
    await dbRun(this.db, sql`UPDATE sso_connections SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`);
    return this.getById(id);
  }

  async delete(id: string): Promise<boolean> {
    return (await dbRunCount(this.db, sql`DELETE FROM sso_connections WHERE id = ${id}`)) > 0;
  }

  /** Resolve an IdP group list to the highest-privilege mapped role, or null. */
  static roleForGroups(conn: SsoConnection, groups: string[]): string | null {
    for (const g of groups) {
      const role = conn.groupRoleMappings[g];
      if (role) return role;
    }
    return null;
  }
}
