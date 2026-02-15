// @agentkit/auth — RBAC permission model

import type { Permission, Role } from './types.js';

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  viewer: [
    'events:read',
    'sessions:read',
    'agents:read',
    'config:read',
    'guardrails:read',
    'lessons:read',
  ],
  editor: [
    'events:read',
    'events:write',
    'sessions:read',
    'agents:read',
    'agents:write',
    'config:read',
    'guardrails:read',
    'lessons:read',
    'lessons:write',
  ],
  admin: [
    'events:read',
    'events:write',
    'sessions:read',
    'agents:read',
    'agents:write',
    'config:read',
    'config:write',
    'keys:manage',
    'users:manage',
    'guardrails:read',
    'guardrails:write',
    'lessons:read',
    'lessons:write',
  ],
  owner: ['*'],
};

/**
 * Check if a set of permissions satisfies a required permission.
 * Wildcard '*' grants everything.
 */
export function hasPermission(
  permissions: readonly Permission[],
  required: Permission,
): boolean {
  if (permissions.includes('*')) return true;
  return permissions.includes(required);
}
