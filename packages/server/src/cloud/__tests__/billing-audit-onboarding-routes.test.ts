/**
 * Server Route Tests — S-7.5 (Billing Routes) + S-7.6 (Audit Routes) + S-7.7 (Onboarding Routes)
 */

import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════
// S-7.5: Billing Routes
// ═══════════════════════════════════════════

describe('S-7.5: Billing route handlers', () => {
  it('exports createBillingRouteHandlers', async () => {
    const mod = await import('../routes/billing-routes.js');
    expect(typeof mod.createBillingRouteHandlers).toBe('function');
  });

  it('returns handler map with expected methods', async () => {
    const mod = await import('../routes/billing-routes.js');
    // We can't fully instantiate without deps, but verify shape
    const handlers = mod.createBillingRouteHandlers({
      db: {} as any,
      billingService: {} as any,
      invoiceService: {} as any,
      trialService: {} as any,
    });
    expect(typeof handlers.getBillingOverview).toBe('function');
    expect(typeof handlers.getInvoices).toBe('function');
    expect(typeof handlers.upgradePlan).toBe('function');
    expect(typeof handlers.downgradePlan).toBe('function');
    expect(typeof handlers.createPortalSession).toBe('function');
  });
});

// ═══════════════════════════════════════════
// S-7.6: Audit Routes
// ═══════════════════════════════════════════

describe('S-7.6: Audit route handlers', () => {
  it('exports createAuditRouteHandlers', async () => {
    const mod = await import('../routes/audit-routes.js');
    expect(typeof mod.createAuditRouteHandlers).toBe('function');
  });

  it('returns handler map with expected methods', async () => {
    const mod = await import('../routes/audit-routes.js');
    const handlers = mod.createAuditRouteHandlers({
      auditLog: {} as any,
    });
    expect(typeof handlers.queryAuditLog).toBe('function');
    expect(typeof handlers.exportAuditLog).toBe('function');
  });
});

// ═══════════════════════════════════════════
// S-7.7: Onboarding Routes
// ═══════════════════════════════════════════

describe('S-7.7: Onboarding route handlers', () => {
  it('exports createOnboardingRouteHandlers', async () => {
    const mod = await import('../routes/onboarding-routes.js');
    expect(typeof mod.createOnboardingRouteHandlers).toBe('function');
  });

  it('returns handler map with expected methods', async () => {
    const mod = await import('../routes/onboarding-routes.js');
    const handlers = mod.createOnboardingRouteHandlers({
      db: {} as any,
    });
    expect(typeof handlers.getOnboardingStatus).toBe('function');
    expect(typeof handlers.verifyFirstEvent).toBe('function');
  });
});
