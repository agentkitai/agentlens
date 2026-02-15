/**
 * Audit Logger (SH-2)
 *
 * Fire-and-forget audit log writer. Never blocks the request,
 * catches all errors to stderr.
 */

import { ulid } from 'ulid';
import type { SqliteDb } from '../db/index.js';
import { auditLog } from '../db/schema.sqlite.js';
import { lt } from 'drizzle-orm';

export type ActorType = 'user' | 'api_key' | 'system';

export interface AuditEntry {
  tenantId: string;
  actorType: ActorType;
  actorId: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditLogger {
  log(entry: AuditEntry): void;
}

/**
 * Mask sensitive values — returns first 8 chars + "…" for strings > 8 chars.
 */
export function maskSensitive(value: string): string {
  if (value.length <= 8) return value;
  return value.slice(0, 8) + '…';
}

/**
 * Create an audit logger that writes to the audit_log table.
 * Writes are fire-and-forget — errors go to stderr.
 */
export function createAuditLogger(db: SqliteDb): AuditLogger {
  return {
    log(entry: AuditEntry): void {
      try {
        const id = ulid();
        const timestamp = new Date().toISOString();
        db.insert(auditLog)
          .values({
            id,
            timestamp,
            tenantId: entry.tenantId,
            actorType: entry.actorType,
            actorId: entry.actorId,
            action: entry.action,
            resourceType: entry.resourceType ?? null,
            resourceId: entry.resourceId ?? null,
            details: JSON.stringify(entry.details ?? {}),
            ipAddress: entry.ipAddress ?? null,
            userAgent: entry.userAgent ?? null,
          })
          .run();
      } catch (err) {
        console.error('[AuditLogger] Failed to write audit log:', err);
      }
    },
  };
}

/**
 * Delete audit log entries older than the given number of days.
 * Returns the number of rows deleted.
 */
export function cleanupAuditLogs(db: SqliteDb, retentionDays: number): number {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result = db.delete(auditLog).where(lt(auditLog.timestamp, cutoff)).run();
  return result.changes;
}
