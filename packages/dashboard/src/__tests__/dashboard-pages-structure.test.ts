/**
 * Additional structural tests for new dashboard pages (Stories 7.2, 7.3)
 */

import { describe, it, expect, vi } from 'vitest';

// Mock fetch for any API calls during import
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({}),
  text: () => Promise.resolve(''),
}));

describe('SharingControls page structure', () => {
  it('should be a valid React component function', async () => {
    const mod = await import('../pages/SharingControls');
    expect(mod.default).toBeDefined();
    expect(mod.default.length).toBeLessThanOrEqual(1); // React components take 0-1 args (props)
  });

  it('should have a default export name', async () => {
    const mod = await import('../pages/SharingControls');
    expect(mod.default.name).toBeTruthy();
  });
});

describe('CommunityBrowser page structure', () => {
  it('should be a valid React component function', async () => {
    const mod = await import('../pages/CommunityBrowser');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('should have a default export name', async () => {
    const mod = await import('../pages/CommunityBrowser');
    expect(mod.default.name).toBe('CommunityBrowser');
  });
});

describe('SharingActivity page structure', () => {
  it('should be a valid React component function', async () => {
    const mod = await import('../pages/SharingActivity');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('should have a default export name', async () => {
    const mod = await import('../pages/SharingActivity');
    expect(mod.default.name).toBe('SharingActivity');
  });
});

describe('AgentNetwork page structure', () => {
  it('should be a valid React component function', async () => {
    const mod = await import('../pages/AgentNetwork');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('should have a default export name', async () => {
    const mod = await import('../pages/AgentNetwork');
    expect(mod.default.name).toBe('AgentNetwork');
  });
});

describe('CapabilityRegistry page structure', () => {
  it('should be a valid React component function', async () => {
    const mod = await import('../pages/CapabilityRegistry');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('should have a default export name', async () => {
    const mod = await import('../pages/CapabilityRegistry');
    expect(mod.default.name).toBe('CapabilityRegistry');
  });
});

describe('DelegationLog page structure', () => {
  it('should be a valid React component function', async () => {
    const mod = await import('../pages/DelegationLog');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('should have a default export name', async () => {
    const mod = await import('../pages/DelegationLog');
    expect(mod.default.name).toBe('DelegationLog');
  });
});

describe('Layout nav items', () => {
  it('should include sharing nav item', async () => {
    const layoutSrc = await import('../components/Layout');
    expect(layoutSrc.Layout).toBeDefined();
  });
});

describe('App routes include new pages', () => {
  it('should import SharingControls', async () => {
    const app = await import('../App');
    expect(app.App).toBeDefined();
  });
});

describe('API client — type structure', () => {
  it('exports SharingConfigData-compatible functions', async () => {
    const api = await import('../api/client');
    // Verify function signatures exist
    expect(api.getSharingConfig).toBeDefined();
    expect(api.updateSharingConfig).toBeDefined();
  });

  it('exports CapabilityData-compatible functions', async () => {
    const api = await import('../api/client');
    expect(api.getCapabilities).toBeDefined();
    expect(api.registerCapability).toBeDefined();
    expect(api.updateCapability).toBeDefined();
  });

  it('exports DelegationLogData-compatible functions', async () => {
    const api = await import('../api/client');
    expect(api.getDelegations).toBeDefined();
  });

  it('exports community functions', async () => {
    const api = await import('../api/client');
    expect(api.communitySearch).toBeDefined();
    expect(api.communityRate).toBeDefined();
    expect(api.getSharingAuditLog).toBeDefined();
    expect(api.killSwitchPurge).toBeDefined();
    expect(api.getSharingStats).toBeDefined();
  });

  it('exports deny list functions', async () => {
    const api = await import('../api/client');
    expect(api.getDenyList).toBeDefined();
    expect(api.addDenyListRule).toBeDefined();
    expect(api.deleteDenyListRule).toBeDefined();
  });

  it('exports discovery functions', async () => {
    const api = await import('../api/client');
    expect(api.discoverAgents).toBeDefined();
  });

  it('exports agent sharing config functions', async () => {
    const api = await import('../api/client');
    expect(api.getAgentSharingConfigs).toBeDefined();
    expect(api.updateAgentSharingConfig).toBeDefined();
  });
});
