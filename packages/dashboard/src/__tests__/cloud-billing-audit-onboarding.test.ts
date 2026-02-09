/**
 * Cloud Dashboard Tests — S-7.5 (Billing) + S-7.6 (Audit Log) + S-7.7 (Onboarding)
 */

import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════
// S-7.5: Billing Page
// ═══════════════════════════════════════════

describe('S-7.5: BillingPage component', () => {
  it('exports BillingPage as named export', async () => {
    const mod = await import('../cloud/BillingPage');
    expect(typeof mod.BillingPage).toBe('function');
  });

  it('exports BillingPage as default export', async () => {
    const mod = await import('../cloud/BillingPage');
    expect(typeof mod.default).toBe('function');
  });

  it('is re-exported from cloud barrel', async () => {
    const mod = await import('../cloud/index');
    expect(typeof mod.BillingPage).toBe('function');
  });
});

describe('S-7.5: Billing API client functions', () => {
  it('exports getBillingOverview', async () => {
    const api = await import('../cloud/api');
    expect(typeof api.getBillingOverview).toBe('function');
  });

  it('exports getBillingInvoices', async () => {
    const api = await import('../cloud/api');
    expect(typeof api.getBillingInvoices).toBe('function');
  });

  it('exports upgradePlan', async () => {
    const api = await import('../cloud/api');
    expect(typeof api.upgradePlan).toBe('function');
  });

  it('exports downgradePlan', async () => {
    const api = await import('../cloud/api');
    expect(typeof api.downgradePlan).toBe('function');
  });

  it('exports createPortalSession', async () => {
    const api = await import('../cloud/api');
    expect(typeof api.createPortalSession).toBe('function');
  });
});

// ═══════════════════════════════════════════
// S-7.6: Audit Log Page
// ═══════════════════════════════════════════

describe('S-7.6: AuditLogPage component', () => {
  it('exports AuditLogPage as named export', async () => {
    const mod = await import('../cloud/AuditLogPage');
    expect(typeof mod.AuditLogPage).toBe('function');
  });

  it('exports AuditLogPage as default export', async () => {
    const mod = await import('../cloud/AuditLogPage');
    expect(typeof mod.default).toBe('function');
  });

  it('is re-exported from cloud barrel', async () => {
    const mod = await import('../cloud/index');
    expect(typeof mod.AuditLogPage).toBe('function');
  });
});

describe('S-7.6: Audit Log API client functions', () => {
  it('exports queryAuditLog', async () => {
    const api = await import('../cloud/api');
    expect(typeof api.queryAuditLog).toBe('function');
  });

  it('exports exportAuditLog', async () => {
    const api = await import('../cloud/api');
    expect(typeof api.exportAuditLog).toBe('function');
  });
});

// ═══════════════════════════════════════════
// S-7.7: Onboarding Flow
// ═══════════════════════════════════════════

describe('S-7.7: OnboardingFlow component', () => {
  it('exports OnboardingFlow as named export', async () => {
    const mod = await import('../cloud/OnboardingFlow');
    expect(typeof mod.OnboardingFlow).toBe('function');
  });

  it('exports OnboardingFlow as default export', async () => {
    const mod = await import('../cloud/OnboardingFlow');
    expect(typeof mod.default).toBe('function');
  });

  it('is re-exported from cloud barrel', async () => {
    const mod = await import('../cloud/index');
    expect(typeof mod.OnboardingFlow).toBe('function');
  });
});

describe('S-7.7: Onboarding API client functions', () => {
  it('exports getOnboardingStatus', async () => {
    const api = await import('../cloud/api');
    expect(typeof api.getOnboardingStatus).toBe('function');
  });

  it('exports verifyFirstEvent', async () => {
    const api = await import('../cloud/api');
    expect(typeof api.verifyFirstEvent).toBe('function');
  });
});
