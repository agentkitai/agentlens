/**
 * RBAC Enforcement Middleware [F2-S2]
 *
 * Hono middleware factories that read c.var.auth.role (set by unified-auth)
 * and enforce permission categories using the existing cloud/auth/rbac.ts module.
 */

import { createMiddleware } from 'hono/factory';
import { isRoleAllowed, PERMISSION_MATRIX, type ActionCategory, type Role } from '../cloud/auth/rbac.js';
import { authRequired, insufficientPermissions } from './auth-errors.js';
import type { UnifiedAuthVariables } from './unified-auth.js';

/**
 * Get the minimum role required for a given action category.
 */
function minRoleForCategory(category: ActionCategory): string {
  const roles = PERMISSION_MATRIX[category];
  // Return the least-privileged role in the list
  const hierarchy: Role[] = ['viewer', 'member', 'admin', 'owner'];
  for (const r of hierarchy) {
    if (roles.includes(r)) return r;
  }
  return 'owner';
}

/**
 * Require a minimum action category for the route.
 * Reads role from c.var.auth.role (set by unified-auth).
 */
export function requireCategory(category: ActionCategory) {
  return createMiddleware<{ Variables: UnifiedAuthVariables }>(async (c, next) => {
    const auth = c.var.auth;
    if (!auth) {
      return authRequired(c);
    }

    if (!isRoleAllowed(auth.role, category)) {
      return insufficientPermissions(c, {
        required: minRoleForCategory(category),
        current: auth.role,
        hint: `This action requires '${minRoleForCategory(category)}' role or higher. Your current role is '${auth.role}'.`,
      });
    }

    return next();
  });
}

/**
 * Auto-categorize by HTTP method.
 * GET/HEAD/OPTIONS → read; all others → write
 */
export function requireMethodCategory() {
  return createMiddleware<{ Variables: UnifiedAuthVariables }>(async (c, next) => {
    const auth = c.var.auth;
    if (!auth) {
      return authRequired(c);
    }

    const method = c.req.method;
    const category: ActionCategory =
      ['GET', 'HEAD', 'OPTIONS'].includes(method) ? 'read' : 'write';

    if (!isRoleAllowed(auth.role, category)) {
      return insufficientPermissions(c, {
        required: minRoleForCategory(category),
        current: auth.role,
        hint: `${method} requires '${minRoleForCategory(category)}' role. Your role is '${auth.role}'.`,
      });
    }

    return next();
  });
}

/**
 * Map specific HTTP methods to action categories.
 * Unlisted methods default to 'write'.
 */
export function requireCategoryByMethod(mapping: Partial<Record<string, ActionCategory>>) {
  return createMiddleware<{ Variables: UnifiedAuthVariables }>(async (c, next) => {
    const auth = c.var.auth;
    if (!auth) {
      return authRequired(c);
    }

    const method = c.req.method;
    const category: ActionCategory = mapping[method] ?? 'write';

    if (!isRoleAllowed(auth.role, category)) {
      return insufficientPermissions(c, {
        required: minRoleForCategory(category),
        current: auth.role,
        hint: `${method} on this resource requires '${minRoleForCategory(category)}' role. Your role is '${auth.role}'.`,
      });
    }

    return next();
  });
}
