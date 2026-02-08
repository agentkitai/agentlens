/**
 * ReplayTimeline — Step-by-step vertical event list (Story 5.4)
 *
 * Features:
 *  - Vertical list of ReplayEventCard components
 *  - Current step highlighted with distinct background + border
 *  - Auto-scrolls to keep current step centered
 *  - Each card: step number, timestamp (relative), event type icon + label,
 *    summary (tool name, LLM model, error message), expandable payload detail
 *  - Paired events: response shown inline below call with duration badge
 *  - Event type filter toolbar with checkboxes
 *  - Click any card → sets as current step
 *  - Performance: simple slice-based windowing (~50 visible cards)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentLensEvent, EventType } from '@agentlensai/core';

// ─── Types ──────────────────────────────────────────────────────────

export interface ReplayTimelineProps {
  events: AgentLensEvent[];
  currentStep: number;
  onStepChange: (step: number) => void;
  sessionStartTime: string;
}

// ─── Event type styles ──────────────────────────────────────────────

interface EventStyle {
  icon: string;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

const EVENT_STYLES: Record<string, EventStyle> = {
  session_started:     { icon: '🚀', label: 'Session Started',    color: 'text-green-700',  bgColor: 'bg-green-50',   borderColor: 'border-green-200' },
  session_ended:       { icon: '🏁', label: 'Session Ended',      color: 'text-green-700',  bgColor: 'bg-green-50',   borderColor: 'border-green-200' },
  tool_call:           { icon: '🔧', label: 'Tool Call',          color: 'text-blue-700',   bgColor: 'bg-blue-50',    borderColor: 'border-blue-200' },
  tool_response:       { icon: '📦', label: 'Tool Response',      color: 'text-blue-700',   bgColor: 'bg-blue-50',    borderColor: 'border-blue-200' },
  tool_error:          { icon: '💥', label: 'Tool Error',         color: 'text-red-700',    bgColor: 'bg-red-50',     borderColor: 'border-red-200' },
  approval_requested:  { icon: '🔐', label: 'Approval Requested', color: 'text-purple-700', bgColor: 'bg-purple-50',  borderColor: 'border-purple-200' },
  approval_granted:    { icon: '✅', label: 'Approval Granted',   color: 'text-green-700',  bgColor: 'bg-green-50',   borderColor: 'border-green-200' },
  approval_denied:     { icon: '🚫', label: 'Approval Denied',    color: 'text-red-700',    bgColor: 'bg-red-50',     borderColor: 'border-red-200' },
  approval_expired:    { icon: '⏰', label: 'Approval Expired',   color: 'text-yellow-700', bgColor: 'bg-yellow-50',  borderColor: 'border-yellow-200' },
  form_submitted:      { icon: '📝', label: 'Form Submitted',     color: 'text-teal-700',   bgColor: 'bg-teal-50',    borderColor: 'border-teal-200' },
  form_completed:      { icon: '✏️', label: 'Form Completed',     color: 'text-teal-700',   bgColor: 'bg-teal-50',    borderColor: 'border-teal-200' },
  form_expired:        { icon: '⏳', label: 'Form Expired',       color: 'text-orange-700', bgColor: 'bg-orange-50',  borderColor: 'border-orange-200' },
  cost_tracked:        { icon: '💰', label: 'Cost Tracked',       color: 'text-yellow-700', bgColor: 'bg-yellow-50',  borderColor: 'border-yellow-200' },
  llm_call:            { icon: '🧠', label: 'LLM Call',           color: 'text-indigo-700', bgColor: 'bg-indigo-50',  borderColor: 'border-indigo-200' },
  llm_response:        { icon: '💬', label: 'LLM Response',       color: 'text-indigo-700', bgColor: 'bg-indigo-50',  borderColor: 'border-indigo-200' },
  alert_triggered:     { icon: '🚨', label: 'Alert Triggered',    color: 'text-red-700',    bgColor: 'bg-red-50',     borderColor: 'border-red-200' },
  alert_resolved:      { icon: '🔔', label: 'Alert Resolved',     color: 'text-green-700',  bgColor: 'bg-green-50',   borderColor: 'border-green-200' },
  custom:              { icon: '📎', label: 'Custom',             color: 'text-gray-700',   bgColor: 'bg-gray-50',    borderColor: 'border-gray-200' },
};

function getEventStyle(eventType: string): EventStyle {
  return EVENT_STYLES[eventType] ?? EVENT_STYLES.custom;
}

// ─── Filter categories ──────────────────────────────────────────────

interface FilterCategory {
  key: string;
  label: string;
  icon: string;
  eventTypes: Set<string>;
}

const FILTER_CATEGORIES: FilterCategory[] = [
  { key: 'llm',       label: 'LLM',       icon: '🧠', eventTypes: new Set(['llm_call', 'llm_response']) },
  { key: 'tools',     label: 'Tools',     icon: '🔧', eventTypes: new Set(['tool_call', 'tool_response', 'tool_error']) },
  { key: 'errors',    label: 'Errors',    icon: '❌', eventTypes: new Set(['tool_error', 'alert_triggered']) },
  { key: 'approvals', label: 'Approvals', icon: '🔐', eventTypes: new Set(['approval_requested', 'approval_granted', 'approval_denied', 'approval_expired']) },
  { key: 'forms',     label: 'Forms',     icon: '📝', eventTypes: new Set(['form_submitted', 'form_completed', 'form_expired']) },
  { key: 'lifecycle', label: 'Lifecycle', icon: '🔄', eventTypes: new Set(['session_started', 'session_ended']) },
  { key: 'cost',      label: 'Cost',      icon: '💰', eventTypes: new Set(['cost_tracked']) },
];

// ─── Pairing helpers ────────────────────────────────────────────────

const CALL_RESPONSE_MAP: Record<string, string> = {
  tool_call: 'tool_response',
  llm_call: 'llm_response',
  approval_requested: 'approval_granted',
  form_submitted: 'form_completed',
};

const RESPONSE_TYPES = new Set([
  'tool_response', 'tool_error', 'llm_response',
  'approval_granted', 'approval_denied', 'approval_expired',
  'form_completed', 'form_expired',
]);

function getCallId(ev: AgentLensEvent): string | null {
  const p = ev.payload as Record<string, unknown>;
  if (typeof p.callId === 'string') return p.callId;
  if (typeof p.requestId === 'string') return p.requestId;
  if (typeof p.submissionId === 'string') return p.submissionId;
  return null;
}

interface PairedEntry {
  /** Index in the original events array */
  index: number;
  event: AgentLensEvent;
  pairedEvent?: AgentLensEvent;
  pairDurationMs?: number;
}

