/**
 * Timeline — Vertical event timeline with virtual scrolling (Stories 7.3 + 7.6)
 *
 * Features:
 *  - Vertical layout, ascending timestamps, time markers on left
 *  - Event type icons + color coding
 *  - tool_call/tool_response paired as expandable nodes with duration
 *  - Chain validity indicator (✓/✗)
 *  - Virtual scrolling via @tanstack/react-virtual (~30 DOM nodes)
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AgentLensEvent, EventType, ToolCallPayload, ToolResponsePayload, ToolErrorPayload } from '@agentlens/core';

// ─── Types ──────────────────────────────────────────────────────────

export interface TimelineProps {
  events: AgentLensEvent[];
  chainValid: boolean;
  onEventClick: (event: AgentLensEvent) => void;
  selectedEventId?: string;
}

interface TimelineNode {
  kind: 'single' | 'paired';
  event: AgentLensEvent;
  /** For paired nodes: the matching response/error event */
  responseEvent?: AgentLensEvent;
  /** Computed duration for paired tool_call → response */
  durationMs?: number;
}

// ─── Event Styling ──────────────────────────────────────────────────

interface EventStyle {
  icon: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

const EVENT_STYLES: Record<string, EventStyle> = {
  // Success / lifecycle
  session_started: { icon: '▶️', color: 'text-green-700', bgColor: 'bg-green-50', borderColor: 'border-green-300' },
  session_ended:   { icon: '⏹️', color: 'text-green-700', bgColor: 'bg-green-50', borderColor: 'border-green-300' },
  // Tool calls
  tool_call:     { icon: '🔧', color: 'text-blue-700', bgColor: 'bg-blue-50', borderColor: 'border-blue-300' },
  tool_response: { icon: '📦', color: 'text-blue-700', bgColor: 'bg-blue-50', borderColor: 'border-blue-300' },
  tool_error:    { icon: '💥', color: 'text-red-700', bgColor: 'bg-red-50', borderColor: 'border-red-300' },
  // Approvals
  approval_requested: { icon: '🔔', color: 'text-purple-700', bgColor: 'bg-purple-50', borderColor: 'border-purple-300' },
  approval_granted:   { icon: '✅', color: 'text-purple-700', bgColor: 'bg-purple-50', borderColor: 'border-purple-300' },
  approval_denied:    { icon: '🚫', color: 'text-purple-700', bgColor: 'bg-purple-50', borderColor: 'border-purple-300' },
  approval_expired:   { icon: '⏰', color: 'text-purple-700', bgColor: 'bg-purple-50', borderColor: 'border-purple-300' },
  // Forms
  form_submitted: { icon: '📝', color: 'text-blue-700', bgColor: 'bg-blue-50', borderColor: 'border-blue-300' },
  form_completed: { icon: '✔️', color: 'text-green-700', bgColor: 'bg-green-50', borderColor: 'border-green-300' },
  form_expired:   { icon: '⏰', color: 'text-yellow-700', bgColor: 'bg-yellow-50', borderColor: 'border-yellow-300' },
  // Cost
  cost_tracked: { icon: '💰', color: 'text-yellow-700', bgColor: 'bg-yellow-50', borderColor: 'border-yellow-300' },
  // Alerts
  alert_triggered: { icon: '🚨', color: 'text-red-700', bgColor: 'bg-red-50', borderColor: 'border-red-300' },
  alert_resolved:  { icon: '✅', color: 'text-green-700', bgColor: 'bg-green-50', borderColor: 'border-green-300' },
  // Custom
  custom: { icon: '🔹', color: 'text-gray-700', bgColor: 'bg-gray-50', borderColor: 'border-gray-300' },
};

function getEventStyle(eventType: EventType): EventStyle {
  return EVENT_STYLES[eventType] ?? EVENT_STYLES.custom;
}

// ─── Severity colors ────────────────────────────────────────────────

function severityDot(severity: string): string {
  switch (severity) {
    case 'error':
    case 'critical':
      return 'bg-red-500';
    case 'warn':
      return 'bg-yellow-500';
    case 'info':
      return 'bg-blue-500';
    default:
      return 'bg-gray-400';
  }
}

// ─── Time formatting ────────────────────────────────────────────────

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function eventName(event: AgentLensEvent): string {
  const p = event.payload;
  if ('toolName' in p && typeof p.toolName === 'string') return p.toolName;
  if ('action' in p && typeof p.action === 'string') return p.action;
  if ('alertName' in p && typeof p.alertName === 'string') return p.alertName;
  if ('formName' in p && typeof p.formName === 'string') return p.formName;
  if ('type' in p && typeof p.type === 'string') return p.type;
  return event.eventType.replace(/_/g, ' ');
}

// ─── Build timeline nodes (pair tool_call with tool_response) ──────

function buildTimelineNodes(events: AgentLensEvent[]): TimelineNode[] {
  // Build a map of callId → response/error event
  const responseMap = new Map<string, AgentLensEvent>();
  for (const ev of events) {
    if (ev.eventType === 'tool_response' || ev.eventType === 'tool_error') {
      const payload = ev.payload as ToolResponsePayload | ToolErrorPayload;
      if (payload.callId) {
        responseMap.set(payload.callId, ev);
      }
    }
  }

  // Track which events we consumed as responses
  const consumedIds = new Set<string>();

  const nodes: TimelineNode[] = [];
  for (const ev of events) {
    // Skip response events that are paired with a call
    if (consumedIds.has(ev.id)) continue;

    if (ev.eventType === 'tool_call') {
      const callPayload = ev.payload as ToolCallPayload;
      const responseEvent = responseMap.get(callPayload.callId);
      if (responseEvent) {
        consumedIds.add(responseEvent.id);
        const respPayload = responseEvent.payload as ToolResponsePayload | ToolErrorPayload;
        nodes.push({
          kind: 'paired',
          event: ev,
          responseEvent,
          durationMs: respPayload.durationMs,
        });
      } else {
        nodes.push({ kind: 'single', event: ev });
      }
    } else if (
      (ev.eventType === 'tool_response' || ev.eventType === 'tool_error') &&
      !consumedIds.has(ev.id)
    ) {
      // Orphan response — show as single
      nodes.push({ kind: 'single', event: ev });
    } else {
      nodes.push({ kind: 'single', event: ev });
    }
  }

  return nodes;
}

// ─── Chain validity badge ───────────────────────────────────────────

function ChainBadge({ valid }: { valid: boolean }) {
  return (
    <div
      className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${
        valid
          ? 'bg-green-100 text-green-800 border border-green-300'
          : 'bg-red-100 text-red-800 border border-red-300'
      }`}
    >
      {valid ? '✓' : '✗'} Chain {valid ? 'Valid' : 'Invalid'}
    </div>
  );
}

// ─── Single timeline row ────────────────────────────────────────────

interface TimelineRowProps {
  node: TimelineNode;
  isSelected: boolean;
  onClick: (event: AgentLensEvent) => void;
}

function TimelineRow({ node, isSelected, onClick }: TimelineRowProps) {
  const [expanded, setExpanded] = useState(false);
  const style = getEventStyle(node.event.eventType);
  const isPaired = node.kind === 'paired';

  const handleClick = useCallback(() => {
    onClick(node.event);
  }, [node.event, onClick]);

  const toggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => !prev);
  }, []);

  return (
    <div className="flex gap-3">
      {/* Time marker */}
      <div className="flex-shrink-0 w-28 text-right pt-2">
        <span className="text-xs text-gray-500 font-mono">
          {formatTime(node.event.timestamp)}
        </span>
      </div>

      {/* Timeline line + dot */}
      <div className="flex flex-col items-center flex-shrink-0">
        <div className={`w-3 h-3 rounded-full mt-3 ${severityDot(node.event.severity)} ring-2 ring-white`} />
        <div className="w-px flex-1 bg-gray-200" />
      </div>

      {/* Event card */}
      <div className="flex-1 pb-3">
        <button
          onClick={handleClick}
          className={`w-full text-left rounded-lg border p-3 transition-all ${style.bgColor} ${style.borderColor} ${
            isSelected ? 'ring-2 ring-blue-500 shadow-md' : 'hover:shadow-sm'
          }`}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base">{style.icon}</span>
            <span className={`font-medium text-sm ${style.color}`}>
              {eventName(node.event)}
            </span>
            <span className="text-xs text-gray-500 bg-white/60 px-1.5 py-0.5 rounded">
              {node.event.eventType}
            </span>
            {node.durationMs !== undefined && (
              <span className="text-xs font-mono text-gray-600 bg-white/60 px-1.5 py-0.5 rounded">
                {formatMs(node.durationMs)}
              </span>
            )}
            {isPaired && (
              <button
                onClick={toggleExpand}
                className="ml-auto text-xs text-gray-500 hover:text-gray-700 px-1"
                aria-label={expanded ? 'Collapse' : 'Expand'}
              >
                {expanded ? '▼' : '▶'} {node.responseEvent?.eventType === 'tool_error' ? 'error' : 'response'}
              </button>
            )}
          </div>
        </button>

        {/* Expanded paired response */}
        {isPaired && expanded && node.responseEvent && (
          <div className="mt-1 ml-4">
            <button
              onClick={() => onClick(node.responseEvent!)}
              className={`w-full text-left rounded-lg border p-2 text-sm transition-all ${
                getEventStyle(node.responseEvent.eventType).bgColor
              } ${getEventStyle(node.responseEvent.eventType).borderColor} hover:shadow-sm`}
            >
              <div className="flex items-center gap-2">
                <span>{getEventStyle(node.responseEvent.eventType).icon}</span>
                <span className={`font-medium ${getEventStyle(node.responseEvent.eventType).color}`}>
                  {eventName(node.responseEvent)}
                </span>
                <span className="text-xs text-gray-500">
                  {formatTime(node.responseEvent.timestamp)}
                </span>
              </div>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

const ESTIMATED_ROW_HEIGHT = 64;

export function Timeline({ events, chainValid, onEventClick, selectedEventId }: TimelineProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const nodes = useMemo(() => buildTimelineNodes(events), [events]);

  const virtualizer = useVirtualizer({
    count: nodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 10,
  });

  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>No events in this session</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Chain validity */}
      <div className="flex items-center gap-3">
        <ChainBadge valid={chainValid} />
        <span className="text-sm text-gray-500">
          {events.length} event{events.length !== 1 ? 's' : ''} · {nodes.length} timeline node{nodes.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Virtual-scrolled timeline */}
      <div
        ref={parentRef}
        className="h-[calc(100vh-20rem)] overflow-auto"
      >
        <div
          style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const node = nodes[virtualRow.index];
            if (!node) return null;
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <TimelineRow
                  node={node}
                  isSelected={
                    node.event.id === selectedEventId ||
                    node.responseEvent?.id === selectedEventId
                  }
                  onClick={onEventClick}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
