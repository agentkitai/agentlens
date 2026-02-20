/**
 * RBAC Middleware (S-2.5)
 *
 * Role-based access control for dashboard API routes.
 * Permission matrix:
 *   Owner  = all actions
 *   Admin  = all except billing, org deletion, ownership transfer
 *   Member = read dashboard, create sessions/benchmarks (no API keys, team mgmt, billing, settings)
 *   Viewer = read-only dashboard data
 */

import type { AuditLogService } from './audit-log.js';

export type Role = 'owner' | 'admin' | 'auditor' | 'member' | 'viewer';

export type ActionCategory =
  | 'read'           // View dashboard data
  | 'write'          // Create/configure sessions, benchmarks
  | 'manage'         // API keys, team members, settings, data export, audit log
  | 'billing';       // Billing, org deletion, ownership transfer

/**
 * Permission matrix: which roles can perform which action categories.
 */
export const PERMISSION_MATRIX: Record<ActionCategory, readonly Role[]> = {
  read:    ['owner', 'admin', 'auditor', 'member', 'viewer'],
  write:   ['owner', 'admin', 'member'],
  manage:  ['owner', 'admin', 'auditor'],
  billing: ['owner'],
} as const;

/**
 * Map a route/action description to an action category.
 * Used internally and exposed for testing.
 */
export function categorizeAction(action: string): ActionCategory {
  // Billing and destructive org ops
  if (/billing|invoice|upgrade|downgrade|portal/.test(action)) return 'billing';
  if (/org.*delete|delete.*org|org.*transfer|transfer.*ownership/.test(action)) return 'billing';

  // Management actions
  if (/api[_-]?key|member|invitation|invite|settings|audit|export|import|role/.test(action)) return 'manage';

  // Write actions
  if (/create|update|patch|post|put|configure/.test(action)) return 'write';

  // Default: read
  return 'read';
}

export interface RbacRequest {
  orgId: string;
  userId: string;
  role: Role;
  path?: string;
  ip?: string;
}

export interface RbacResult {
  allowed: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * Check if a role is allowed to perform an action category.
 */
export function isRoleAllowed(role: Role, category: ActionCategory): boolean {
  return (PERMISSION_MATRIX[category] as readonly string[]).includes(role);
}

/**
 * Create a requireRole middleware function.
 *
 * @param allowedRoles - Roles that are permitted for this route
 * @param auditLog - Optional audit log service to log denials
 * @returns Middleware-style check function
 */
export function requireRole(
  allowedRoles: Role[],
  auditLog?: AuditLogService,
): (req: RbacRequest) => Promise<RbacResult> {
  return async (req: RbacRequest): Promise<RbacResult> => {
    if (allowedRoles.includes(req.role)) {
      return { allowed: true };
    }

    // Log permission denied to audit log
    if (auditLog) {
      try {
        await auditLog.write({
          org_id: req.orgId,
          actor_type: 'user',
          actor_id: req.userId,
          action: 'permission.denied',
          resource_type: 'route',
          resource_id: req.path ?? null,
          details: { role: req.role, required_roles: allowedRoles },
          ip_address: req.ip ?? null,
          result: 'failure',
        });
      } catch {
        // Don't fail the request if audit logging fails
      }
    }

    return {
      allowed: false,
      statusCode: 403,
      error: 'Insufficient permissions',
    };
  };
}

/**
 * Convenience: create a requireRole check by action category.
 */
export function requireActionCategory(
  category: ActionCategory,
  auditLog?: AuditLogService,
): (req: RbacRequest) => Promise<RbacResult> {
  return requireRole([...PERMISSION_MATRIX[category]], auditLog);
}
