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
import { hasCategory, type RoleCategory } from '@agentkitai/auth';

// The single role enum now lives in @agentkitai/auth (#147). Re-exported here so
// existing cloud imports keep working; `editor` resolves to `member` via normalizeRole.
export type { Role } from '@agentkitai/auth';
import type { Role } from '@agentkitai/auth';

// ActionCategory IS @agentkitai/auth's RoleCategory — one permission vocabulary
// (read · write · manage · billing · audit). (#147)
export type ActionCategory = RoleCategory;

// Canonical roles, highest privilege first (preserves the matrix row order).
const CANONICAL_ROLES: Role[] = ['owner', 'admin', 'auditor', 'member', 'viewer'];

/**
 * Permission matrix (category → allowed roles), DERIVED from @agentkitai/auth
 * ROLE_CATEGORIES via hasCategory — no duplicated mapping. ROLE_CATEGORIES is the
 * single source of truth for role→permission (#147).
 */
export const PERMISSION_MATRIX: Record<ActionCategory, readonly Role[]> = {
  read: CANONICAL_ROLES.filter((r) => hasCategory(r, 'read')),
  write: CANONICAL_ROLES.filter((r) => hasCategory(r, 'write')),
  manage: CANONICAL_ROLES.filter((r) => hasCategory(r, 'manage')),
  billing: CANONICAL_ROLES.filter((r) => hasCategory(r, 'billing')),
  audit: CANONICAL_ROLES.filter((r) => hasCategory(r, 'audit')),
};

/**
 * Map a route/action description to an action category.
 * Used internally and exposed for testing.
 */
export function categorizeAction(action: string): ActionCategory {
  // Billing and destructive org ops
  if (/billing|invoice|upgrade|downgrade|portal/.test(action)) return 'billing';
  if (/org.*delete|delete.*org|org.*transfer|transfer.*ownership/.test(action)) return 'billing';

  // Audit / compliance / evidence (auditor-accessible, not full manage)
  if (/audit|compliance|evidence|export/.test(action)) return 'audit';

  // Management actions
  if (/api[_-]?key|member|invitation|invite|settings|import|role/.test(action)) return 'manage';

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
  // Delegate to the unified role model (#147) — hasCategory resolves aliases
  // (editor → member) and reads the single ROLE_CATEGORIES source of truth.
  return hasCategory(role, category);
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
