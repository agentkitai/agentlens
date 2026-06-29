/**
 * Signed exports + JWKS (#125): Ed25519 sign/verify with the PUBLIC key only,
 * self-describing SDK-chained vs OTLP record-integrity tagging, and the route.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createEvent } from '@agentkitai/agentlens-core';
import { createTestApp, authHeaders, type TestContext } from '../../__tests__/test-helpers.js';
import { buildSignedExportBody } from '../exports.js';
import { signExport, verifyExport, getPublicJwk, getJwks } from '../../lib/export-signing.js';

describe('Ed25519 export signing', () => {
  it('verifies with the PUBLIC key only and rejects tampering', () => {
    const body = { kind: 'x', n: 1, items: ['a', 'b'] };
    const sig = signExport(body);
    expect(sig.type).toBe('ed25519');
    expect(sig.kid).toBe(getPublicJwk().kid);

    // A third party verifies with only the published public JWK — no secret.
    expect(verifyExport(body, sig, getPublicJwk())).toBe(true);
    // Tampered body fails.
    expect(verifyExport({ ...body, n: 2 }, sig, getPublicJwk())).toBe(false);
    // A different (unrelated) key fails.
    const otherJwk = { ...getPublicJwk(), x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
    expect(verifyExport(body, sig, otherJwk)).toBe(false);
  });

  it('publishes a JWKS with a usable OKP key', () => {
    const jwks = getJwks();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ kty: 'OKP', crv: 'Ed25519', use: 'sig', alg: 'EdDSA' });
    expect(jwks.keys[0].x).toBeTruthy();
  });
});

describe('buildSignedExportBody — self-describing integrity', () => {
  it('marks SDK-chained events chainCovered + carries verified id and cost', () => {
    const e1 = createEvent({ sessionId: 's', agentId: 'a', tenantId: 't', prevHash: null, eventType: 'llm_call',
      payload: { model: 'gpt-4o' } as never, metadata: { verifiedAgentId: 'agt_1', verifiedAgentMethod: 'jwks' }, timestamp: '2026-03-01T10:00:00.000Z' });
    const e2 = createEvent({ sessionId: 's', agentId: 'a', tenantId: 't', prevHash: e1.hash, eventType: 'llm_response',
      payload: { model: 'gpt-4o', costUsd: 0.05 } as never, metadata: { verifiedAgentId: 'agt_1', verifiedAgentMethod: 'jwks' }, timestamp: '2026-03-01T10:00:01.000Z' });
    const body = buildSignedExportBody('s', [e1, e2], '2026-03-01T11:00:00.000Z');
    expect(body.chained).toBe(true);
    expect(body.chainValid).toBe(true);
    expect(body.events.every((e) => e.chainCovered)).toBe(true);
    expect(body.events[1]).toMatchObject({ verifiedAgentId: 'agt_1', verifiedAgentMethod: 'jwks', costUsd: 0.05 });
  });

  it('marks OTLP (prevHash=null) events record-integrity only', () => {
    const a = createEvent({ sessionId: 'o', agentId: 'a', tenantId: 't', prevHash: null, eventType: 'custom', payload: { type: 'x', data: {} } as never, metadata: {}, timestamp: '2026-03-01T10:00:00.000Z' });
    const b = createEvent({ sessionId: 'o', agentId: 'a', tenantId: 't', prevHash: null, eventType: 'custom', payload: { type: 'y', data: {} } as never, metadata: {}, timestamp: '2026-03-01T10:00:01.000Z' });
    const body = buildSignedExportBody('o', [a, b], '2026-03-01T11:00:00.000Z');
    expect(body.chained).toBe(false); // not a linear chain
    expect(body.events.every((e) => !e.chainCovered)).toBe(true);
  });
});

describe('exports routes', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it('signs a session export that verifies against the public JWKS', async () => {
    const e1 = createEvent({ sessionId: 'sess1', agentId: 'a', tenantId: 'default', prevHash: null, eventType: 'llm_call', payload: { model: 'gpt-4o' } as never, metadata: { verifiedAgentId: 'agt_1' }, timestamp: '2026-03-01T10:00:00.000Z' });
    const e2 = createEvent({ sessionId: 'sess1', agentId: 'a', tenantId: 'default', prevHash: e1.hash, eventType: 'llm_response', payload: { model: 'gpt-4o', costUsd: 0.05 } as never, metadata: { verifiedAgentId: 'agt_1' }, timestamp: '2026-03-01T10:00:01.000Z' });
    await ctx.store.insertEvents([e1, e2]);

    const res = await ctx.app.request('/api/exports/sign', {
      method: 'POST',
      headers: { ...authHeaders(ctx.apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess1' }),
    });
    expect(res.status).toBe(200);
    const { export: body, signature } = (await res.json()) as any;
    expect(body.totalEvents).toBe(2);
    expect(body.chainValid).toBe(true);
    // Verify offline with the public key only.
    expect(verifyExport(body, signature, getPublicJwk())).toBe(true);
    // Tamper detection.
    body.events[0].costUsd = 999;
    expect(verifyExport(body, signature, getPublicJwk())).toBe(false);

    // JWKS endpoint is public (no auth header).
    const jwksRes = await ctx.app.request('/.well-known/jwks.json');
    expect(jwksRes.status).toBe(200);
    expect(((await jwksRes.json()) as any).keys[0].kty).toBe('OKP');
  });
});
