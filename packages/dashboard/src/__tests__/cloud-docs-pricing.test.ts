/**
 * Cloud Docs & Pricing Tests — S-9.3 (API Reference) + S-9.4 (Pricing Page)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ═══════════════════════════════════════════
// S-9.3: Cloud API Reference
// ═══════════════════════════════════════════

describe('S-9.3: Cloud API Reference documentation', () => {
  const docPath = resolve(__dirname, '../../../../docs/api/cloud-api-reference.md');

  it('API reference document exists', () => {
    expect(existsSync(docPath)).toBe(true);
  });

  it('covers all endpoint categories', () => {
    const content = readFileSync(docPath, 'utf-8');
    const requiredSections = [
      'Authentication',
      'Ingestion',
      'Organization Management',
      'API Key Management',
      'Billing',
      'Audit Log',
      'Error Codes',
      'Rate Limits',
    ];
    for (const section of requiredSections) {
      expect(content).toContain(section);
    }
  });

  it('includes request/response examples', () => {
    const content = readFileSync(docPath, 'utf-8');
    // Should have JSON code blocks
    const jsonBlocks = content.match(/```json/g);
    expect(jsonBlocks).not.toBeNull();
    expect(jsonBlocks!.length).toBeGreaterThanOrEqual(10);
  });
});

// ═══════════════════════════════════════════
// S-9.4: Pricing Page
// ═══════════════════════════════════════════

describe('S-9.4: PricingPage component', () => {
  it('exports PricingPage as named export', async () => {
    const mod = await import('../cloud/PricingPage');
    expect(typeof mod.PricingPage).toBe('function');
  });

  it('is re-exported from cloud barrel', async () => {
    const mod = await import('../cloud/index');
    expect(typeof mod.PricingPage).toBe('function');
  });
});

describe('S-9.4: Pricing documentation', () => {
  const docPath = resolve(__dirname, '../../../../docs/pricing.md');

  it('pricing doc exists', () => {
    expect(existsSync(docPath)).toBe(true);
  });

  it('documents all 4 tiers', () => {
    const content = readFileSync(docPath, 'utf-8');
    for (const tier of ['Free', 'Pro', 'Team', 'Enterprise']) {
      expect(content).toContain(`### ${tier}`);
    }
  });

  it('includes feature comparison table', () => {
    const content = readFileSync(docPath, 'utf-8');
    expect(content).toContain('Feature Comparison');
    expect(content).toContain('Monthly events');
  });

  it('includes FAQ section', () => {
    const content = readFileSync(docPath, 'utf-8');
    expect(content).toContain('Frequently Asked Questions');
  });
});