function buildPairedEntries(events: AgentLensEvent[]): PairedEntry[] {
  // Build a map of callId→response for pairing
  const responseMap = new Map<string, AgentLensEvent>();
  for (const ev of events) {
    if (RESPONSE_TYPES.has(ev.eventType)) {
      const cid = getCallId(ev);
      if (cid) responseMap.set(`${ev.eventType}:${cid}`, ev);
    }
  }

  const usedResponses = new Set<string>();
  const entries: PairedEntry[] = [];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];

    // Skip response events that will be shown inline under their call
    if (RESPONSE_TYPES.has(ev.eventType)) {
      const cid = getCallId(ev);
      if (cid && usedResponses.has(`${ev.eventType}:${cid}`)) continue;
    }

    const entry: PairedEntry = { index: i, event: ev };

    // Try to find paired response
    if (CALL_RESPONSE_MAP[ev.eventType]) {
      const cid = getCallId(ev);
      if (cid) {
        // Look for matching response or error
        const responseType = CALL_RESPONSE_MAP[ev.eventType];
        const errorTypes = ev.eventType === 'tool_call' ? ['tool_error'] :
          ev.eventType === 'approval_requested' ? ['approval_denied', 'approval_expired'] :
          ev.eventType === 'form_submitted' ? ['form_expired'] : [];

        // Check primary response type
        let paired = responseMap.get(`${responseType}:${cid}`);
        if (paired) {
          usedResponses.add(`${responseType}:${cid}`);
        } else {
          // Check error variants
          for (const errType of errorTypes) {
            paired = responseMap.get(`${errType}:${cid}`);
            if (paired) {
              usedResponses.add(`${errType}:${cid}`);
              break;
            }
          }
        }

        if (paired) {
          entry.pairedEvent = paired;
          const callTime = new Date(ev.timestamp).getTime();
          const respTime = new Date(paired.timestamp).getTime();
          entry.pairDurationMs = respTime - callTime;
        }
      }
    }

    entries.push(entry);
  }

  return entries;
}

