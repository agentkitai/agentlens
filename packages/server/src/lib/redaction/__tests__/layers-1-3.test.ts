/**
 * Tests for Redaction Layers 1-3 (Story 2.1)
 * SecretDetectionLayer, PIIDetectionLayer, UrlPathScrubbingLayer
 */

import { describe, it, expect } from 'vitest';
import { SecretDetectionLayer } from '../secret-detection-layer.js';
import { PIIDetectionLayer, type PresidioProvider } from '../pii-detection-layer.js';
import { UrlPathScrubbingLayer, DEFAULT_PUBLIC_DOMAINS } from '../url-path-scrubbing-layer.js';
import { shannonEntropy, detectHighEntropyStrings } from '../secret-patterns.js';
import type { RedactionContext } from '@agentlensai/core';

const ctx: RedactionContext = {
  tenantId: 'test-tenant',
  category: 'general',
  denyListPatterns: [],
  knownTenantTerms: [],
};

// ═══════════════════════════════════════════════════════════
// Layer 1: SecretDetectionLayer
// ═══════════════════════════════════════════════════════════

describe('SecretDetectionLayer', () => {
  const layer = new SecretDetectionLayer();

  it('has correct name and order', () => {
    expect(layer.name).toBe('secret_detection');
    expect(layer.order).toBe(100);
  });

  // ─── OpenAI keys ────────────────────────────────────
  it('detects OpenAI API key', () => {
    const result = layer.process('My key is sk-abc123def456ghi789jklmnopqrstuvwxyz', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
    expect(result.output).not.toContain('sk-abc123');
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
  });

  it('detects OpenAI org key', () => {
    const result = layer.process('org-abcdefghijklmnopqrstuvwxyz1234', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  // ─── Anthropic keys ─────────────────────────────────
  it('detects Anthropic API key', () => {
    const result = layer.process('Key: sk-ant-' + 'abcdefghijklmnopqrstuvwxyz', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
    expect(result.output).not.toContain('sk-ant-');
  });

  // ─── GitHub tokens ──────────────────────────────────
  it('detects GitHub PAT', () => {
    const result = layer.process('Token: ghp_' + 'aBcDeFgHiJkLmNoPqRsTuVwXyZ012345678', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  it('detects GitHub OAuth token', () => {
    const result = layer.process('Token: gho_' + 'aBcDeFgHiJkLmNoPqRsTuVwXyZ012345678', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  it('detects GitHub app tokens (ghu, ghs, ghr)', () => {
    const result = layer.process('Token: ghu_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345678', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  // ─── AWS keys ───────────────────────────────────────
  it('detects AWS access key', () => {
    const result = layer.process('AKIAIOSFODNN7EXAMPLE123', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
    expect(result.output).not.toContain('AKIA');
  });

  it('detects AWS secret key assignment', () => {
    const result = layer.process('aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEYZ', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  // ─── Stripe keys ────────────────────────────────────
  it('detects Stripe live key', () => {
    const result = layer.process('sk_live_aBcDeFgHiJkLmNoPqRsTuV', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  it('detects Stripe test key', () => {
    const result = layer.process('sk_test_aBcDeFgHiJkLmNoPqRsTuV', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  it('detects Stripe publishable key', () => {
    const result = layer.process('pk_live_aBcDeFgHiJkLmNoPqRsTuV', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  it('detects Stripe restricted key', () => {
    const result = layer.process('rk_live_aBcDeFgHiJkLmNoPqRsTuV', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  // ─── Slack tokens ───────────────────────────────────
  it('detects Slack bot token', () => {
    const result = layer.process('xoxb-' + '123456-abcdefghij', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  it('detects Slack webhook URL', () => {
    const result = layer.process('https://hooks.slack.com/services/' + 'T12345/B67890/abcdefghijklmnop', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  // ─── Google ─────────────────────────────────────────
  it('detects Google API key', () => {
    const result = layer.process('AIzaSyA1234567890abcdefghijklmnopqrstuv', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  // ─── Twilio ─────────────────────────────────────────
  it('detects Twilio API key', () => {
    const result = layer.process('SK' + 'abcdef01'.repeat(4), ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  it('detects Twilio account SID', () => {
    const result = layer.process('AC' + 'abcdef01'.repeat(4), ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  // ─── SendGrid ───────────────────────────────────────
  it('detects SendGrid API key', () => {
    const result = layer.process('SG.' + 'x'.repeat(22) + '.' + 'Y'.repeat(43), ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  // ─── Mailgun ────────────────────────────────────────
  it('detects Mailgun API key', () => {
    const result = layer.process('key-12345678901234567890123456789012', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  // ─── npm token ──────────────────────────────────────
  it('detects npm token', () => {
    const result = layer.process('npm_' + 'aBcDeFgHiJkLmNoPqRsTuVwXyZ012345678', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  // ─── PyPI token ─────────────────────────────────────
  it('detects PyPI token', () => {
    const result = layer.process('pypi-' + 'AgEIcHlwaS5vcmcCJGI0YjM0NTIxLWE4NTQtNGI2Ny04YTg5LWFjODk', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  // ─── Discord ────────────────────────────────────────
  it('detects Discord webhook', () => {
    const result = layer.process('https://discord.com/api/webhooks/' + '123456789/abcdefghij-klmnop_qrstuv', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  // ─── Bearer / Basic Auth ────────────────────────────
  it('detects Bearer token', () => {
    const result = layer.process('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
    expect(result.output).not.toContain('eyJ');
  });

  it('detects Basic auth', () => {
    const result = layer.process('Authorization: Basic dXNlcjpwYXNzd29yZA==', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  // ─── URL with credentials ──────────────────────────
  it('detects URL with password', () => {
    const result = layer.process('postgres://admin:secretpass@db.example.com:5432/mydb', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
    expect(result.output).not.toContain('secretpass');
  });

  // ─── Private keys ──────────────────────────────────
  it('detects private key header', () => {
    const result = layer.process('-----BEGIN RSA PRIVATE KEY-----\nMIIEow...', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  it('detects generic private key header', () => {
    const result = layer.process('-----BEGIN PRIVATE KEY-----\nMIIEow...', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  // ─── Connection strings ─────────────────────────────
  it('detects MongoDB connection string', () => {
    const result = layer.process('mongodb+srv://user:pass@cluster.example.net/db', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  it('detects PostgreSQL connection string', () => {
    const result = layer.process('postgresql://user:pass@localhost:5432/mydb', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  it('detects Redis connection string', () => {
    const result = layer.process('redis://user:pass@redis.example.com:6379', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  // ─── JWT ────────────────────────────────────────────
  it('detects JWT token', () => {
    const result = layer.process('token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  // ─── Vault token ────────────────────────────────────
  it('detects HashiCorp Vault token', () => {
    const result = layer.process('hvs.abcdefghijklmnopqrstuvwx', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  // ─── Vercel token ───────────────────────────────────
  it('detects Vercel token', () => {
    const result = layer.process('vercel_abcdefghijklmnopqrstuvwx', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  // ─── Password assignments ──────────────────────────
  it('detects password assignment', () => {
    const result = layer.process('password = "mySuperSecretPass123"', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  it('detects API key assignment', () => {
    const result = layer.process('api_key: my-secret-api-key-value', ctx);
    expect(result.output).toContain('[SECRET_REDACTED_');
  });

  // ─── Clean text ─────────────────────────────────────
  it('passes through clean text without findings', () => {
    const result = layer.process('This is a normal lesson about error handling patterns.', ctx);
    expect(result.output).toBe('This is a normal lesson about error handling patterns.');
    expect(result.findings).toHaveLength(0);
  });

  // ─── Multiple secrets ──────────────────────────────
  it('detects multiple secrets in one text', () => {
    const text = 'Use sk-abc123def456ghi789jklmnopqrstuvwxyz and AKIAIOSFODNN7EXAMPLE123 for access';
    const result = layer.process(text, ctx);
    expect(result.findings.length).toBeGreaterThanOrEqual(2);
    expect(result.output).not.toContain('sk-abc123');
    expect(result.output).not.toContain('AKIA');
  });

  it('assigns sequential redaction indices', () => {
    const text = 'key1: sk-abc123def456ghi789jklmnopqrstuvwxyz key2: ' + 'ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345678';
    const result = layer.process(text, ctx);
    expect(result.output).toContain('[SECRET_REDACTED_1]');
    expect(result.output).toContain('[SECRET_REDACTED_2]');
  });

  // ─── Findings structure ─────────────────────────────
  it('produces correct finding structure', () => {
    const result = layer.process('key: sk-abc123def456ghi789jklmnopqrstuvwxyz', ctx);
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    const finding = result.findings[0];
    expect(finding.layer).toBe('secret_detection');
    expect(finding.category).toBeTruthy();
    expect(finding.originalLength).toBeGreaterThan(0);
    expect(finding.replacement).toMatch(/\[SECRET_REDACTED_\d+\]/);
    expect(finding.confidence).toBeGreaterThan(0);
    expect(finding.startOffset).toBeGreaterThanOrEqual(0);
    expect(finding.endOffset).toBeGreaterThan(finding.startOffset);
  });

  it('never blocks (layer 1 only redacts)', () => {
    const result = layer.process('sk-abc123def456ghi789jklmnopqrstuvwxyz AKIAIOSFODNN7EXAMPLE123', ctx);
    expect(result.blocked).toBe(false);
  });
});

// ─── Shannon Entropy ────────────────────────────────────────

describe('Shannon Entropy', () => {
  it('returns 0 for empty string', () => {
    expect(shannonEntropy('')).toBe(0);
  });

  it('returns 0 for single character repeated', () => {
    expect(shannonEntropy('aaaaaaa')).toBe(0);
  });

  it('returns 1 for two equally distributed characters', () => {
    expect(shannonEntropy('abababab')).toBeCloseTo(1.0, 1);
  });

  it('returns high entropy for random hex string', () => {
    const entropy = shannonEntropy('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
    expect(entropy).toBeGreaterThan(3.5);
  });

  it('returns higher entropy for random base64', () => {
    const entropy = shannonEntropy('aB3cD9eF1gH5iJ7kL2mN8oP4qR6sT0uV');
    expect(entropy).toBeGreaterThan(4.0);
  });
});

describe('High Entropy Detection', () => {
  it('detects high-entropy base64 string', () => {
    // Base64 with many distinct chars → high Shannon entropy > 4.5
    const text = 'token: aB3cD9eF1gH5iJ7kL2mN8oP4qR6sT0uVwXyZAbCdEfGhIjKlMn';
    const results = detectHighEntropyStrings(text);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('skips short strings', () => {
    const results = detectHighEntropyStrings('short: abcdef');
    expect(results).toHaveLength(0);
  });

  it('skips normal English words', () => {
    const results = detectHighEntropyStrings('This is a normal sentence about programming');
    expect(results).toHaveLength(0);
  });

  it('respects custom threshold', () => {
    const text = 'token: a1b2c3d4e5f6a7b8c9d0e1f2';
    const loose = detectHighEntropyStrings(text, { entropyThreshold: 3.0 });
    const strict = detectHighEntropyStrings(text, { entropyThreshold: 5.0 });
    expect(loose.length).toBeGreaterThanOrEqual(strict.length);
  });
});

// ═══════════════════════════════════════════════════════════
// Layer 2: PIIDetectionLayer
// ═══════════════════════════════════════════════════════════

describe('PIIDetectionLayer', () => {
  const layer = new PIIDetectionLayer();

  it('has correct name and order', () => {
    expect(layer.name).toBe('pii_detection');
    expect(layer.order).toBe(200);
  });

  // ─── Email ──────────────────────────────────────────
  it('detects email address', async () => {
    const result = await layer.process('Contact john.doe@example.com for help', ctx);
    expect(result.output).toContain('[EMAIL]');
    expect(result.output).not.toContain('john.doe@example.com');
  });

  it('detects multiple emails', async () => {
    const result = await layer.process('Emails: a@b.com and c@d.org', ctx);
    expect(result.output.match(/\[EMAIL\]/g)?.length).toBe(2);
  });

  it('detects email with plus addressing', async () => {
    const result = await layer.process('user+tag@example.com', ctx);
    expect(result.output).toContain('[EMAIL]');
  });

  // ─── Phone ──────────────────────────────────────────
  it('detects US phone number', async () => {
    const result = await layer.process('Call 555-123-4567', ctx);
    expect(result.output).toContain('[PHONE]');
  });

  it('detects phone with country code', async () => {
    const result = await layer.process('Call +1-555-123-4567', ctx);
    expect(result.output).toContain('[PHONE]');
  });

  it('detects phone with parentheses', async () => {
    const result = await layer.process('Call (555) 123-4567', ctx);
    expect(result.output).toContain('[PHONE]');
  });

  it('detects phone with dots', async () => {
    const result = await layer.process('Call 555.123.4567', ctx);
    expect(result.output).toContain('[PHONE]');
  });

  // ─── SSN ────────────────────────────────────────────
  it('detects SSN', async () => {
    const result = await layer.process('SSN: 123-45-6789', ctx);
    expect(result.output).toContain('[SSN]');
    expect(result.output).not.toContain('123-45-6789');
  });

  // ─── Credit Card ────────────────────────────────────
  it('detects credit card with spaces', async () => {
    const result = await layer.process('Card: 4532 0151 2345 6789', ctx);
    // 4532015123456789 passes Luhn
    expect(result.output).toContain('[CREDIT_CARD]');
  });

  it('detects credit card with dashes', async () => {
    const result = await layer.process('Card: 4532-0151-2345-6789', ctx);
    expect(result.output).toContain('[CREDIT_CARD]');
  });

  it('rejects invalid credit card (fails Luhn)', async () => {
    const result = await layer.process('Not a card: 1234-5678-9012-3456', ctx);
    // 1234567890123456 fails Luhn
    expect(result.output).not.toContain('[CREDIT_CARD]');
  });

  // ─── IP Address ─────────────────────────────────────
  it('detects IP address', async () => {
    const result = await layer.process('Server at 192.168.1.100', ctx);
    expect(result.output).toContain('[IP_ADDRESS]');
  });

  it('detects multiple IP addresses', async () => {
    const result = await layer.process('Servers: 10.0.0.1 and 172.16.0.1', ctx);
    expect(result.output.match(/\[IP_ADDRESS\]/g)?.length).toBe(2);
  });

  // ─── Clean text ─────────────────────────────────────
  it('passes through clean text', async () => {
    const result = await layer.process('This is a clean lesson about patterns.', ctx);
    expect(result.output).toBe('This is a clean lesson about patterns.');
    expect(result.findings).toHaveLength(0);
  });

  // ─── Multiple PII types ─────────────────────────────
  it('detects multiple PII types', async () => {
    const text = 'Contact john@example.com or call 555-123-4567. SSN: 123-45-6789';
    const result = await layer.process(text, ctx);
    expect(result.output).toContain('[EMAIL]');
    expect(result.output).toContain('[PHONE]');
    expect(result.output).toContain('[SSN]');
  });

  // ─── Findings structure ─────────────────────────────
  it('produces correct finding structure', async () => {
    const result = await layer.process('Email: test@example.com', ctx);
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0];
    expect(f.layer).toBe('pii_detection');
    expect(f.category).toBe('email');
    expect(f.replacement).toBe('[EMAIL]');
    expect(f.confidence).toBeGreaterThan(0);
  });

  it('never blocks', async () => {
    const result = await layer.process('john@example.com 123-45-6789', ctx);
    expect(result.blocked).toBe(false);
  });

  // ─── Presidio integration ───────────────────────────
  it('uses Presidio provider when available', async () => {
    const mockPresidio: PresidioProvider = {
      analyze: async () => [
        { entityType: 'PERSON', start: 0, end: 8, score: 0.95 },
      ],
    };
    const layerWithPresidio = new PIIDetectionLayer(mockPresidio);
    const result = await layerWithPresidio.process('John Doe is a developer', ctx);
    expect(result.output).toContain('[PERSON]');
    expect(result.findings.some(f => f.category === 'person')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// Layer 3: UrlPathScrubbingLayer
// ═══════════════════════════════════════════════════════════

describe('UrlPathScrubbingLayer', () => {
  const layer = new UrlPathScrubbingLayer();

  it('has correct name and order', () => {
    expect(layer.name).toBe('url_path_scrubbing');
    expect(layer.order).toBe(300);
  });

  // ─── Public URLs preserved ──────────────────────────
  it('preserves github.com URLs', () => {
    const text = 'See https://github.com/user/repo for details';
    const result = layer.process(text, ctx);
    expect(result.output).toContain('https://github.com/user/repo');
    expect(result.findings).toHaveLength(0);
  });

  it('preserves stackoverflow.com URLs', () => {
    const text = 'Answer: https://stackoverflow.com/questions/12345';
    const result = layer.process(text, ctx);
    expect(result.output).toContain('https://stackoverflow.com/questions/12345');
  });

  it('preserves docs.python.org URLs', () => {
    const text = 'See https://docs.python.org/3/library/os.html';
    const result = layer.process(text, ctx);
    expect(result.output).toContain('https://docs.python.org');
  });

  // ─── Internal URLs detected ─────────────────────────
  it('detects localhost URL', () => {
    const result = layer.process('API at http://localhost:3000/api', ctx);
    expect(result.output).toContain('[INTERNAL_URL]');
  });

  it('detects .local URL', () => {
    const result = layer.process('Server: http://myserver.local:8080/app', ctx);
    expect(result.output).toContain('[INTERNAL_URL]');
  });

  it('detects .internal URL', () => {
    const result = layer.process('http://api.service.internal/v1', ctx);
    expect(result.output).toContain('[INTERNAL_URL]');
  });

  it('detects .corp URL', () => {
    const result = layer.process('http://jira.acme.corp/browse/PROJ-123', ctx);
    expect(result.output).toContain('[INTERNAL_URL]');
  });

  it('detects URL with private IP', () => {
    const result = layer.process('http://192.168.1.100:8080/api', ctx);
    expect(result.output).toContain('[INTERNAL_URL]');
  });

  it('detects URL with 10.x IP', () => {
    const result = layer.process('http://10.0.0.1:3000/health', ctx);
    expect(result.output).toContain('[INTERNAL_URL]');
  });

  // ─── Private IPs ────────────────────────────────────
  it('detects 10.x.x.x IP', () => {
    const result = layer.process('Server IP: 10.0.0.1', ctx);
    expect(result.output).toContain('[PRIVATE_IP]');
  });

  it('detects 172.16.x.x IP', () => {
    const result = layer.process('Server IP: 172.16.0.1', ctx);
    expect(result.output).toContain('[PRIVATE_IP]');
  });

  it('detects 172.31.x.x IP', () => {
    const result = layer.process('Server IP: 172.31.255.255', ctx);
    expect(result.output).toContain('[PRIVATE_IP]');
  });

  it('detects 192.168.x.x IP', () => {
    const result = layer.process('Server IP: 192.168.0.1', ctx);
    expect(result.output).toContain('[PRIVATE_IP]');
  });

  it('detects 127.x.x.x IP', () => {
    const result = layer.process('Loopback: 127.0.0.1', ctx);
    expect(result.output).toContain('[PRIVATE_IP]');
  });

  // ─── File paths ─────────────────────────────────────
  it('detects Unix home path', () => {
    const result = layer.process('Config at /home/user/.config/app', ctx);
    expect(result.output).toContain('[FILE_PATH]');
    expect(result.output).not.toContain('/home/user');
  });

  it('detects /etc path', () => {
    const result = layer.process('See /etc/nginx/nginx.conf', ctx);
    expect(result.output).toContain('[FILE_PATH]');
  });

  it('detects /var path', () => {
    const result = layer.process('Logs at /var/log/app.log', ctx);
    expect(result.output).toContain('[FILE_PATH]');
  });

  it('detects /Users macOS path', () => {
    const result = layer.process('File at /Users/john/Documents/file.txt', ctx);
    expect(result.output).toContain('[FILE_PATH]');
  });

  it('detects Windows C:\\ path', () => {
    const result = layer.process('File at C:\\Users\\john\\Documents\\file.txt', ctx);
    expect(result.output).toContain('[FILE_PATH]');
  });

  it('detects UNC path', () => {
    const result = layer.process('Share at \\\\fileserver\\share\\docs', ctx);
    expect(result.output).toContain('[FILE_PATH]');
  });

  it('detects /tmp path', () => {
    const result = layer.process('Temp file: /tmp/data.json', ctx);
    expect(result.output).toContain('[FILE_PATH]');
  });

  // ─── Clean text ─────────────────────────────────────
  it('passes through clean text', () => {
    const result = layer.process('This is a lesson about error handling patterns.', ctx);
    expect(result.output).toBe('This is a lesson about error handling patterns.');
    expect(result.findings).toHaveLength(0);
  });

  // ─── Mixed content ──────────────────────────────────
  it('handles mixed public and internal URLs', () => {
    const text = 'See https://github.com/user/repo and http://localhost:3000/api';
    const result = layer.process(text, ctx);
    expect(result.output).toContain('https://github.com/user/repo');
    expect(result.output).toContain('[INTERNAL_URL]');
  });

  it('handles multiple file paths', () => {
    const text = 'Config: /etc/app.conf, logs: /var/log/app.log';
    const result = layer.process(text, ctx);
    expect(result.output.match(/\[FILE_PATH\]/g)?.length).toBe(2);
  });

  // ─── Findings structure ─────────────────────────────
  it('produces correct finding structure for internal URL', () => {
    const result = layer.process('http://localhost:3000/api', ctx);
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0];
    expect(f.layer).toBe('url_path_scrubbing');
    expect(f.category).toBe('internal_url');
    expect(f.replacement).toBe('[INTERNAL_URL]');
  });

  it('produces correct finding for file path', () => {
    const result = layer.process('/home/user/file.txt', ctx);
    const f = result.findings[0];
    expect(f.category).toBe('file_path');
    expect(f.replacement).toBe('[FILE_PATH]');
  });

  it('produces correct finding for private IP', () => {
    const result = layer.process('IP: 10.0.0.1', ctx);
    const f = result.findings[0];
    expect(f.category).toBe('private_ip');
    expect(f.replacement).toBe('[PRIVATE_IP]');
  });

  it('never blocks', () => {
    const result = layer.process('http://localhost:3000 /home/user /etc/passwd 10.0.0.1', ctx);
    expect(result.blocked).toBe(false);
  });

  // ─── Custom allowlist ───────────────────────────────
  it('accepts custom public domain allowlist', () => {
    const customLayer = new UrlPathScrubbingLayer(['mycompany.com']);
    const result = customLayer.process('See https://mycompany.com/docs', ctx);
    expect(result.output).toContain('https://mycompany.com/docs');
    expect(result.findings).toHaveLength(0);
  });

  // ─── Default allowlist ──────────────────────────────
  it('has a comprehensive default allowlist', () => {
    expect(DEFAULT_PUBLIC_DOMAINS.has('github.com')).toBe(true);
    expect(DEFAULT_PUBLIC_DOMAINS.has('stackoverflow.com')).toBe(true);
    expect(DEFAULT_PUBLIC_DOMAINS.has('npmjs.com')).toBe(true);
    expect(DEFAULT_PUBLIC_DOMAINS.has('openai.com')).toBe(true);
    expect(DEFAULT_PUBLIC_DOMAINS.size).toBeGreaterThan(20);
  });
});
