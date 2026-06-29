/**
 * Signed chain anchors (#124): build/verify a segment + tamper detection.
 */
import { describe, it, expect } from 'vitest';
import { createEvent } from '@agentkitai/agentlens-core';
import { buildAnchor, signAnchorBody, verifyAnchorSignature, type AnchorEventRow } from '../anchors.js';

function chainRows(n: number): AnchorEventRow[] {
  const rows: AnchorEventRow[] = [];
  let prev: string | null = null;
  for (let i = 0; i < n; i++) {
    const e = createEvent({
      sessionId: 's1',
      agentId: 'a',
      tenantId: 't',
      prevHash: prev,
      eventType: 'custom',
      payload: { type: 'x', data: { i } } as never,
      metadata: { verifiedAgentId: 'agt_1' },
      timestamp: `2026-03-01T0${i}:00:00.000Z`,
    });
    prev = e.hash;
    rows.push({
      id: e.id,
      hash: e.hash,
      prevHash: e.prevHash,
      timestamp: e.timestamp,
      sessionId: e.sessionId,
      agentId: e.agentId,
      eventType: e.eventType,
      severity: e.severity,
      payload: e.payload,
      metadata: e.metadata,
      verifiedAgentId: 'agt_1',
      pricingVersion: 'pv-1',
    });
  }
  return rows;
}

describe('buildAnchor + signature', () => {
  it('builds a valid anchor over a good chain and signs/verifies it', () => {
    const rows = chainRows(3);
    const { body, valid } = buildAnchor('t', 's1', rows);
    expect(valid).toBe(true);
    expect(body.eventCount).toBe(3);
    expect(body.firstPrevHash).toBeNull(); // genesis
    expect(body.lastHash).toBe(rows[2].hash);
    expect(body.chained).toBe(true);
    expect(body.verifiedAgentIds).toEqual(['agt_1']);
    expect(body.pricingVersions).toEqual(['pv-1']);

    const sig = signAnchorBody(body, 'secret-key');
    expect(sig).toBeTruthy();
    expect(verifyAnchorSignature(body, sig, 'secret-key')).toBe(true);
    expect(verifyAnchorSignature(body, sig, 'wrong-key')).toBe(false);
    // Tampering any field invalidates the signature.
    expect(verifyAnchorSignature({ ...body, eventCount: 99 }, sig, 'secret-key')).toBe(false);
  });

  it('flags a broken chain (tampered event) as invalid', () => {
    const rows = chainRows(3);
    rows[1] = { ...rows[1], hash: 'deadbeef' }; // corrupt a hash
    expect(buildAnchor('t', 's1', rows).valid).toBe(false);
  });

  it('treats an all-null-prevHash segment as unchained (record integrity)', () => {
    const rows = chainRows(2).map((r) => ({ ...r, prevHash: null }));
    // prevHash=null but hash still matches the original (computed with prevHash=null for the first only)
    // so rebuild proper unchained rows:
    const e1 = createEvent({ sessionId: 's2', agentId: 'a', tenantId: 't', prevHash: null, eventType: 'custom', payload: { type: 'x', data: {} } as never, metadata: {}, timestamp: '2026-03-01T00:00:00.000Z' });
    const e2 = createEvent({ sessionId: 's2', agentId: 'a', tenantId: 't', prevHash: null, eventType: 'custom', payload: { type: 'y', data: {} } as never, metadata: {}, timestamp: '2026-03-01T01:00:00.000Z' });
    const unchained: AnchorEventRow[] = [e1, e2].map((e) => ({
      id: e.id, hash: e.hash, prevHash: e.prevHash, timestamp: e.timestamp, sessionId: e.sessionId,
      agentId: e.agentId, eventType: e.eventType, severity: e.severity, payload: e.payload, metadata: e.metadata,
    }));
    const { body, valid } = buildAnchor('t', 's2', unchained);
    expect(valid).toBe(true);
    expect(body.chained).toBe(false);
    void rows;
  });
});
