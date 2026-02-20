/**
 * Tests for Scanner Registry (Feature 8 — Story 3) [F8-S3]
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { GuardrailRule } from '@agentlensai/core';
import {
  isContentRule,
  getScannerForRule,
  invalidateScanner,
  invalidateAllScanners,
  _getCacheSize,
} from '../scanners/scanner-registry.js';

function makeRule(overrides: Partial<GuardrailRule> = {}): GuardrailRule {
  return {
    id: 'rule-1',
    tenantId: 't1',
    name: 'Test Rule',
    enabled: true,
    conditionType: 'pii_detection',
    conditionConfig: { patterns: ['ssn'] },
    actionType: 'block',
    actionConfig: {},
    cooldownMinutes: 15,
    dryRun: false,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('isContentRule', () => {
  it('returns true for content condition types', () => {
    expect(isContentRule(makeRule({ conditionType: 'pii_detection' }))).toBe(true);
    expect(isContentRule(makeRule({ conditionType: 'secrets_detection' }))).toBe(true);
    expect(isContentRule(makeRule({ conditionType: 'content_regex' }))).toBe(true);
    expect(isContentRule(makeRule({ conditionType: 'toxicity_detection' }))).toBe(true);
    expect(isContentRule(makeRule({ conditionType: 'prompt_injection' }))).toBe(true);
  });

  it('returns false for operational condition types', () => {
    expect(isContentRule(makeRule({ conditionType: 'error_rate_threshold' }))).toBe(false);
    expect(isContentRule(makeRule({ conditionType: 'cost_limit' }))).toBe(false);
  });
});

describe('getScannerForRule', () => {
  beforeEach(() => {
    invalidateAllScanners();
  });

  it('creates and caches PII scanner', () => {
    const rule = makeRule({ conditionType: 'pii_detection', conditionConfig: { patterns: ['ssn'] } });
    const scanner = getScannerForRule(rule);
    expect(scanner.type).toBe('pii_detection');
    expect(_getCacheSize()).toBe(1);

    // Second call returns same cached instance
    const scanner2 = getScannerForRule(rule);
    expect(scanner2).toBe(scanner);
    expect(_getCacheSize()).toBe(1);
  });

  it('creates secrets scanner', () => {
    const rule = makeRule({ id: 'r2', conditionType: 'secrets_detection', conditionConfig: {} });
    const scanner = getScannerForRule(rule);
    expect(scanner.type).toBe('secrets_detection');
  });

  it('throws for unknown condition type', () => {
    const rule = makeRule({ conditionType: 'error_rate_threshold' as any });
    expect(() => getScannerForRule(rule)).toThrow('No scanner');
  });
});

describe('cache invalidation', () => {
  beforeEach(() => {
    invalidateAllScanners();
  });

  it('invalidateScanner removes single entry', () => {
    const rule = makeRule();
    getScannerForRule(rule);
    expect(_getCacheSize()).toBe(1);
    invalidateScanner('rule-1');
    expect(_getCacheSize()).toBe(0);
  });

  it('invalidateAllScanners clears all', () => {
    getScannerForRule(makeRule({ id: 'r1' }));
    getScannerForRule(makeRule({ id: 'r2', conditionType: 'secrets_detection', conditionConfig: {} }));
    expect(_getCacheSize()).toBe(2);
    invalidateAllScanners();
    expect(_getCacheSize()).toBe(0);
  });
});
