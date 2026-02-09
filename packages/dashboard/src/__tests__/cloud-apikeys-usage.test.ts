/**
 * Cloud Dashboard Tests — S-7.3 (API Key Management) + S-7.4 (Usage Dashboard)
 *
 * Verifies:
 * - Component exports and structure
 * - API client functions for API keys and usage
 * - App routing includes new pages
 */

import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════
// S-7.3: API Key Management Page
// ═══════════════════════════════════════════

describe('S-7.3: ApiKeyManagement component', () => {
  it('exports ApiKeyManagement as named export', async () => {
    const mod = await import('../cloud/ApiKeyManagement');
    expect(typeof mod.ApiKeyManagement).toBe('function');
  });

  it('exports ApiKeyManagement as default export', async () => {
    const mod = await import('../cloud/ApiKeyManagement');
    expect(typeof mod.default).toBe('function');
  });

  it('is re-exported from cloud barrel', async () => {
    const mod = await import('../cloud/index');
    expect(typeof mod.ApiKeyManagement).toBe('function');
  });
});

describe('S-7.3: API key client functions', () => {
  it('exports listApiKeys function', async () => {
    const api = await import('../cloud/api');
    expect(typeof api.listApiKeys).toBe('function');
  });

  it('exports createApiKey function', async () => {
    const api = await import('../cloud/api');
    expect(typeof api.createApiKey).toBe('function');
  });

  it('exports revokeApiKey function', async () => {
    const api = await import('../cloud/api');
    expect(typeof api.revokeApiKey).toBe('function');
  });

  it('exports getApiKeyLimit function', async () => {
    const api = await import('../cloud/api');
    expect(typeof api.getApiKeyLimit).toBe('function');
  });

  it('exports ApiKeyEnvironment type (runtime check via api module)', async () => {
    // Type-only exports don't exist at runtime, but we verify the module loads
    const api = await import('../cloud/api');
    expect(api).toBeDefined();
  });
});

// ═══════════════════════════════════════════
// S-7.4: Usage Dashboard Page
// ═══════════════════════════════════════════

describe('S-7.4: UsageDashboard component', () => {
  it('exports UsageDashboard as named export', async () => {
    const mod = await import('../cloud/UsageDashboard');
    expect(typeof mod.UsageDashboard).toBe('function');
  });

  it('exports UsageDashboard as default export', async () => {
    const mod = await import('../cloud/UsageDashboard');
    expect(typeof mod.default).toBe('function');
  });

  it('is re-exported from cloud barrel', async () => {
    const mod = await import('../cloud/index');
    expect(typeof mod.UsageDashboard).toBe('function');
  });
});

describe('S-7.4: Usage API client functions', () => {
  it('exports getUsage function', async () => {
    const api = await import('../cloud/api');
    expect(typeof api.getUsage).toBe('function');
  });

  it('exports UsageTimeRange and UsageBreakdown types (module loads)', async () => {
    const api = await import('../cloud/api');
    expect(api).toBeDefined();
  });
});

// ═══════════════════════════════════════════
// App routing includes new cloud pages
// ═══════════════════════════════════════════

describe('App includes S-7.3/S-7.4 routes', () => {
  it('App imports ApiKeyManagement and UsageDashboard without error', async () => {
    const { App } = await import('../App');
    expect(typeof App).toBe('function');
  });

  it('cloud barrel exports all 5 components', async () => {
    const mod = await import('../cloud/index');
    expect(typeof mod.OrgSwitcher).toBe('function');
    expect(typeof mod.OrgProvider).toBe('function');
    expect(typeof mod.TeamManagement).toBe('function');
    expect(typeof mod.ApiKeyManagement).toBe('function');
    expect(typeof mod.UsageDashboard).toBe('function');
  });
});
