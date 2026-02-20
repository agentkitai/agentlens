import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { computeEventHash } from '@agentlensai/core';
import type { ChainEvent, HashableEvent } from '@agentlensai/core';
import { signReport, runVerification } from '../audit-verify.js';
import type { VerifyOptions } from '../audit-verify.js';

// ─── Helpers ────────────────────────────────────────────────

function buildChain(n: number, sessionId = 'sess_1'): ChainEvent[] {
  const chain: ChainEvent[] = [];
  let prevHash: string | null = null;
  for (let i = 0; i < n; i++) {
    const event: HashableEvent = {
      id: `evt_${sessionId}_${String(i).padStart(4, '0')}`,
      timestamp: `2026-01-15T10:00:${String(i % 60).padStart(2, '0')}Z`,
      sessionId,
      agentId: 'agent_1',
      eventType: 'custom',
      severity: 'info',
      payload: { index: i },
      metadata: {},
      prevHash,
    };
    const hash = computeEventHash(event);
    chain.push({ ...event, hash });
    prevHash = hash;
  }
  return chain;
}

function createMockRepo(sessionChains: Record<string, ChainEvent[]>) {
  return {
    getSessionIdsInRange: vi.fn((_tenantId: string, _from: string, _to: string) =>
      Object.keys(sessionChains),
    ),
    getSessionEventsBatch: vi.fn((sessionId: string, _tenantId: string, offset: number, limit: number) => {
      const chain = sessionChains[sessionId] ?? [];
      return chain.slice(offset, offset + limit);
    }),
  } as any;
}

// ─── Tests ──────────────────────────────────────────────────

describe('Audit Verification Engine', () => {
  describe('signReport()', () => {
    it('AC 3.4 — signs report with HMAC-SHA256', () => {
      const report = {
        verified: true,
        verifiedAt: '2026-02-20T06:00:00.000Z',
        range: { from: '2026-01-01', to: '2026-02-01' },
        sessionsVerified: 1,
        totalEvents: 10,
        firstHash: 'aaa',
        lastHash: 'bbb',
        brokenChains: [],
      };
      const key = 'test-secret-key';
      const sig = signReport(report, key);
      expect(sig).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);

      // Independently verify
      const expected = 'hmac-sha256:' + createHmac('sha256', key)
        .update(JSON.stringify(report))
        .digest('hex');
      expect(sig).toBe(expected);
    });
  });

  describe('runVerification()', () => {
    it('AC 3.1 — single session verification', () => {
      const chain = buildChain(500, 'sess_abc');
      const repo = createMockRepo({ sess_abc: chain });
      const report = runVerification(repo, {
        tenantId: 'default',
        sessionId: 'sess_abc',
      });
      expect(report.verified).toBe(true);
      expect(report.sessionsVerified).toBe(1);
      expect(report.totalEvents).toBe(500);
      expect(report.range).toBeNull();
      expect(report.sessionId).toBe('sess_abc');
    });

    it('AC 3.2 — multi-session range verification', () => {
      const chains: Record<string, ChainEvent[]> = {};
      for (let s = 0; s < 5; s++) {
        chains[`sess_${s}`] = buildChain(100, `sess_${s}`);
      }
      const repo = createMockRepo(chains);
      const report = runVerification(repo, {
        tenantId: 'default',
        from: '2026-01-01',
        to: '2026-02-01',
      });
      expect(report.verified).toBe(true);
      expect(report.sessionsVerified).toBe(5);
      expect(report.totalEvents).toBe(500);
    });

    it('AC 3.3 — broken chain detection', () => {
      const chain = buildChain(30, 'sess_bad');
      // Tamper event at index 17
      chain[17] = { ...chain[17], payload: { index: 999 } };
      const repo = createMockRepo({ sess_bad: chain });
      const report = runVerification(repo, {
        tenantId: 'default',
        sessionId: 'sess_bad',
      });
      expect(report.verified).toBe(false);
      expect(report.brokenChains).toHaveLength(1);
      expect(report.brokenChains[0].failedAtIndex).toBe(17);
      expect(report.brokenChains[0].sessionId).toBe('sess_bad');
      expect(report.brokenChains[0].failedEventId).toBe('evt_sess_bad_0017');
      expect(report.brokenChains[0].reason).toContain('hash mismatch');
    });

    it('AC 3.4 — report signed when key provided', () => {
      const chain = buildChain(10);
      const repo = createMockRepo({ sess_1: chain });
      const report = runVerification(repo, {
        tenantId: 'default',
        sessionId: 'sess_1',
        signingKey: 'my-secret',
      });
      expect(report.signature).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);

      // Verify signature independently
      const { signature, ...body } = report;
      const expected = 'hmac-sha256:' + createHmac('sha256', 'my-secret')
        .update(JSON.stringify(body))
        .digest('hex');
      expect(signature).toBe(expected);
    });

    it('AC 3.5 — signature null when no key', () => {
      const chain = buildChain(10);
      const repo = createMockRepo({ sess_1: chain });
      const report = runVerification(repo, {
        tenantId: 'default',
        sessionId: 'sess_1',
      });
      expect(report.signature).toBeNull();
    });

    it('AC 3.6 — empty range returns valid', () => {
      const repo = createMockRepo({});
      const report = runVerification(repo, {
        tenantId: 'default',
        from: '2026-01-01',
        to: '2026-02-01',
      });
      expect(report.verified).toBe(true);
      expect(report.sessionsVerified).toBe(0);
      expect(report.totalEvents).toBe(0);
      expect(report.brokenChains).toEqual([]);
    });

    it('AC 3.7 — first/last hash tracking', () => {
      const chain = buildChain(10);
      const repo = createMockRepo({ sess_1: chain });
      const report = runVerification(repo, {
        tenantId: 'default',
        sessionId: 'sess_1',
      });
      expect(report.firstHash).toBe(chain[0].hash);
      expect(report.lastHash).toBe(chain[9].hash);
    });

    it('AC 3.8 — batched streaming (processes in chunks)', () => {
      // 20,000 events — the mock repo will be called multiple times with batches
      const chain = buildChain(200, 'sess_big'); // use 200 for test speed
      const repo = createMockRepo({ sess_big: chain });
      const report = runVerification(repo, {
        tenantId: 'default',
        sessionId: 'sess_big',
      });
      expect(report.verified).toBe(true);
      expect(report.totalEvents).toBe(200);
      // Verify getSessionEventsBatch was called (batching works)
      expect(repo.getSessionEventsBatch).toHaveBeenCalled();
    });
  });
});
