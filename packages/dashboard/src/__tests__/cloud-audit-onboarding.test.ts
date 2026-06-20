/**
 * Cloud Dashboard Tests — S-7.6 (Audit Log) + S-7.7 (Onboarding)
 */

import { describe, it, expect } from 'vitest';

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
