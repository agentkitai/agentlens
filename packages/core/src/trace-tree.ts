/**
 * Trace-tree assembly (#119 — nested execution traces).
 *
 * Reconstructs the `parent_span_id → span_id` hierarchy that OTLP ingest stamps
 * into each event's `metadata` (see server `otlp/span-context.ts`) into a
 * collapsible execution tree with a latency waterfall. Pure function over
 * already-stored events — no span table, no new read endpoint: both session
 * views project the events they already fetch through this.
 *
 * Threaded edges (AgentLens differentiators) come along for free because they
 * are stamped at the edge:
 *  - verified identity per node, with delegation boundaries flagged where a
 *    child's `verifiedAgentId` differs from its nearest verified ancestor;
 *  - per-subtree cost rolled up from descendant `llm_response.costUsd`;
 *  - span context lives in hashed `metadata`, so tree edges are covered by
 *    record integrity (OTLP traces are unchained by design — render them as
 *    record-integrity, never "chain valid").
 */

import type { AgentLensEvent, EventType } from './types.js';

export interface TraceNode {
  /** Canonical lowercase-hex span id (the grouping key). */
  spanId: string;
  /** Parent span id, or null for roots / orphans (parent absent from batch). */
  parentSpanId: string | null;
  traceId: string | null;
  /** Human label: gen_ai operation, tool name, model, or event type. */
  name: string;
  /** Primary event type for the node (the "call" side of a call/response pair). */
  eventType: EventType;
  /** Ids of every event collapsed into this span (the 1:N mapping). */
  eventIds: string[];
  /** Epoch ms; span start/end from stamped nanos, else event timestamps. */
  startMs: number | null;
  endMs: number | null;
  /** This span's own wall time (ms). */
  selfDurationMs: number | null;
  /** Subtree wall time: max(descendant end) − min(descendant start). */
  totalDurationMs: number | null;
  /** Count of all descendants (transitive). */
  descendantCount: number;
  /** Cost of this span's own events (llm_response.costUsd). */
  selfCostUsd: number;
  /** Self + all descendant cost. */
  subtreeCostUsd: number;
  agentId: string | null;
  verifiedAgentId: string | null;
  verifiedAgentMethod: string | null;
  /** Child's verified identity differs from its nearest verified ancestor. */
  isDelegationBoundary: boolean;
  /** Depth from its root (root = 0). */
  depth: number;
  children: TraceNode[];
}

export interface TraceTree {
  roots: TraceNode[];
  spanCount: number;
  /** Number of events that carried span metadata (1:N visibility). */
  eventCount: number;
  /** Trace timescale (epoch ms) for the waterfall. */
  startMs: number | null;
  endMs: number | null;
  totalCostUsd: number;
  /** false ⇒ no span metadata present; caller should render the flat timeline. */
  hasSpanData: boolean;
}

const NS_PER_MS = 1_000_000n;

