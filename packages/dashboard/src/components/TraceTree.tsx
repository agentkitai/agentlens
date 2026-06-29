/**
 * TraceTree — collapsible execution tree + latency waterfall (#119).
 *
 * Reconstructs the parent/child span hierarchy that OTLP ingest preserves in
 * each event's metadata (via `assembleTrace` in core) and renders it as an
 * audit-grade tree: per-node latency bar on a shared trace timescale, subtree
 * cost rolled up from descendant llm_response cost, verified-agent identity,
 * and delegation boundaries (a child whose verified identity differs from its
 * parent) flagged inline. Integrity is shown honestly — OTLP traces are
 * record-integrity / unchained, never a false "Chain Valid".
 *
 * Degrades to nothing useful when there's no span metadata; callers should only
 * offer the Tree view when `hasTraceData(events)` is true.
 */
import { useMemo, useState } from 'react';
import type { AgentLensEvent, TraceTree as TraceTreeData, TraceNode } from '@agentkitai/agentlens-core';
import { getEventStyle, formatMs, formatCost, ChainBadge } from './Timeline';

/** True when at least one event carries span context (so a tree is meaningful). */
export function hasTraceData(events: AgentLensEvent[]): boolean {
  return events.some((e) => typeof e.metadata?.spanId === 'string');
}

export interface TraceTreeProps {
  /** Server-assembled tree (#119 — from GET /api/sessions/:id/trace). */
  tree: TraceTreeData;
  /** Source events, used to map a clicked node back to its event. */
  events: AgentLensEvent[];
  /** false ⇒ OTLP/unchained telemetry (record-integrity only). */
  chained?: boolean;
  selectedEventId?: string;
  onSelectEvent?: (event: AgentLensEvent) => void;
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 10)}…` : id;
}

export function TraceTree({ tree, events, chained = true, selectedEventId, onSelectEvent }: TraceTreeProps) {
  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  // Collapsed span ids (default: everything expanded).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  if (!tree.hasSpanData) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        No span/trace data in this session — switch to List view.
      </div>
    );
  }

  const span = tree.startMs != null && tree.endMs != null && tree.endMs > tree.startMs ? tree.endMs - tree.startMs : 0;
  const totalDurationMs = span;

  function toggle(spanId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  }

  function renderNode(node: TraceNode) {
    const style = getEventStyle(node.eventType);
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.spanId);
    const isSelected = !!selectedEventId && node.eventIds.includes(selectedEventId);

    // Waterfall bar position on the shared trace timescale.
    let bar: { left: string; width: string } | null = null;
    if (span > 0 && node.startMs != null) {
      const offset = Math.min(((node.startMs - tree.startMs!) / span) * 100, 99);
      const rawWidth = ((node.selfDurationMs ?? 0) / span) * 100;
      const width = Math.min(Math.max(rawWidth, 1.5), 100 - offset);
      bar = { left: `${offset}%`, width: `${width}%` };
    }

    const dur = node.totalDurationMs ?? node.selfDurationMs;
    const primary = byId.get(node.eventIds[0]);

    return (
      <div key={node.spanId}>
        <div
          className={`group flex items-center gap-2 py-1 pr-2 rounded ${
            isSelected ? 'bg-blue-50 ring-1 ring-blue-300' : 'hover:bg-gray-50'
          }`}
        >
          {/* Label column (indented by depth) */}
          <div
            className="flex items-center gap-1.5 min-w-0 flex-1 cursor-pointer"
            style={{ paddingLeft: node.depth * 16 + 4 }}
            onClick={() => primary && onSelectEvent?.(primary)}
          >
            {hasChildren ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(node.spanId);
                }}
                className="w-4 shrink-0 text-gray-400 hover:text-gray-700"
                aria-label={isCollapsed ? 'Expand' : 'Collapse'}
              >
                {isCollapsed ? '▶' : '▼'}
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}
            <span className="shrink-0">{style.icon}</span>
            <span className={`truncate text-sm font-medium ${style.color}`} title={node.name}>
              {node.name}
            </span>
            {node.descendantCount > 0 && isCollapsed && (
              <span className="shrink-0 text-xs text-gray-400">+{node.descendantCount}</span>
            )}
            {node.isDelegationBoundary && (
              <span
                className="shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-800 border border-fuchsia-300"
                title={`Sub-agent delegation: verified identity changes to ${node.verifiedAgentId}`}
              >
                ⇄ delegated
              </span>
            )}
            {node.verifiedAgentId && (
              <span
                className="shrink-0 text-xs px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono"
                title={`Verified agent: ${node.verifiedAgentId}${
                  node.verifiedAgentMethod ? ` (via ${node.verifiedAgentMethod})` : ''
                }`}
              >
                🛡 {shortId(node.verifiedAgentId)}
              </span>
            )}
          </div>

          {/* Waterfall track */}
          <div className="hidden sm:block relative w-40 h-4 shrink-0 bg-gray-100 rounded overflow-hidden">
            {bar && (
              <div
                className={`absolute top-0 h-full ${style.bgColor} border ${style.borderColor} rounded`}
                style={{ left: bar.left, width: bar.width }}
              />
            )}
          </div>

          {/* Duration + subtree cost */}
          <span className="w-16 shrink-0 text-right text-xs tabular-nums text-gray-600">
            {dur != null ? formatMs(dur) : '—'}
          </span>
          <span className="w-20 shrink-0 text-right text-xs tabular-nums text-gray-500">
            {node.subtreeCostUsd > 0 ? formatCost(node.subtreeCostUsd) : ''}
          </span>
        </div>

        {hasChildren && !isCollapsed && node.children.map(renderNode)}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header: honest integrity + trace summary */}
      <div className="flex flex-wrap items-center gap-3">
        <ChainBadge valid chained={chained} />
        <span className="text-sm text-gray-500">
          {tree.spanCount} span{tree.spanCount !== 1 ? 's' : ''} · {tree.eventCount} event
          {tree.eventCount !== 1 ? 's' : ''}
          {totalDurationMs > 0 && <> · {formatMs(totalDurationMs)}</>}
          {tree.totalCostUsd > 0 && <> · {formatCost(tree.totalCostUsd)}</>}
        </span>
      </div>

      {/* Column hint */}
      <div className="flex items-center gap-2 px-2 text-[11px] uppercase tracking-wide text-gray-400">
        <span className="flex-1">Span</span>
        <span className="hidden sm:block w-40">Waterfall</span>
        <span className="w-16 text-right">Latency</span>
        <span className="w-20 text-right">Cost</span>
      </div>

      <div className="border border-gray-200 rounded-lg p-2 overflow-x-auto">{tree.roots.map(renderNode)}</div>
    </div>
  );
}
