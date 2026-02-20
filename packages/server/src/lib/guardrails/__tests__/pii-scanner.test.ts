/**
 * Tests for PII Scanner (Feature 8 — Story 4) [F8-S4]
 */
import { describe, it, expect } from 'vitest';
import { PiiScanner } from '../scanners/pii-scanner.js';
import { luhnCheck } from '../scanners/patterns/pii-patterns.js';
import type { ScanContext } from '../scanners/base-scanner.js';

const ctx: ScanContext = { tenantId: 't1', agentId: 'a1', toolName: 'test', direction: 'input' };

describe('PiiScanner', () => {
  it('detects SSN', () => {
    const scanner = new PiiScanner();
    scanner.compile({ patterns: ['ssn'] });
    const result = scanner.scan('My SSN is 123-45-6789', ctx);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].patternName).toBe('ssn');
    expect(result.matches[0].offset).toEqual({ start: 10, end: 21 });
    expect(result.matches[0].redactionToken).toBe('[SSN_REDACTED]');
  });

  it('does not match partial SSN', () => {
    const scanner = new PiiScanner();
    scanner.compile({ patterns: ['ssn'] });
    const result = scanner.scan('Not a SSN: 123-456-789', ctx);
    expect(result.matches).toHaveLength(0);
  });

  it('detects email', () => {
    const scanner = new PiiScanner();
    scanner.compile({ patterns: ['email'] });
    const result = scanner.scan('Contact user@example.com for info', ctx);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].patternName).toBe('email');
  });

  it('detects US phone', () => {
    const scanner = new PiiScanner();
    scanner.compile({ patterns: ['phone_us'] });
    const result = scanner.scan('Call (555) 123-4567 or 555-123-4567', ctx);
    expect(result.matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects valid credit card with Luhn check', () => {
    const scanner = new PiiScanner();
    scanner.compile({ patterns: ['credit_card'] });
    // 4111111111111111 is a valid Luhn number
    const result = scanner.scan('Card: 4111111111111111', ctx);
    expect(result.matches).toHaveLength(1);
  });

  it('rejects credit card that fails Luhn check', () => {
    const scanner = new PiiScanner();
    scanner.compile({ patterns: ['credit_card'] });
    const result = scanner.scan('Card: 4111111111111112', ctx);
    expect(result.matches).toHaveLength(0);
  });

  it('respects minConfidence filter', () => {
    const scanner = new PiiScanner();
    scanner.compile({ patterns: ['phone_us'], minConfidence: 0.99 });
    // phone_us has 0.80 confidence, should be filtered
    const result = scanner.scan('Call (555) 123-4567', ctx);
    expect(result.matches).toHaveLength(0);
  });

  it('uses custom patterns', () => {
    const scanner = new PiiScanner();
    scanner.compile({
      patterns: [],
      customPatterns: { custom_id: '\\bID-\\d{6}\\b' },
      minConfidence: 0.5,
    });
    const result = scanner.scan('Your ID-123456 is ready', ctx);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].patternName).toBe('custom_id');
    expect(result.matches[0].redactionToken).toBe('[CUSTOM_ID_REDACTED]');
  });

  it('scans 100KB text within performance budget', () => {
    const scanner = new PiiScanner();
    scanner.compile({});
    const text = 'x'.repeat(100_000) + ' 123-45-6789 ' + 'y'.repeat(100);
    const start = performance.now();
    const result = scanner.scan(text, ctx);
    const elapsed = performance.now() - start;
    expect(result.matches).toHaveLength(1);
    expect(elapsed).toBeLessThan(50);
  });
});

describe('luhnCheck', () => {
  it('validates known good card numbers', () => {
    expect(luhnCheck('4111111111111111')).toBe(true);
    expect(luhnCheck('5500000000000004')).toBe(true);
  });

  it('rejects bad card numbers', () => {
    expect(luhnCheck('4111111111111112')).toBe(false);
    expect(luhnCheck('1234')).toBe(false);
  });
});
