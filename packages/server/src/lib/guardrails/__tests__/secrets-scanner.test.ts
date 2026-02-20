/**
 * Tests for Secrets Scanner (Feature 8 — Story 5) [F8-S5]
 */
import { describe, it, expect } from 'vitest';
import { SecretsScanner } from '../scanners/secrets-scanner.js';
import type { ScanContext } from '../scanners/base-scanner.js';

const ctx: ScanContext = { tenantId: 't1', agentId: 'a1', toolName: 'test', direction: 'input' };

describe('SecretsScanner', () => {
  it('detects AWS access key', () => {
    const scanner = new SecretsScanner();
    scanner.compile({ patterns: ['aws_access_key'] });
    const result = scanner.scan('Key: AKIAIOSFODNN7EXAMPLE', ctx);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].patternName).toBe('aws_access_key');
    expect(result.matches[0].confidence).toBe(0.99);
  });

  it('detects GitHub token', () => {
    const scanner = new SecretsScanner();
    scanner.compile({ patterns: ['github_token'] });
    const token = 'ghp_' + 'A'.repeat(36);
    const result = scanner.scan(`Token: ${token}`, ctx);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].redactionToken).toBe('[GITHUB_TOKEN_REDACTED]');
  });

  it('detects OpenAI key', () => {
    const scanner = new SecretsScanner();
    scanner.compile({ patterns: ['openai_key'] });
    const key = 'sk-' + 'A'.repeat(20) + 'T3BlbkFJ' + 'B'.repeat(20);
    const result = scanner.scan(`API key: ${key}`, ctx);
    expect(result.matches).toHaveLength(1);
  });

  it('detects Anthropic key', () => {
    const scanner = new SecretsScanner();
    scanner.compile({ patterns: ['anthropic_key'] });
    const key = 'sk-ant-' + 'A'.repeat(80);
    const result = scanner.scan(`Key: ${key}`, ctx);
    expect(result.matches).toHaveLength(1);
  });

  it('detects Stripe keys', () => {
    const scanner = new SecretsScanner();
    scanner.compile({ patterns: ['stripe_key'] });
    const result = scanner.scan('sk_test_' + 'A'.repeat(24), ctx);
    expect(result.matches).toHaveLength(1);
  });

  it('detects Bearer tokens', () => {
    const scanner = new SecretsScanner();
    scanner.compile({ patterns: ['generic_bearer'] });
    const result = scanner.scan('Authorization: Bearer ' + 'x'.repeat(30), ctx);
    expect(result.matches).toHaveLength(1);
  });

  it('detects PEM private keys', () => {
    const scanner = new SecretsScanner();
    scanner.compile({ patterns: ['private_key_pem'] });
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIBVg...\n-----END PRIVATE KEY-----';
    const result = scanner.scan(`Here's a key: ${pem}`, ctx);
    expect(result.matches).toHaveLength(1);
  });

  it('detects JWTs', () => {
    const scanner = new SecretsScanner();
    scanner.compile({ patterns: ['jwt'] });
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = scanner.scan(`Token: ${jwt}`, ctx);
    expect(result.matches).toHaveLength(1);
  });

  it('supports custom patterns', () => {
    const scanner = new SecretsScanner();
    scanner.compile({
      patterns: [],
      customPatterns: { my_token: 'tok_[A-Za-z0-9]{20,}' },
    });
    const result = scanner.scan('tok_' + 'A'.repeat(20), ctx);
    expect(result.matches).toHaveLength(1);
  });
});
