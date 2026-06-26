/**
 * Evidence helpers (#98) — product tagging, canonical JSON, HMAC sign/verify.
 */
import { describe, it, expect } from 'vitest';
import {
  productForEventType,
  canonicalJson,
  signEvidencePack,
  verifyEvidencePackSignature,
  type EvidencePackBody,
  type SignedEvidencePack,
} from '../evidence.js';

const KEY = 'evidence-signing-key-at-least-32-chars-long!';

function pack(): EvidencePackBody {
  return {
    kind: 'agentlens.evidence-pack/v1',
    exportedAt: '2026-06-26T00:00:00.000Z',
    tenantId: 'default',
    verifiedAgentId: 'agt_x',
    range: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-26T00:00:00.000Z' },
    eventTypes: null,
    totalEvents: 1,
    chains: [{ sessionId: 's1', verified: true, firstHash: 'h0', lastHash: 'h1' }],
    events: [
      { id: 'e1', timestamp: '2026-06-10T00:00:00.000Z', sessionId: 's1', agentId: 'agt_x', eventType: 'tool_call', product: 'agentlens', severity: 'info', verifiedAgentMethod: 'agentgate_jwks', hash: 'h1' },
    ],
  };
}

describe('productForEventType', () => {
  it('maps event classes to their source product', () => {
    expect(productForEventType('approval_requested')).toBe('agentgate');
    expect(productForEventType('form_submitted')).toBe('formbridge');
    expect(productForEventType('eval_result')).toBe('eval');
    expect(productForEventType('tool_call')).toBe('agentlens');
    expect(productForEventType('llm_response')).toBe('agentlens');
  });
});

describe('canonicalJson', () => {
  it('is independent of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });
});

describe('sign + verify', () => {
  it('round-trips a freshly signed pack', () => {
    const body = pack();
    const signature = signEvidencePack(body, KEY);
    expect(signature.type).toBe('hmac');
    const signed: SignedEvidencePack = { ...body, signature };
    expect(verifyEvidencePackSignature(signed, KEY)).toEqual({ valid: true });
  });

  it('verifies regardless of key order in the round-tripped pack', () => {
    const body = pack();
    const signed: SignedEvidencePack = { ...body, signature: signEvidencePack(body, KEY) };
    // Simulate a JSON round-trip that reorders keys.
    const reordered = JSON.parse(JSON.stringify({ signature: signed.signature, ...body })) as SignedEvidencePack;
    expect(verifyEvidencePackSignature(reordered, KEY).valid).toBe(true);
  });

  it('rejects a tampered pack', () => {
    const body = pack();
    const signed: SignedEvidencePack = { ...body, signature: signEvidencePack(body, KEY) };
    signed.totalEvents = 999; // tamper after signing
    expect(verifyEvidencePackSignature(signed, KEY).valid).toBe(false);
  });

  it('rejects a wrong signing key', () => {
    const body = pack();
    const signed: SignedEvidencePack = { ...body, signature: signEvidencePack(body, KEY) };
    expect(verifyEvidencePackSignature(signed, 'a-different-key-also-32-chars-long-xx!').valid).toBe(false);
  });

  it('rejects a pack with no signature', () => {
    expect(verifyEvidencePackSignature({ ...pack(), signature: null }, KEY).valid).toBe(false);
  });
});
