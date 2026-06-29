/**
 * HMAC-signed webhook payloads (#125).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { webhookSignatureHeaders, verifyWebhookSignature } from '../providers/webhook.js';

afterEach(() => {
  delete process.env.AGENTLENS_WEBHOOK_SIGNING_SECRET;
});

describe('webhook signing', () => {
  const body = JSON.stringify({ event: 'export.completed', ref: 'abc' });
  const ts = '2026-03-01T10:00:00.000Z';

  it('omits the signature when no secret is configured', () => {
    expect(webhookSignatureHeaders(body, ts)).toEqual({});
  });

  it('signs with the secret and round-trips verification', () => {
    process.env.AGENTLENS_WEBHOOK_SIGNING_SECRET = 'whsec_123';
    const headers = webhookSignatureHeaders(body, ts);
    expect(headers['X-AgentLens-Timestamp']).toBe(ts);
    expect(headers['X-AgentLens-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);

    const sig = headers['X-AgentLens-Signature']!;
    expect(verifyWebhookSignature(body, sig, ts, 'whsec_123')).toBe(true);
    expect(verifyWebhookSignature(body + 'x', sig, ts, 'whsec_123')).toBe(false); // tampered body
    expect(verifyWebhookSignature(body, sig, ts, 'wrong')).toBe(false); // wrong secret
    expect(verifyWebhookSignature(body, sig, '2099-01-01T00:00:00Z', 'whsec_123')).toBe(false); // replayed ts
  });
});
