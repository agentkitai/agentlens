// @agentkit/auth — unified RBAC permission model (#147)

import type { Permission, Role, RoleCategory } from './types.js';

const VIEWER_PERMS: Permission[] = ['events:read', 'sessions:read', 'agents:read', 'config:read', 'guardrails:read', 'lessons:read'];
const MEMBER_PERMS: Permission[] = [...VIEWER_PERMS, 'events:write', 'agents:write', 'lessons:write'];
const ADMIN_PERMS: Permission[] = [...MEMBER_PERMS, 'config:write', 'keys:manage', 'users:manage', 'guardrails:write', 'audit:read', 'audit:export'];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  viewer: VIEWER_PERMS,
  // auditor = read everything + pull audit evidence, but no writes.
  auditor: [...VIEWER_PERMS, 'audit:read', 'audit:export'],
  member: MEMBER_PERMS,
  editor: MEMBER_PERMS, // deprecated alias for member
  admin: ADMIN_PERMS,
  owner: ['*'],
};

/** Coarse category grants per role — consumed by the cloud `requireCategory` guard. */
export const ROLE_CATEGORIES: Record<Role, RoleCategory[]> = {
  viewer: ['read'],
  auditor: ['read', 'audit'],
  member: ['read', 'write'],
  editor: ['read', 'write'],
  admin: ['read', 'write', 'manage', 'audit'],
  owner: ['read', 'write', 'manage', 'billing', 'audit'],
};

const ROLE_ALIASES: Record<string, Role> = { editor: 'member' };

/** Map any role string to its canonical role (alias-resolved); unknown → viewer. */
export function normalizeRole(role: string | undefined | null): Role {
  if (!role) return 'viewer';
  if (role in ROLE_ALIASES) return ROLE_ALIASES[role]!;
  return role in ROLE_CATEGORIES ? (role as Role) : 'viewer';
}

export function permissionsForRole(role: string): Permission[] {
  return ROLE_PERMISSIONS[normalizeRole(role)];
}

export function categoriesForRole(role: string): RoleCategory[] {
  return ROLE_CATEGORIES[normalizeRole(role)];
}

/**
 * Check if a set of permissions satisfies a required permission.
 * Wildcard '*' grants everything.
 */
export function hasPermission(permissions: readonly Permission[], required: Permission): boolean {
  if (permissions.includes('*')) return true;
  return permissions.includes(required);
}

/** Check if a role grants a coarse category (owner grants all). */
export function hasCategory(role: string, category: RoleCategory): boolean {
  return categoriesForRole(role).includes(category);
}
