/**
 * Service Token Store (#59) — per-tenant machine-to-machine tokens for /api/internal,
 * replacing the org-wide AGENTGATE_SERVICE_TOKEN. A token authorizes ONLY its own
 * tenant_id. Only the sha256 hash is stored. Timestamps are unix SECONDS.
 *
 * Dialect-agnostic: one store over AnyDb (SqliteDb|PostgresDb) via dialect-db helpers,
 * binding the same SQL on both dialects (mirrors CostBudgetStore / SsoConnectionStore).
 */
import { sql } from 'drizzle-orm';
import { type AnyDb, dbRun, dbAll, dbGet } from './dialect-db.js';

export interface ServiceTokenRow {
  id: string;
  tokenHash: string;
  tenantId: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  rotatedAt: number | null;
  expiresAt: number | null;
  createdBy: string | null;
}

export interface CreateServiceTokenInput {
  id: string;
  tokenHash: string;
  tenantId: string;
  name: string;
  createdAt: number;
  expiresAt?: number | null;
  createdBy?: string | null;
}

function n(v: unknown): number | null {
  return v == null ? null : Number(v);
}

function mapRow(r: Record<string, unknown>): ServiceTokenRow {
  return {
    id: String(r['id']),
    tokenHash: String(r['token_hash']),
    tenantId: String(r['tenant_id']),
    name: String(r['name']),
    createdAt: Number(r['created_at']),
    lastUsedAt: n(r['last_used_at']),
    revokedAt: n(r['revoked_at']),
    rotatedAt: n(r['rotated_at']),
    expiresAt: n(r['expires_at']),
    createdBy: r['created_by'] == null ? null : String(r['created_by']),
  };
}

export class ServiceTokenStore {
  constructor(private readonly db: AnyDb) {}

  async create(input: CreateServiceTokenInput): Promise<void> {
    await dbRun(this.db, sql`
      INSERT INTO service_tokens (id, token_hash, tenant_id, name, created_at, expires_at, created_by)
      VALUES (${input.id}, ${input.tokenHash}, ${input.tenantId}, ${input.name},
              ${input.createdAt}, ${input.expiresAt ?? null}, ${input.createdBy ?? null})
    `);
  }

  /** Active = exists, not revoked, and not past expiry. The auth-check entry point. */
  async findActiveByHash(tokenHash: string, nowSec: number): Promise<ServiceTokenRow | null> {
    const row = await dbGet<Record<string, unknown>>(
      this.db,
      sql`
        SELECT * FROM service_tokens
        WHERE token_hash = ${tokenHash}
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > ${nowSec})
      `,
    );
    return row ? mapRow(row) : null;
  }

  async touchLastUsed(id: string, nowSec: number): Promise<void> {
    await dbRun(this.db, sql`UPDATE service_tokens SET last_used_at = ${nowSec} WHERE id = ${id}`);
  }

  async get(tenantId: string, id: string): Promise<ServiceTokenRow | null> {
    const row = await dbGet<Record<string, unknown>>(
      this.db,
      sql`SELECT * FROM service_tokens WHERE id = ${id} AND tenant_id = ${tenantId}`,
    );
    return row ? mapRow(row) : null;
  }

  /** True if any service token exists at all (used to tell "disabled" from "invalid"). */
  async hasAny(): Promise<boolean> {
    const row = await dbGet<Record<string, unknown>>(this.db, sql`SELECT 1 AS one FROM service_tokens LIMIT 1`);
    return row != null;
  }

  async listByTenant(tenantId: string): Promise<ServiceTokenRow[]> {
    const rows = await dbAll<Record<string, unknown>>(
      this.db,
      sql`SELECT * FROM service_tokens WHERE tenant_id = ${tenantId} ORDER BY created_at DESC`,
    );
    return rows.map(mapRow);
  }

  /** Revoke immediately (tenant-scoped). Returns false if no such token for the tenant. */
  async revoke(tenantId: string, id: string, nowSec: number): Promise<boolean> {
    if (!(await this.get(tenantId, id))) return false;
    await dbRun(
      this.db,
      sql`UPDATE service_tokens SET revoked_at = ${nowSec}
          WHERE id = ${id} AND tenant_id = ${tenantId} AND revoked_at IS NULL`,
    );
    return true;
  }

  /**
   * Mark a token rotated: keep it valid until `expiresAt` (grace), so the old and the
   * freshly-minted replacement overlap until the window closes. Tenant-scoped.
   */
  async markRotated(tenantId: string, id: string, rotatedAt: number, expiresAt: number): Promise<boolean> {
    if (!(await this.get(tenantId, id))) return false;
    await dbRun(
      this.db,
      sql`UPDATE service_tokens SET rotated_at = ${rotatedAt}, expires_at = ${expiresAt}
          WHERE id = ${id} AND tenant_id = ${tenantId}`,
    );
    return true;
  }

  /** Prune rotated tokens whose grace window has closed (best-effort housekeeping). */
  async cleanupExpired(nowSec: number): Promise<void> {
    await dbRun(
      this.db,
      sql`DELETE FROM service_tokens
          WHERE rotated_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at <= ${nowSec}`,
    );
  }
}
