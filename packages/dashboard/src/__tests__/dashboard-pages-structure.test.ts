/**
 * Structural tests for dashboard pages
 */

import { describe, it, expect, vi } from 'vitest';

// Mock fetch for any API calls during import
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({}),
  text: () => Promise.resolve(''),
}));

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
  it('should export Layout component', async () => {
    const layoutSrc = await import('../components/Layout');
    expect(layoutSrc.Layout).toBeDefined();
  });
});

describe('App routes', () => {
  it('should export App component', async () => {
    const app = await import('../App');
    expect(app.App).toBeDefined();
  });
});

describe('API client — type structure', () => {
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

  it('exports discovery functions', async () => {
    const api = await import('../api/client');
    expect(api.discoverAgents).toBeDefined();
  });

  it('exports lore memory functions', async () => {
    const api = await import('../api/client');
    expect(api.getMemories).toBeDefined();
    expect(api.getMemory).toBeDefined();
    expect(api.getLoreStats).toBeDefined();
  });
});
