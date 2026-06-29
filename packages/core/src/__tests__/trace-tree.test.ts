import { describe, it, expect } from 'vitest';
import { assembleTrace, type TraceNode } from '../trace-tree.js';
import type { AgentLensEvent, EventType } from '../types.js';

let seq = 0;
function makeEvent(o: {
  id?: string;
  spanId?: string;
  parentSpanId?: string;
  traceId?: string;
  eventType?: EventType;
  timestamp?: string;
  agentId?: string;
  verifiedAgentId?: string;
  costUsd?: number;
  startNano?: string;
  endNano?: string;
  durationMs?: number;
  operation?: string;
  payload?: Record<string, unknown>;
}): AgentLensEvent {
  const metadata: Record<string, unknown> = {};
  if (o.spanId) metadata.spanId = o.spanId;
  if (o.parentSpanId) metadata.parentSpanId = o.parentSpanId;
  if (o.traceId) metadata.traceId = o.traceId;
  if (o.verifiedAgentId) metadata.verifiedAgentId = o.verifiedAgentId;
  if (o.startNano) metadata.spanStartUnixNano = o.startNano;
  if (o.endNano) metadata.spanEndUnixNano = o.endNano;
  if (o.durationMs != null) metadata.spanDurationMs = o.durationMs;
  if (o.operation) metadata.operation = o.operation;
  const payload = o.payload ?? (o.costUsd != null ? { costUsd: o.costUsd } : {});
  return {
    id: o.id ?? `e${seq++}`,
    timestamp: o.timestamp ?? '2026-01-01T00:00:00.000Z',
    sessionId: 's1',
    agentId: o.agentId ?? 'agent',
    eventType: o.eventType ?? 'custom',
    severity: 'info',
    payload: payload as AgentLensEvent['payload'],
    metadata,
    prevHash: null,
    hash: 'h',
    tenantId: 't1',
  };
}

/** Find a node by span id anywhere in the tree. */
function find(roots: TraceNode[], spanId: string): TraceNode | undefined {
  for (const r of roots) {
    if (r.spanId === spanId) return r;
    const c = find(r.children, spanId);
    if (c) return c;
  }
  return undefined;
}

