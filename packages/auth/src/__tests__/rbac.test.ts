import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, hasPermission } from '../rbac.js';
import type { Permission, Role } from '../types.js';

describe('ROLE_PERMISSIONS', () => {
  it('defines permissions for all four roles', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([
      'admin', 'editor', 'owner', 'viewer',
    ]);
  });

  it('owner has wildcard only', () => {
    expect(ROLE_PERMISSIONS.owner).toEqual(['*']);
  });
});

describe('hasPermission', () => {
  it('returns true when permission is in the list', () => {
    expect(hasPermission(['events:read', 'events:write'], 'events:read')).toBe(true);
  });

  it('returns false when permission is not in the list', () => {
    expect(hasPermission(['events:read'], 'events:write')).toBe(false);
  });

  it('wildcard grants everything', () => {
    expect(hasPermission(['*'], 'events:write')).toBe(true);
    expect(hasPermission(['*'], 'users:manage')).toBe(true);
    expect(hasPermission(['*'], 'keys:manage')).toBe(true);
  });

  it('viewer cannot events:write', () => {
    expect(hasPermission(ROLE_PERMISSIONS.viewer, 'events:write')).toBe(false);
  });

  it('viewer can events:read', () => {
    expect(hasPermission(ROLE_PERMISSIONS.viewer, 'events:read')).toBe(true);
  });

  it('editor can events:write', () => {
    expect(hasPermission(ROLE_PERMISSIONS.editor, 'events:write')).toBe(true);
  });

  it('admin can keys:manage', () => {
    expect(hasPermission(ROLE_PERMISSIONS.admin, 'keys:manage')).toBe(true);
  });

  it('admin can users:manage', () => {
    expect(hasPermission(ROLE_PERMISSIONS.admin, 'users:manage')).toBe(true);
  });

  it('editor cannot keys:manage', () => {
    expect(hasPermission(ROLE_PERMISSIONS.editor, 'keys:manage')).toBe(false);
  });

  it('owner (wildcard) grants all permissions', () => {
    const allPerms: Permission[] = [
      'events:read', 'events:write', 'sessions:read',
      'agents:read', 'agents:write', 'config:read', 'config:write',
      'keys:manage', 'users:manage',
      'guardrails:read', 'guardrails:write',
      'lessons:read', 'lessons:write',
    ];
    for (const perm of allPerms) {
      expect(hasPermission(ROLE_PERMISSIONS.owner, perm)).toBe(true);
    }
  });
});
