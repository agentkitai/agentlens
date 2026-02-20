/**
 * Session Detail Page (Stories 7.2 + 7.5 + 14.3)
 *
 * Route: /sessions/:id
 *
 * Features:
 *  - Header: agent name, status badge, duration, event/error count, tags
 *  - Pulsing "running" indicator for active sessions
 *  - Back button ← Sessions
 *  - 404 message for missing sessions
 *  - Timeline event type filter buttons (All, Tool Calls, Errors, Approvals, Custom)
 *  - Client-side filtering with event count per filter
 *  - Live timeline updates via SSE for active sessions (Story 14.3)
 *  - Connection indicator (green dot / yellow warning)
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AgentLensEvent, Session, SessionStatus, CostTrackedPayload } from '@agentlensai/core';
import { getSession, getSessionTimeline } from '../api/client';
import type { SessionTimeline } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useSSE } from '../hooks/useSSE';
import { Timeline } from '../components/Timeline';
import { EventDetailPanel } from '../components/EventDetailPanel';
import { SearchBar } from '../components/search/SearchBar';
import { ErrorNav } from '../components/navigation/ErrorNav';
import { ExportMenu } from '../components/export/ExportMenu';
import { useErrorIndices } from '../hooks/useErrorIndices';

// ─── Filter definitions ─────────────────────────────────────────────

type FilterKey = 'all' | 'tool_calls' | 'errors' | 'approvals' | 'custom';

interface FilterDef {
  key: FilterKey;
  label: string;
  icon: string;
  match: (ev: AgentLensEvent) => boolean;
}

const FILTERS: FilterDef[] = [
  {
    key: 'all',
    label: 'All',
    icon: '📋',
    match: () => true,
  },
  {
    key: 'tool_calls',
    label: 'Tool Calls',
    icon: '🔧',
    match: (ev) =>
      ev.eventType === 'tool_call' ||
      ev.eventType === 'tool_response' ||
      ev.eventType === 'tool_error',
  },
  {
    key: 'errors',
    label: 'Errors',
    icon: '❌',
    match: (ev) =>
      ev.severity === 'error' ||
      ev.severity === 'critical' ||
      ev.eventType === 'tool_error' ||
      ev.eventType === 'alert_triggered',
  },
  {
    key: 'approvals',
    label: 'Approvals',
    icon: '🔔',
    match: (ev) =>
      ev.eventType === 'approval_requested' ||
      ev.eventType === 'approval_granted' ||
      ev.eventType === 'approval_denied' ||
      ev.eventType === 'approval_expired',
  },
  {
    key: 'custom',
    label: 'Custom',
    icon: '🔹',
    match: (ev) => ev.eventType === 'custom',
  },
];

// ─── Status badges ──────────────────────────────────────────────────

const STATUS_CONFIG: Record<SessionStatus, { label: string; icon: string; className: string }> = {
  completed: { label: 'Completed', icon: '✅', className: 'bg-green-100 text-green-800 border-green-300' },
  error:     { label: 'Error',     icon: '❌', className: 'bg-red-100 text-red-800 border-red-300' },
  active:    { label: 'Active',    icon: '🔄', className: 'bg-blue-100 text-blue-800 border-blue-300' },
};

function StatusBadge({ status }: { status: SessionStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-medium border ${cfg.className}`}
    >
      {status === 'active' && (
        <span className="relative flex h-2 w-2 mr-0.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
        </span>
      )}
      <span>{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}

// ─── Duration formatting ────────────────────────────────────────────

function formatDuration(startedAt: string, endedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const diffMs = end - start;
  if (diffMs < 1000) return `${diffMs}ms`;
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

// ─── Stat card ──────────────────────────────────────────────────────

function StatCard({ label, value, className = '' }: { label: string; value: string | number; className?: string }) {
  return (
    <div className={`px-4 py-2 bg-white rounded-lg border border-gray-200 ${className}`}>
      <div className="text-xs text-gray-500 font-medium">{label}</div>
      <div className="text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────

export function SessionDetail(): React.ReactElement | null {
  const { id } = useParams<{ id: string }>();
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [selectedEvent, setSelectedEvent] = useState<AgentLensEvent | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // SSE live events that arrive after initial load (Story 14.3)
  const [liveEvents, setLiveEvents] = useState<AgentLensEvent[]>([]);
  const [liveSession, setLiveSession] = useState<Session | null>(null);

  // Fetch session info
  const {
    data: session,
    loading: sessionLoading,
    error: sessionError,
  } = useApi<Session>(() => getSession(id!), [id]);

  // Fetch timeline
  const {
    data: timeline,
    loading: timelineLoading,
    error: timelineError,
    refetch: refetchTimeline,
  } = useApi<SessionTimeline>(() => getSessionTimeline(id!), [id]);

  // Determine effective session (live updates override initial fetch)
  const effectiveSession = liveSession ?? session;
  const isSessionActive = effectiveSession?.status === 'active';

  // SSE connection for live updates (Story 14.3)
  // Only connect when session is active
  const { connected: sseConnected } = useSSE({
    url: '/api/stream',
    params: { sessionId: id },
    enabled: isSessionActive,
    onEvent: useCallback((data: unknown) => {
      const event = data as AgentLensEvent;
      setLiveEvents((prev) => {
        // Deduplicate by event id
        if (prev.some((e) => e.id === event.id)) return prev;
        return [...prev, event];
      });
    }, []),
    onSessionUpdate: useCallback((data: unknown) => {
      const updated = data as Session;
      setLiveSession(updated);
    }, []),
  });

  // Reset live state when session id changes
  // (note: this is handled by the dependency array on useApi and useSSE,
  //  but we also clear local live state)
  const prevIdRef = React.useRef(id);
  if (prevIdRef.current !== id) {
    prevIdRef.current = id;
    setLiveEvents([]);
    setLiveSession(null);
  }

  // Merge initial timeline events with SSE live events
  const allEvents = useMemo(() => {
    if (!timeline?.events) return liveEvents;
    const existingIds = new Set(timeline.events.map((e) => e.id));
    const newEvents = liveEvents.filter((e) => !existingIds.has(e.id));
    return [...timeline.events, ...newEvents];
  }, [timeline?.events, liveEvents]);

  // Filter events client-side
  const currentFilter = useMemo(
    () => FILTERS.find((f) => f.key === activeFilter) ?? FILTERS[0],
    [activeFilter],
  );

  const typeFilteredEvents = useMemo(() => {
    return allEvents.filter(currentFilter.match);
  }, [allEvents, currentFilter]);

  // [F11-S1] Search filter step
  const filteredEvents = useMemo(() => {
    if (!searchQuery) return typeFilteredEvents;
    const q = searchQuery.toLowerCase();
    return typeFilteredEvents.filter(
      (ev) =>
        JSON.stringify(ev.payload).toLowerCase().includes(q) ||
        ev.eventType.toLowerCase().includes(q),
    );
  }, [typeFilteredEvents, searchQuery]);

  // [F11-S2] Error navigation indices
  const errorIndices = useErrorIndices(filteredEvents);

  // Count per filter (uses merged events)
  const filterCounts = useMemo(() => {
    if (allEvents.length === 0) return new Map<FilterKey, number>();
    const counts = new Map<FilterKey, number>();
    for (const f of FILTERS) {
      counts.set(f.key, allEvents.filter(f.match).length);
    }
    return counts;
  }, [allEvents]);

  // Event click handler
  const handleEventClick = useCallback((event: AgentLensEvent) => {
    setSelectedEvent(event);
  }, []);

  // [F11-S2] Error navigation handler
  const handleErrorNavigate = useCallback(
    (index: number) => {
      const event = filteredEvents[index];
      if (event) setSelectedEvent(event);
    },
    [filteredEvents],
  );

  const handleClosePanel = useCallback(() => {
    setSelectedEvent(null);
  }, []);

  // ── 404 ───────────────────────────────────────────────────────────

  if (sessionError?.includes('404') || sessionError?.toLowerCase().includes('not found')) {
    return (
      <div className="text-center py-16">
        <div className="text-6xl mb-4">🔍</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Session Not Found</h1>
        <p className="text-gray-500 mb-6">
          The session <code className="bg-gray-100 px-2 py-0.5 rounded text-sm">{id}</code> does not exist.
        </p>
        <Link
          to="/sessions"
          className="text-blue-600 hover:text-blue-800 font-medium"
        >
          ← Back to Sessions
        </Link>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────

  if (sessionLoading && !session) {
    return (
      <div className="flex justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (sessionError) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
        Error loading session: {sessionError}
      </div>
    );
  }

  if (!session) return null;

  // Use effectiveSession (with live updates) for rendering
  const displaySession = effectiveSession ?? session;

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Back button + Replay link */}
      <div className="flex items-center justify-between">
        <Link
          to="/sessions"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← Sessions
        </Link>
        <div className="flex items-center gap-2">
          {/* [F11-S3] Export */}
          {timeline && (
            <ExportMenu
              sessionId={id!}
              session={displaySession}
              events={allEvents}
              chainValid={timeline.chainValid}
            />
          )}
          <Link
            to={`/replay/${id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
          >
            🎬 Replay
          </Link>
        </div>
      </div>

      {/* SSE Connection Indicator (Story 14.3) */}
      {isSessionActive && (
        <div className="flex items-center gap-2 text-xs">
          {sseConnected ? (
            <>
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
              </span>
              <span className="text-green-700">Live — receiving updates</span>
            </>
          ) : (
            <>
              <span className="relative flex h-2.5 w-2.5">
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-400" />
              </span>
              <span className="text-yellow-700">Reconnecting…</span>
            </>
          )}
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex flex-wrap items-start gap-4 justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                {displaySession.agentName ?? displaySession.agentId}
              </h1>
              <StatusBadge status={displaySession.status} />
            </div>
            {/* Tags */}
            {displaySession.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {displaySession.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-block px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="flex flex-wrap gap-3">
            <StatCard label="Duration" value={formatDuration(displaySession.startedAt, displaySession.endedAt)} />
            <StatCard label="Events" value={displaySession.eventCount} />
            <StatCard
              label="Errors"
              value={displaySession.errorCount}
              className={displaySession.errorCount > 0 ? 'border-red-200' : ''}
            />
            <StatCard label="Cost" value={`$${displaySession.totalCostUsd.toFixed(4)}`} />
          </div>
        </div>
      </div>

      {/* Cost Summary (Story 11.5) */}
      {displaySession.totalCostUsd > 0 && allEvents.length > 0 && (() => {
        const costEvents = allEvents.filter(
          (ev) => ev.eventType === 'cost_tracked',
        );
        if (costEvents.length === 0) return null;

        // Group by model/provider
        const breakdown = new Map<string, { provider: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number; count: number }>();
        for (const ev of costEvents) {
          const p = ev.payload as CostTrackedPayload;
          const key = `${p.provider}/${p.model}`;
          const existing = breakdown.get(key);
          if (existing) {
            existing.inputTokens += p.inputTokens;
            existing.outputTokens += p.outputTokens;
            existing.totalTokens += p.totalTokens;
            existing.costUsd += p.costUsd;
            existing.count += 1;
          } else {
            breakdown.set(key, {
              provider: p.provider,
              model: p.model,
              inputTokens: p.inputTokens,
              outputTokens: p.outputTokens,
              totalTokens: p.totalTokens,
              costUsd: p.costUsd,
              count: 1,
            });
          }
        }

        const totalInputTokens = costEvents.reduce((sum, ev) => sum + (ev.payload as CostTrackedPayload).inputTokens, 0);
        const totalOutputTokens = costEvents.reduce((sum, ev) => sum + (ev.payload as CostTrackedPayload).outputTokens, 0);

        return (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
              💰 Cost Breakdown
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div>
                <div className="text-xs text-gray-500 font-medium">Total Cost</div>
                <div className="text-lg font-semibold text-gray-900">${displaySession.totalCostUsd.toFixed(4)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 font-medium">Input Tokens</div>
                <div className="text-lg font-semibold text-gray-900">{totalInputTokens.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 font-medium">Output Tokens</div>
                <div className="text-lg font-semibold text-gray-900">{totalOutputTokens.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 font-medium">Cost Events</div>
                <div className="text-lg font-semibold text-gray-900">{costEvents.length}</div>
              </div>
            </div>
            {breakdown.size > 1 && (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Provider / Model</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Cost</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Input</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Output</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Calls</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {Array.from(breakdown.values()).map((b) => (
                      <tr key={`${b.provider}/${b.model}`} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-900">
                          <span className="font-medium">{b.model}</span>
                          <span className="text-gray-400 ml-1 text-xs">({b.provider})</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono">${b.costUsd.toFixed(4)}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{b.inputTokens.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{b.outputTokens.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{b.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {/* [F11-S1] Search bar */}
      <SearchBar
        onQueryChange={setSearchQuery}
        resultCount={filteredEvents.length}
        totalCount={allEvents.length}
      />

      {/* Filter buttons (Story 7.5) + [F11-S2] Error nav */}
      <div className="flex flex-wrap items-center gap-2">
        {/* [F11-S2] Error navigation */}
        <ErrorNav
          errorIndices={errorIndices}
          currentIndex={filteredEvents.indexOf(selectedEvent!)}
          onNavigate={handleErrorNavigate}
        />
        {FILTERS.map((f) => {
          const count = filterCounts.get(f.key) ?? 0;
          const isActive = activeFilter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full border transition-colors ${
                isActive
                  ? 'bg-blue-100 border-blue-300 text-blue-800 font-medium'
                  : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span>{f.icon}</span>
              {f.label}
              <span className={`text-xs ${isActive ? 'bg-blue-200 text-blue-900' : 'bg-gray-100 text-gray-500'} px-1.5 py-0.5 rounded-full`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Timeline */}
      {timelineError ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700 text-sm">Error loading timeline: {timelineError}</p>
          <button
            onClick={refetchTimeline}
            className="mt-2 px-3 py-1.5 text-sm rounded border border-red-300 text-red-700 hover:bg-red-100"
          >
            ↻ Retry
          </button>
        </div>
      ) : timelineLoading && !timeline ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
        </div>
      ) : timeline ? (
        <Timeline
          events={filteredEvents}
          chainValid={timeline.chainValid}
          onEventClick={handleEventClick}
          selectedEventId={selectedEvent?.id}
          searchQuery={searchQuery}
        />
      ) : null}

      {/* Event detail side panel */}
      <EventDetailPanel event={selectedEvent} onClose={handleClosePanel} allEvents={allEvents} />
    </div>
  );
}