describe('assembleTrace', () => {
  it('falls back (hasSpanData=false) when no event carries span metadata', () => {
    const tree = assembleTrace([makeEvent({ eventType: 'tool_call' }), makeEvent({ eventType: 'tool_response' })]);
    expect(tree.hasSpanData).toBe(false);
    expect(tree.roots).toHaveLength(0);
  });

  it('collapses one LLM span (llm_call + llm_response) into a single node', () => {
    const tree = assembleTrace([
      makeEvent({ id: 'call', spanId: 'aaaa', eventType: 'llm_call', operation: 'chat' }),
      makeEvent({ id: 'resp', spanId: 'aaaa', eventType: 'llm_response', costUsd: 0.01 }),
    ]);
    expect(tree.roots).toHaveLength(1);
    const node = tree.roots[0];
    expect(node.eventIds.sort()).toEqual(['call', 'resp']);
    expect(node.eventType).toBe('llm_call'); // the "call" side wins for the icon
    expect(node.name).toBe('chat');
    expect(node.selfCostUsd).toBeCloseTo(0.01);
  });

  it('builds a multi-level tree with correct depth and descendant counts', () => {
    const tree = assembleTrace([
      makeEvent({ spanId: 'A' }),
      makeEvent({ spanId: 'B', parentSpanId: 'A' }),
      makeEvent({ spanId: 'C', parentSpanId: 'B' }),
    ]);
    expect(tree.roots).toHaveLength(1);
    const a = tree.roots[0];
    expect(a.spanId).toBe('A');
    expect(a.depth).toBe(0);
    expect(a.descendantCount).toBe(2);
    const b = find(tree.roots, 'B')!;
    expect(b.depth).toBe(1);
    expect(b.descendantCount).toBe(1);
    expect(find(tree.roots, 'C')!.depth).toBe(2);
    expect(tree.spanCount).toBe(3);
  });

  it('handles out-of-order spans (children arriving before parents)', () => {
    const tree = assembleTrace([
      makeEvent({ spanId: 'C', parentSpanId: 'B' }),
      makeEvent({ spanId: 'B', parentSpanId: 'A' }),
      makeEvent({ spanId: 'A' }),
    ]);
    expect(tree.roots.map((r) => r.spanId)).toEqual(['A']);
    expect(find(tree.roots, 'C')!.depth).toBe(2);
  });

  it('surfaces an orphan child (parent absent from batch) as a root, not dropped', () => {
    const tree = assembleTrace([
      makeEvent({ spanId: 'B', parentSpanId: 'MISSING' }),
      makeEvent({ spanId: 'C', parentSpanId: 'B' }),
    ]);
    // B's parent never arrived → B surfaces at root level with C beneath it.
    expect(tree.roots.map((r) => r.spanId)).toEqual(['B']);
    expect(find(tree.roots, 'C')!.depth).toBe(1);
    expect(tree.spanCount).toBe(2);
  });

  it('rolls subtree cost up from descendant llm_response costUsd', () => {
    const tree = assembleTrace([
      makeEvent({ spanId: 'A' }),
      makeEvent({ spanId: 'B', parentSpanId: 'A', eventType: 'llm_response', costUsd: 0.01 }),
      makeEvent({ spanId: 'C', parentSpanId: 'B', eventType: 'llm_response', costUsd: 0.02 }),
    ]);
    const a = tree.roots[0];
    expect(a.selfCostUsd).toBe(0);
    expect(a.subtreeCostUsd).toBeCloseTo(0.03);
    expect(find(tree.roots, 'B')!.subtreeCostUsd).toBeCloseTo(0.03);
    expect(tree.totalCostUsd).toBeCloseTo(0.03);
  });

  it('rolls subtree latency from span start/end nanos (waterfall timescale)', () => {
    const base = 1_700_000_000_000_000_000n;
    const ms = (n: number) => (base + BigInt(n) * 1_000_000n).toString();
    const tree = assembleTrace([
      makeEvent({ spanId: 'A', startNano: ms(0), endNano: ms(300), durationMs: 300 }),
      makeEvent({ spanId: 'B', parentSpanId: 'A', startNano: ms(50), endNano: ms(250), durationMs: 200 }),
    ]);
    const a = tree.roots[0];
    expect(a.selfDurationMs).toBe(300);
    expect(a.totalDurationMs).toBe(300); // max end (300) − min start (0)
    expect(tree.endMs! - tree.startMs!).toBe(300);
  });

  it('flags a delegation boundary when a child verified identity differs from its ancestor', () => {
    const tree = assembleTrace([
      makeEvent({ spanId: 'A', verifiedAgentId: 'agt_a' }),
      makeEvent({ spanId: 'B', parentSpanId: 'A', verifiedAgentId: 'agt_a' }),
      makeEvent({ spanId: 'C', parentSpanId: 'B', verifiedAgentId: 'agt_b' }),
    ]);
    expect(tree.roots[0].isDelegationBoundary).toBe(false); // root, no ancestor
    expect(find(tree.roots, 'B')!.isDelegationBoundary).toBe(false); // same id as parent
    expect(find(tree.roots, 'C')!.isDelegationBoundary).toBe(true); // agt_b ≠ agt_a
  });

  it('compares against the nearest verified ancestor, skipping unverified intermediates', () => {
    const tree = assembleTrace([
      makeEvent({ spanId: 'A', verifiedAgentId: 'agt_a' }),
      makeEvent({ spanId: 'B', parentSpanId: 'A' }), // unverified intermediate
      makeEvent({ spanId: 'C', parentSpanId: 'B', verifiedAgentId: 'agt_b' }),
    ]);
    expect(find(tree.roots, 'C')!.isDelegationBoundary).toBe(true);
  });

  it('does not hang or crash on a parent-link cycle', () => {
    expect(() =>
      assembleTrace([
        makeEvent({ spanId: 'A', parentSpanId: 'B' }),
        makeEvent({ spanId: 'B', parentSpanId: 'A' }),
      ]),
    ).not.toThrow();
  });
});
