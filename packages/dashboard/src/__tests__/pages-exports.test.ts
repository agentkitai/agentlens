/**
 * Tests for dashboard page exports
 */

import { describe, it, expect } from 'vitest';

describe('Page exports — Memories', () => {
  it('should export Knowledge (Memories) as named export', async () => {
    const mod = await import('../pages/Knowledge');
    expect(typeof mod.Knowledge).toBe('function');
  });
});

describe('Page exports — Discovery & Delegation', () => {
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
  it('should import all page components in App', async () => {
    const appSource = await import('../App');
    expect(typeof appSource.App).toBe('function');
  });
});

describe('API client type exports', () => {
  it('should export discovery API functions', async () => {
    const api = await import('../api/client');
    expect(typeof api.getCapabilities).toBe('function');
    expect(typeof api.registerCapability).toBe('function');
    expect(typeof api.updateCapability).toBe('function');
    expect(typeof api.discoverAgents).toBe('function');
  });

  it('should export delegation API functions', async () => {
    const api = await import('../api/client');
    expect(typeof api.getDelegations).toBe('function');
  });

  it('should export lore memory API functions', async () => {
    const api = await import('../api/client');
    expect(typeof api.getMemories).toBe('function');
    expect(typeof api.getMemory).toBe('function');
    expect(typeof api.getLoreStats).toBe('function');
  });
});