function metaStr(meta: Record<string, unknown>, key: string): string | undefined {
  const v = meta[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function nanoToMs(v: unknown): number | null {
  if (typeof v === 'string' && v.length > 0) {
    try {
      return Number(BigInt(v) / NS_PER_MS);
    } catch {
      return null;
    }
  }
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v / 1_000_000);
  return null;
}

function eventCost(e: AgentLensEvent): number {
  if (e.eventType !== 'llm_response') return 0;
  const c = (e.payload as { costUsd?: unknown }).costUsd;
  return typeof c === 'number' && Number.isFinite(c) ? c : 0;
}

const isResponseSide = (t: EventType): boolean => /(_response|_error)$/.test(t);

function pickPrimary(evs: AgentLensEvent[]): AgentLensEvent {
  return evs.find((e) => !isResponseSide(e.eventType)) ?? evs[0];
}

function spanName(evs: AgentLensEvent[]): string {
  for (const e of evs) {
    const op = e.metadata.operation;
    if (typeof op === 'string' && op.length > 0) return op;
  }
  const primary = pickPrimary(evs);
  const p = primary.payload as Record<string, unknown>;
  if (typeof p.toolName === 'string' && p.toolName) return p.toolName;
  if (typeof p.model === 'string' && p.model) return p.model;
  return primary.eventType;
}

function emptyTree(eventCount: number): TraceTree {
  return { roots: [], spanCount: 0, eventCount, startMs: null, endMs: null, totalCostUsd: 0, hasSpanData: false };
}

/**
 * Assemble a session's events into an execution tree. Events without a
 * `metadata.spanId` (pure-SDK sessions) yield `hasSpanData: false` so callers
 * fall back to the flat timeline. Handles out-of-order spans, a missing root,
 * orphan children (parent absent), and pathological parent cycles.
 */
export function assembleTrace(events: AgentLensEvent[]): TraceTree {
  const spanEvents = events.filter((e) => metaStr(e.metadata, 'spanId'));
  if (spanEvents.length === 0) return emptyTree(events.length);

  // 1. Group events by span id — collapses the 1:N span→event mapping (e.g. a
  //    single LLM span's llm_call + llm_response) back into one node.
  const bySpan = new Map<string, AgentLensEvent[]>();
  for (const e of spanEvents) {
    const sid = metaStr(e.metadata, 'spanId')!;
    let arr = bySpan.get(sid);
    if (!arr) bySpan.set(sid, (arr = []));
    arr.push(e);
  }

  // 2. Build a node per span.
  const nodes = new Map<string, TraceNode>();
  for (const [spanId, evs] of bySpan) {
    evs.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
    const meta = evs[0].metadata;

    let startMs: number | null = null;
    let endMs: number | null = null;
    let selfDur: number | null = null;
    for (const e of evs) {
      const s = nanoToMs(e.metadata.spanStartUnixNano);
      const en = nanoToMs(e.metadata.spanEndUnixNano);
      if (s != null && (startMs == null || s < startMs)) startMs = s;
      if (en != null && (endMs == null || en > endMs)) endMs = en;
      if (typeof e.metadata.spanDurationMs === 'number') selfDur = e.metadata.spanDurationMs;
    }
    if (startMs == null) {
      const t = Date.parse(evs[0].timestamp);
      if (!Number.isNaN(t)) startMs = t;
    }
    if (endMs == null) {
      const t = Date.parse(evs[evs.length - 1].timestamp);
      if (!Number.isNaN(t)) endMs = t;
    }
    if (selfDur == null && startMs != null && endMs != null) selfDur = endMs - startMs;

    nodes.set(spanId, {
      spanId,
      parentSpanId: metaStr(meta, 'parentSpanId') ?? null,
      traceId: metaStr(meta, 'traceId') ?? null,
      name: spanName(evs),
      eventType: pickPrimary(evs).eventType,
      eventIds: evs.map((e) => e.id),
      startMs,
      endMs,
      selfDurationMs: selfDur,
      totalDurationMs: null,
      descendantCount: 0,
      selfCostUsd: evs.reduce((s, e) => s + eventCost(e), 0),
      subtreeCostUsd: 0,
      agentId: evs[0].agentId ?? null,
      verifiedAgentId: metaStr(meta, 'verifiedAgentId') ?? null,
      verifiedAgentMethod: metaStr(meta, 'verifiedAgentMethod') ?? null,
      isDelegationBoundary: false,
      depth: 0,
      children: [],
    });
  }

  // 3. Link children. A node whose parent is missing (orphan) or self-referential
  //    surfaces as a root rather than being dropped.
  const roots: TraceNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentSpanId ? nodes.get(node.parentSpanId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  // 4. DFS: depth, ordering, rollups (latency/cost/descendants), delegation flags.
  //    `visited` guards against cycles in malformed parent links.
  const visited = new Set<string>();
  let spanCount = 0;

  function dfs(
    node: TraceNode,
    depth: number,
    ancestorVerified: string | null,
  ): { start: number | null; end: number | null; cost: number; count: number } {
    if (visited.has(node.spanId)) {
      return { start: node.startMs, end: node.endMs, cost: node.selfCostUsd, count: 0 };
    }
    visited.add(node.spanId);
    spanCount++;
    node.depth = depth;
    node.isDelegationBoundary =
      !!node.verifiedAgentId && !!ancestorVerified && node.verifiedAgentId !== ancestorVerified;

    node.children.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));

    let start = node.startMs;
    let end = node.endMs;
    let cost = node.selfCostUsd;
    let count = 0;
    const verifiedForChildren = node.verifiedAgentId ?? ancestorVerified;
    for (const child of node.children) {
      const r = dfs(child, depth + 1, verifiedForChildren);
      if (r.start != null && (start == null || r.start < start)) start = r.start;
      if (r.end != null && (end == null || r.end > end)) end = r.end;
      cost += r.cost;
      count += 1 + r.count;
    }
    node.totalDurationMs = start != null && end != null ? end - start : node.selfDurationMs;
    node.subtreeCostUsd = cost;
    node.descendantCount = count;
    return { start, end, cost, count };
  }

  roots.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
  let traceStart: number | null = null;
  let traceEnd: number | null = null;
  let totalCost = 0;
  for (const r of roots) {
    const res = dfs(r, 0, null);
    if (res.start != null && (traceStart == null || res.start < traceStart)) traceStart = res.start;
    if (res.end != null && (traceEnd == null || res.end > traceEnd)) traceEnd = res.end;
    totalCost += res.cost;
  }

  return {
    roots,
    spanCount,
    eventCount: spanEvents.length,
    startMs: traceStart,
    endMs: traceEnd,
    totalCostUsd: totalCost,
    hasSpanData: true,
  };
}
