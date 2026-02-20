import { describe, it, expect, vi } from 'vitest';
import { computeEventHash } from '@agentlensai/core';
import type { ChainEvent, HashableEvent } from '@agentlensai/core';
import { runVerification } from '../audit-verify.js';

/**
 * Benchmark test for batched streaming verification (F3-S7).
 * Demonstrates that the batching mechanism handles large chains efficiently.
 */

function buildChain(n: number, sessionId = 'sess_bench'): ChainEvent[] {
  const chain: ChainEvent[] = [];
  let prevHash: string | null = null;
  for (let i = 0; i < n; i++) {
    const event: HashableEvent = {
      id: `evt_${sessionId}_${String(i).padStart(6, '0')}`,
      timestamp: `2026-01-15T10:00:${String(i % 60).padStart(2, '0')}Z`,
      sessionId,
      agentId: 'agent_bench',
      eventType: 'custom',
      severity: 'info',
      payload: { index: i, data: 'benchmark-padding-'.repeat(5) },
      metadata: { source: 'benchmark' },
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
    getSessionIdsInRange: vi.fn((_t: string, _f: string, _to: string) =>
      Object.keys(sessionChains),
    ),
    getSessionEventsBatchRaw: vi.fn((sessionId: string, _t: string, offset: number, limit: number) => {
      const chain = sessionChains[sessionId] ?? [];
      return chain.slice(offset, offset + limit).map(e => ({
        id: e.id,
        timestamp: e.timestamp,
        sessionId: e.sessionId,
        agentId: e.agentId,
        eventType: e.eventType,
        severity: e.severity,
        payloadRaw: JSON.stringify(e.payload),
        metadataRaw: JSON.stringify(e.metadata),
        prevHash: e.prevHash,
        hash: e.hash,
      }));
    }),
  } as any;
}

describe('Audit Verification Benchmark', () => {
  it('verifies 50,000 events across 10 sessions using batched streaming', async () => {
    const EVENTS_PER_SESSION = 5_000;
    const SESSION_COUNT = 10;
    const chains: Record<string, ChainEvent[]> = {};

    for (let s = 0; s < SESSION_COUNT; s++) {
      chains[`sess_${s}`] = buildChain(EVENTS_PER_SESSION, `sess_${s}`);
    }

    const repo = createMockRepo(chains);
    const start = performance.now();

    const report = await runVerification(repo, {
      tenantId: 'default',
      from: '2026-01-01',
      to: '2026-02-01',
    });

    const elapsedMs = performance.now() - start;

    expect(report.verified).toBe(true);
    expect(report.totalEvents).toBe(EVENTS_PER_SESSION * SESSION_COUNT);
    expect(report.sessionsVerified).toBe(SESSION_COUNT);

    // Batching should have been called multiple times per session
    const callCount = repo.getSessionEventsBatchRaw.mock.calls.length;
    expect(callCount).toBeGreaterThan(SESSION_COUNT); // multiple batches per session

    // Log performance for visibility
    console.log(
      `[Benchmark] Verified ${report.totalEvents} events across ${SESSION_COUNT} sessions ` +
      `in ${elapsedMs.toFixed(0)}ms (${(report.totalEvents / (elapsedMs / 1000)).toFixed(0)} events/sec), ` +
      `${callCount} batch calls`,
    );

    // Should complete well under 30s for 50k events
    expect(elapsedMs).toBeLessThan(30_000);
  }, 60_000);

  it('verifies single large session (10,000 events) with multiple batch calls', async () => {
    const chain = buildChain(10_000, 'sess_large');
    const repo = createMockRepo({ sess_large: chain });

    const start = performance.now();
    const report = await runVerification(repo, {
      tenantId: 'default',
      sessionId: 'sess_large',
    });
    const elapsedMs = performance.now() - start;

    expect(report.verified).toBe(true);
    expect(report.totalEvents).toBe(10_000);

    // With BATCH_SIZE=5000, should be at least 2 batch calls + 1 empty
    const callCount = repo.getSessionEventsBatchRaw.mock.calls.length;
    expect(callCount).toBeGreaterThanOrEqual(2);

    console.log(
      `[Benchmark] Single session: ${report.totalEvents} events in ${elapsedMs.toFixed(0)}ms, ` +
      `${callCount} batch calls`,
    );
  }, 30_000);
});
