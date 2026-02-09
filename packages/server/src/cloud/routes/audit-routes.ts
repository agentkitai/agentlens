/**
 * Audit Log Routes (S-7.6)
 *
 * Express-compatible route handlers for audit log page:
 * - Query with filters (action, actor, time range)
 * - Paginated results
 * - Export to JSON
 */

import type { AuditLogService, AuditAction } from '../auth/audit-log.js';

export interface AuditRoutesDeps {
  auditLog: AuditLogService;
}

export function createAuditRouteHandlers(deps: AuditRoutesDeps) {
  return {
    /** GET /api/cloud/orgs/:orgId/audit-log?action=&actor=&from=&to=&limit=&offset= */
    async queryAuditLog(
      orgId: string,
      query: {
        action?: string;
        actor?: string;
        from?: string;
        to?: string;
        limit?: string;
        offset?: string;
      },
    ): Promise<{ status: number; body: unknown }> {
      const filters: Parameters<AuditLogService['query']>[0] = {
        org_id: orgId,
        action: query.action as AuditAction | undefined,
        actor_id: query.actor,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        limit: query.limit ? parseInt(query.limit, 10) : 50,
        offset: query.offset ? parseInt(query.offset, 10) : 0,
      };

      const result = await deps.auditLog.query(filters);
      return {
        status: 200,
        body: {
          entries: result.entries,
          total: result.total,
          limit: filters.limit,
          offset: filters.offset,
        },
      };
    },

    /** GET /api/cloud/orgs/:orgId/audit-log/export?from=&to= */
    async exportAuditLog(
      orgId: string,
      query: { from?: string; to?: string },
    ): Promise<{ status: number; body: unknown; headers?: Record<string, string> }> {
      const entries = await deps.auditLog.export(
        orgId,
        query.from ? new Date(query.from) : undefined,
        query.to ? new Date(query.to) : undefined,
      );
      return {
        status: 200,
        body: entries,
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="audit-log-${orgId}.json"`,
        },
      };
    },
  };
}
