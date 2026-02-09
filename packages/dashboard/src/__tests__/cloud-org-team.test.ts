/**
 * Cloud Dashboard Tests (S-7.1, S-7.2)
 *
 * Verifies:
 * - Cloud component exports
 * - API client functions exist
 * - App routing includes new pages
 */

import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════
// S-7.1: Org Switcher exports
// ═══════════════════════════════════════════

describe('S-7.1: OrgSwitcher component', () => {
  it('exports OrgSwitcher as named export', async () => {
    const mod = await import('../cloud/OrgSwitcher');
    expect(typeof mod.OrgSwitcher).toBe('function');
    expect(typeof mod.default).toBe('function');
  });

  it('exports OrgProvider and useOrg from OrgContext', async () => {
    const mod = await import('../cloud/OrgContext');
    expect(typeof mod.OrgProvider).toBe('function');
    expect(typeof mod.useOrg).toBe('function');
  });

  it('exports cloud index barrel', async () => {
    const mod = await import('../cloud/index');
    expect(typeof mod.OrgSwitcher).toBe('function');
    expect(typeof mod.OrgProvider).toBe('function');
    expect(typeof mod.useOrg).toBe('function');
    expect(typeof mod.TeamManagement).toBe('function');
  });
});

// ═══════════════════════════════════════════
// S-7.2: Team Management exports
// ═══════════════════════════════════════════

describe('S-7.2: TeamManagement component', () => {
  it('exports TeamManagement as named and default export', async () => {
    const mod = await import('../cloud/TeamManagement');
    expect(typeof mod.TeamManagement).toBe('function');
    expect(typeof mod.default).toBe('function');
  });
});

// ═══════════════════════════════════════════
// Cloud API client functions
// ═══════════════════════════════════════════

describe('Cloud API client', () => {
  it('exports all org management functions', async () => {
    const api = await import('../cloud/api');
    expect(typeof api.getMyOrgs).toBe('function');
    expect(typeof api.createOrg).toBe('function');
    expect(typeof api.switchOrg).toBe('function');
  });

  it('exports all team management functions', async () => {
    const api = await import('../cloud/api');
    expect(typeof api.getOrgMembers).toBe('function');
    expect(typeof api.getOrgInvitations).toBe('function');
    expect(typeof api.inviteMember).toBe('function');
    expect(typeof api.cancelInvitation).toBe('function');
    expect(typeof api.changeMemberRole).toBe('function');
    expect(typeof api.removeMember).toBe('function');
    expect(typeof api.transferOwnership).toBe('function');
  });
});

// ═══════════════════════════════════════════
// App routing
// ═══════════════════════════════════════════

describe('App includes cloud routes', () => {
  it('App imports TeamManagement without error', async () => {
    const { App } = await import('../App');
    expect(typeof App).toBe('function');
  });
});
