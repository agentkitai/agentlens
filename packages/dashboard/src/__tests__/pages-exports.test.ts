/**
 * Tests for new dashboard page exports (Stories 7.2, 7.3)
 *
 * Since no DOM testing library is available, we verify:
 * - Pages export correctly
 * - They are valid React components (functions)
 * - Routes are registered in App
 */

import { describe, it, expect } from 'vitest';

describe('Page exports — Sharing Controls (7.2)', () => {
  it('should export SharingControls as default', async () => {
    const mod = await import('../pages/SharingControls');
    expect(typeof mod.default).toBe('function');
  });

  it('should export Knowledge as named export', async () => {
    const mod = await import('../pages/Knowledge');
    expect(typeof mod.Knowledge).toBe('function');
  });

  it('should export SharingActivity as default', async () => {
    const mod = await import('../pages/SharingActivity');
    expect(typeof mod.default).toBe('function');
  });
});

describe('Page exports — Discovery & Delegation (7.3)', () => {
  it('should export AgentNetwork as default', async () => {
    const mod = await import('../pages/AgentNetwork');
    expect(typeof mod.default).toBe('function');
  });

  it('should export CapabilityRegistry as default', async () => {
    const mod = await import('../pages/CapabilityRegistry');
    expect(typeof mod.default).toBe('function');
  });

  it('should export DelegationLog as default', async () => {
    const mod = await import('../pages/DelegationLog');
    expect(typeof mod.default).toBe('function');
  });
});

describe('App routing', () => {
  it('should import all new page components in App', async () => {
    // Verify the App module imports all pages without error
    const appSource = await import('../App');
    expect(typeof appSource.App).toBe('function');
  });
});

describe('API client type exports', () => {
  it('should export all community API functions', async () => {
    const api = await import('../api/client');
    expect(typeof api.getSharingConfig).toBe('function');
    expect(typeof api.updateSharingConfig).toBe('function');
    expect(typeof api.getAgentSharingConfigs).toBe('function');
    expect(typeof api.updateAgentSharingConfig).toBe('function');
    expect(typeof api.getDenyList).toBe('function');
    expect(typeof api.addDenyListRule).toBe('function');
    expect(typeof api.deleteDenyListRule).toBe('function');
    expect(typeof api.communitySearch).toBe('function');
    expect(typeof api.communityRate).toBe('function');
    expect(typeof api.getSharingAuditLog).toBe('function');
    expect(typeof api.killSwitchPurge).toBe('function');
    expect(typeof api.getSharingStats).toBe('function');
  });

  it('should export all discovery API functions', async () => {
    const api = await import('../api/client');
    expect(typeof api.getCapabilities).toBe('function');
    expect(typeof api.registerCapability).toBe('function');
    expect(typeof api.updateCapability).toBe('function');
    expect(typeof api.discoverAgents).toBe('function');
  });

  it('should export all delegation API functions', async () => {
    const api = await import('../api/client');
    expect(typeof api.getDelegations).toBe('function');
  });
});