// ─── Event summary extraction ───────────────────────────────────────

function getEventSummary(ev: AgentLensEvent): string {
  const p = ev.payload as Record<string, unknown>;
  switch (ev.eventType) {
    case 'tool_call':
      return `${p.toolName}(${summarizeArgs(p.arguments as Record<string, unknown>)})`;
    case 'tool_response':
      return `${p.toolName} → ${formatDurationMs(p.durationMs as number)}`;
    case 'tool_error':
      return `${p.toolName}: ${p.error}`;
    case 'llm_call':
      return `${p.provider}/${p.model} · ${(p.messages as unknown[])?.length ?? 0} messages`;
    case 'llm_response': {
      const usage = p.usage as { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
      return `${p.model} · ${usage?.totalTokens ?? 0} tokens · $${((p.costUsd as number) ?? 0).toFixed(4)}`;
    }
    case 'cost_tracked':
      return `${p.provider}/${p.model} · $${((p.costUsd as number) ?? 0).toFixed(4)}`;
    case 'session_started':
      return p.agentName ? `Agent: ${p.agentName}` : 'Session initialized';
    case 'session_ended':
      return `Reason: ${p.reason}${p.totalDurationMs ? ` · ${formatDurationMs(p.totalDurationMs as number)}` : ''}`;
    case 'approval_requested':
      return `${p.action} (${p.urgency})`;
    case 'approval_granted':
    case 'approval_denied':
    case 'approval_expired':
      return `${p.action} by ${p.decidedBy ?? 'system'}`;
    case 'form_submitted':
      return `${p.formName ?? p.formId} · ${p.fieldCount} fields`;
    case 'form_completed':
      return `${p.formId} by ${p.completedBy}`;
    case 'form_expired':
      return `${p.formId} after ${formatDurationMs(p.expiredAfterMs as number)}`;
    case 'alert_triggered':
      return `${p.alertName}: ${p.message}`;
    case 'alert_resolved':
      return `${p.alertName} resolved`;
    default: {
      const customP = p as { type?: string };
      return customP.type ?? ev.eventType;
    }
  }
}

function summarizeArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return '';
  const keys = Object.keys(args);
  if (keys.length === 0) return '';
  if (keys.length <= 2) {
    return keys.map(k => {
      const v = args[k];
      const s = typeof v === 'string' ? (v.length > 30 ? v.slice(0, 30) + '…' : v) : JSON.stringify(v);
      return `${k}: ${s}`;
    }).join(', ');
  }
  return `${keys.length} args`;
}

