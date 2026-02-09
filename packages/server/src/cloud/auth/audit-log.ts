/**
 * Audit Log Service (S-2.6)
 *
 * Append-only, immutable audit log for security-relevant events.
 * Supports: auth events, API key ops, member management, settings changes,
 * data exports, billing events.
 */

import type { MigrationClient } from '../migrate.js';

export type AuditAction =
  // Auth events
  | 'auth.login'
  | 'auth.logout'
  | 'auth.login_failed'
  | 'auth.password_reset'
  | 'auth.email_verified'
  // API key operations
  | 'api_key.created'
  | 'api_key.revoked'
  // Member management
  | 'member.invited'
  | 'member.removed'
  | 'member.role_changed'
  // Settings
  | 'settings.updated'
  | 'org.deleted'
  | 'org.ownership_transferred'
  // Data
  | 'data.exported'
  | 'data.imported'
  // Billing
  | 'billing.plan_changed'
  | 'billing.payment_failed'
  // RBAC
  | 'permission.denied';

export type ActorType = 'user' | 'api_key' | 'system';
export type AuditResult = 'success' | 'failure';

export interface AuditEntry {
  id: string;
  org_id: string;
  actor_type: ActorType;
  actor_id: string;
  action: AuditAction;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  result: AuditResult;
  created_at: string;
}

export interface WriteAuditEntry {
  org_id: string;
  actor_type: ActorType;
  actor_id: string;
  action: AuditAction;
  resource_type: string;
  resource_id?: string | null;
  details?: Record<string, unknown> | null;
  ip_address?: string | null;
  result: AuditResult;
}

export interface AuditQueryFilters {
  org_id: string;
  action?: AuditAction;
  actor_id?: string;
  resource_type?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export class AuditLogService {
  constructor(private db: MigrationClient) {}

  /**
   * Write an audit log entry. Append-only — no updates or deletes.
   */
  async write(entry: WriteAuditEntry): Promise<AuditEntry> {
    const result = await this.db.query(
      `INSERT INTO audit_log (org_id, actor_type, actor_id, action, resource_type, resource_id, details, ip_address, result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::inet, $9)
       RETURNING *`,
      [
        entry.org_id,
        entry.actor_type,
        entry.actor_id,
        entry.action,
        entry.resource_type,
        entry.resource_id ?? null,
        entry.details ? JSON.stringify(entry.details) : null,
        entry.ip_address ?? null,
        entry.result,
      ],
    );
    return (result.rows as AuditEntry[])[0];
  }

  /**
   * Query audit log with filters. Results ordered by created_at DESC.
   */
  async query(filters: AuditQueryFilters): Promise<{ entries: AuditEntry[]; total: number }> {
    const conditions: string[] = ['org_id = $1'];
    const params: unknown[] = [filters.org_id];
    let paramIdx = 2;

    if (filters.action) {
      conditions.push(`action = $${paramIdx++}`);
      params.push(filters.action);
    }
    if (filters.actor_id) {
      conditions.push(`actor_id = $${paramIdx++}`);
      params.push(filters.actor_id);
    }
    if (filters.resource_type) {
      conditions.push(`resource_type = $${paramIdx++}`);
      params.push(filters.resource_type);
    }
    if (filters.from) {
      conditions.push(`created_at >= $${paramIdx++}`);
      params.push(filters.from.toISOString());
    }
    if (filters.to) {
      conditions.push(`created_at <= $${paramIdx++}`);
      params.push(filters.to.toISOString());
    }

    const where = conditions.join(' AND ');
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const [dataResult, countResult] = await Promise.all([
      this.db.query(
        `SELECT * FROM audit_log WHERE ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        [...params, limit, offset],
      ),
      this.db.query(
        `SELECT COUNT(*)::int as total FROM audit_log WHERE ${where}`,
        params,
      ),
    ]);

    return {
      entries: dataResult.rows as AuditEntry[],
      total: (countResult.rows as any[])[0].total,
    };
  }

  /**
   * Export all audit log entries for an org within a time range.
   * Returns JSON array (for download).
   */
  async export(org_id: string, from?: Date, to?: Date): Promise<AuditEntry[]> {
    const conditions: string[] = ['org_id = $1'];
    const params: unknown[] = [org_id];
    let paramIdx = 2;

    if (from) {
      conditions.push(`created_at >= $${paramIdx++}`);
      params.push(from.toISOString());
    }
    if (to) {
      conditions.push(`created_at <= $${paramIdx++}`);
      params.push(to.toISOString());
    }

    const where = conditions.join(' AND ');
    const result = await this.db.query(
      `SELECT * FROM audit_log WHERE ${where} ORDER BY created_at ASC`,
      params,
    );
    return result.rows as AuditEntry[];
  }
}
