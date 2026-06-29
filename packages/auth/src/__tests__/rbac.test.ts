import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, hasPermission, hasCategory, normalizeRole, categoriesForRole } from '../rbac.js';
import type { Permission } from '../types.js';

describe('ROLE_PERMISSIONS', () => {
  it('defines permissions for the unified role set', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([
      'admin', 'auditor', 'editor', 'member', 'owner', 'viewer',
    ]);
  });

  it('owner has wildcard only', () => {
    expect(ROLE_PERMISSIONS.owner).toEqual(['*']);
  });
});

describe('unified role model (#147)', () => {
  it("treats 'editor' as a deprecated alias for 'member'", () => {
    expect(normalizeRole('editor')).toBe('member');
    expect(ROLE_PERMISSIONS.editor).toEqual(ROLE_PERMISSIONS.member);
  });

  it('auditor can read + pull audit evidence but not write', () => {
    expect(hasPermission(ROLE_PERMISSIONS.auditor, 'events:read')).toBe(true);
    expect(hasPermission(ROLE_PERMISSIONS.auditor, 'audit:read')).toBe(true);
    expect(hasPermission(ROLE_PERMISSIONS.auditor, 'audit:export')).toBe(true);
    expect(hasPermission(ROLE_PERMISSIONS.auditor, 'events:write')).toBe(false);
  });

  it('maps roles to coarse categories', () => {
    expect(categoriesForRole('viewer')).toEqual(['read']);
    expect(hasCategory('member', 'write')).toBe(true);
    expect(hasCategory('member', 'manage')).toBe(false);
    expect(hasCategory('admin', 'manage')).toBe(true);
    expect(hasCategory('auditor', 'audit')).toBe(true);
    expect(hasCategory('owner', 'billing')).toBe(true);
  });

  it('normalizes unknown roles to viewer', () => {
    expect(normalizeRole('nonsense')).toBe('viewer');
    expect(normalizeRole(undefined)).toBe('viewer');
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