function formatDurationMs(ms: number | undefined): string {
  if (ms === undefined || ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatRelativeTime(eventTime: string, sessionStart: string): string {
  const diff = new Date(eventTime).getTime() - new Date(sessionStart).getTime();
  if (diff < 0) return '-' + formatDurationMs(-diff);
  return '+' + formatDurationMs(diff);
}

// ─── Windowing constants ────────────────────────────────────────────

const WINDOW_SIZE = 50;
const WINDOW_BUFFER = 10;

// ─── ReplayEventCard ────────────────────────────────────────────────

interface ReplayEventCardProps {
  entry: PairedEntry;
  stepNumber: number;
  isCurrent: boolean;
  sessionStartTime: string;
  onClick: () => void;
}

function ReplayEventCard({
  entry,
  stepNumber,
  isCurrent,
  sessionStartTime,
  onClick,
}: ReplayEventCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const style = getEventStyle(entry.event.eventType);

  const handleToggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(prev => !prev);
  }, []);

  return (
    <div
      className={`
        rounded-lg border transition-all cursor-pointer
        ${isCurrent
          ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-300 shadow-md'
          : `border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm`
        }
      `}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`Step ${stepNumber}: ${style.label}`}
      aria-current={isCurrent ? 'step' : undefined}
    >
      <div className="px-3 py-2.5">
        {/* Header row */}
        <div className="flex items-center gap-2">
          {/* Step number */}
          <span className={`
            flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
            ${isCurrent ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}
          `}>
            {stepNumber}
          </span>

          {/* Event icon + type */}
          <span className="text-base flex-shrink-0">{style.icon}</span>
          <span className={`text-sm font-medium ${style.color}`}>{style.label}</span>

          {/* Timestamp */}
          <span className="text-xs text-gray-400 ml-auto font-mono tabular-nums flex-shrink-0">
            {formatRelativeTime(entry.event.timestamp, sessionStartTime)}
          </span>

          {/* Severity badge for errors */}
          {(entry.event.severity === 'error' || entry.event.severity === 'critical') && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium flex-shrink-0">
              {entry.event.severity}
            </span>
          )}
        </div>

        {/* Summary */}
        <div className="mt-1 ml-9 text-sm text-gray-600 truncate">
          {getEventSummary(entry.event)}
        </div>

        {/* Paired response inline */}
        {entry.pairedEvent && (
          <div className={`mt-2 ml-9 rounded border px-2.5 py-1.5 text-sm ${
            entry.pairedEvent.eventType.includes('error') || entry.pairedEvent.eventType === 'approval_denied'
              ? 'bg-red-50 border-red-200'
              : 'bg-gray-50 border-gray-200'
          }`}>
            <div className="flex items-center gap-2">
              <span className="text-xs">{getEventStyle(entry.pairedEvent.eventType).icon}</span>
              <span className="text-xs font-medium text-gray-500">
                {getEventStyle(entry.pairedEvent.eventType).label}
              </span>
              {entry.pairDurationMs !== undefined && (
                <span className="ml-auto text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 font-mono tabular-nums">
                  {formatDurationMs(entry.pairDurationMs)}
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-0.5 truncate">
              {getEventSummary(entry.pairedEvent)}
            </div>
          </div>
        )}

        {/* Expand toggle */}
        <button
          className="mt-1.5 ml-9 text-xs text-blue-500 hover:text-blue-700 focus:outline-none"
          onClick={handleToggleExpand}
          aria-expanded={expanded}
        >
          {expanded ? '▾ Hide details' : '▸ Show details'}
        </button>

        {/* Expanded payload */}
        {expanded && (
          <div className="mt-2 ml-9 space-y-2">
            <PayloadDetail label="Payload" data={entry.event.payload} />
            {Object.keys(entry.event.metadata).length > 0 && (
              <PayloadDetail label="Metadata" data={entry.event.metadata} />
            )}
            {entry.pairedEvent && (
              <PayloadDetail label="Response Payload" data={entry.pairedEvent.payload} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Payload detail display ─────────────────────────────────────────

function PayloadDetail({ label, data }: { label: string; data: unknown }): React.ReactElement {
  return (
    <div>
      <div className="text-xs font-medium text-gray-400 mb-0.5">{label}</div>
      <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto text-gray-700">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

// ─── Main ReplayTimeline Component ──────────────────────────────────

export function ReplayTimeline({
  events,
  currentStep,
  onStepChange,
  sessionStartTime,
}: ReplayTimelineProps): React.ReactElement {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const currentCardRef = useRef<HTMLDivElement>(null);
  const [filters, setFilters] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const cat of FILTER_CATEGORIES) {
      initial[cat.key] = true;
    }
    return initial;
  });

  // Build paired entries
  const pairedEntries = useMemo(() => buildPairedEntries(events), [events]);

  // Compute which event types are active based on filters
  const activeEventTypes = useMemo(() => {
    const active = new Set<string>();
    for (const cat of FILTER_CATEGORIES) {
      if (filters[cat.key]) {
        for (const t of cat.eventTypes) {
          active.add(t);
        }
      }
    }
    return active;
  }, [filters]);

  // Filter entries based on active types
  const filteredEntries = useMemo(() => {
    return pairedEntries.filter(entry => activeEventTypes.has(entry.event.eventType));
  }, [pairedEntries, activeEventTypes]);

  // Find the current step index within the filtered list
  const currentFilteredIndex = useMemo(() => {
    return filteredEntries.findIndex(e => e.index === currentStep);
  }, [filteredEntries, currentStep]);

  // Slice-based windowing: show ~WINDOW_SIZE entries around the current step
  const { windowStart, windowEnd, windowedEntries } = useMemo(() => {
    const center = Math.max(0, currentFilteredIndex);
    const halfWindow = Math.floor(WINDOW_SIZE / 2);
    let start = Math.max(0, center - halfWindow);
    let end = Math.min(filteredEntries.length, start + WINDOW_SIZE);
    // Adjust start if we hit the end
    if (end - start < WINDOW_SIZE) {
      start = Math.max(0, end - WINDOW_SIZE);
    }
    return {
      windowStart: start,
      windowEnd: end,
      windowedEntries: filteredEntries.slice(start, end),
    };
  }, [filteredEntries, currentFilteredIndex]);

  // Auto-scroll to current card
  useEffect(() => {
    if (currentCardRef.current) {
      currentCardRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [currentStep, currentFilteredIndex]);

  // Filter toggle handler
  const toggleFilter = useCallback((key: string) => {
    setFilters(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // All/None toggle
  const allFiltersActive = Object.values(filters).every(Boolean);
  const toggleAll = useCallback(() => {
    const newVal = !allFiltersActive;
    setFilters(() => {
      const next: Record<string, boolean> = {};
      for (const cat of FILTER_CATEGORIES) {
        next[cat.key] = newVal;
      }
      return next;
    });
  }, [allFiltersActive]);

  return (
    <div className="flex flex-col h-full">
      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-gray-200 bg-gray-50 rounded-t-lg">
        <button
          onClick={toggleAll}
          className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
            allFiltersActive
              ? 'bg-blue-100 text-blue-700 border border-blue-300'
              : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'
          }`}
        >
          All
        </button>
        {FILTER_CATEGORIES.map(cat => (
          <button
            key={cat.key}
            onClick={() => toggleFilter(cat.key)}
            className={`px-2 py-1 text-xs rounded font-medium transition-colors flex items-center gap-1 ${
              filters[cat.key]
                ? 'bg-blue-100 text-blue-700 border border-blue-300'
                : 'bg-gray-100 text-gray-400 border border-gray-200 hover:bg-gray-200'
            }`}
          >
            <span>{cat.icon}</span>
            {cat.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-400">
          {filteredEntries.length}/{pairedEntries.length} events
        </span>
      </div>

      {/* Event list */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-2"
        role="list"
        aria-label="Replay events"
      >
        {/* Indicator for items above window */}
        {windowStart > 0 && (
          <div className="text-center text-xs text-gray-400 py-1">
            ↑ {windowStart} earlier events
          </div>
        )}

        {windowedEntries.map((entry) => {
          const isCurrentCard = entry.index === currentStep;
          const stepNum = entry.index + 1;
          return (
            <div
              key={entry.event.id}
              ref={isCurrentCard ? currentCardRef : undefined}
              role="listitem"
            >
              <ReplayEventCard
                entry={entry}
                stepNumber={stepNum}
                isCurrent={isCurrentCard}
                sessionStartTime={sessionStartTime}
                onClick={() => onStepChange(entry.index)}
              />
            </div>
          );
        })}

        {/* Indicator for items below window */}
        {windowEnd < filteredEntries.length && (
          <div className="text-center text-xs text-gray-400 py-1">
            ↓ {filteredEntries.length - windowEnd} more events
          </div>
        )}

        {filteredEntries.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            <div className="text-2xl mb-2">🔍</div>
            <p className="text-sm">No events match the current filters</p>
          </div>
        )}
      </div>
    </div>
  );
}
