/**
 * Session Detail Page (Stories 7.2 + 7.5)
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
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AgentLensEvent, Session, SessionStatus } from '@agentlens/core';
import { getSession, getSessionTimeline } from '../api/client';
import type { SessionTimeline } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Timeline } from '../components/Timeline';
import { EventDetailPanel } from '../components/EventDetailPanel';

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
  } = useApi<SessionTimeline>(() => getSessionTimeline(id!), [id]);

  // Filter events client-side
  const currentFilter = useMemo(
    () => FILTERS.find((f) => f.key === activeFilter) ?? FILTERS[0],
    [activeFilter],
  );

  const filteredEvents = useMemo(() => {
    if (!timeline?.events) return [];
    return timeline.events.filter(currentFilter.match);
  }, [timeline?.events, currentFilter]);

  // Count per filter
  const filterCounts = useMemo(() => {
    if (!timeline?.events) return new Map<FilterKey, number>();
    const counts = new Map<FilterKey, number>();
    for (const f of FILTERS) {
      counts.set(f.key, timeline.events.filter(f.match).length);
    }
    return counts;
  }, [timeline?.events]);

  // Event click handler
  const handleEventClick = useCallback((event: AgentLensEvent) => {
    setSelectedEvent(event);
  }, []);

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

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Back button */}
      <Link
        to="/sessions"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        ← Sessions
      </Link>

      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex flex-wrap items-start gap-4 justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                {session.agentName ?? session.agentId}
              </h1>
              <StatusBadge status={session.status} />
            </div>
            {/* Tags */}
            {session.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {session.tags.map((tag) => (
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
            <StatCard label="Duration" value={formatDuration(session.startedAt, session.endedAt)} />
            <StatCard label="Events" value={session.eventCount} />
            <StatCard
              label="Errors"
              value={session.errorCount}
              className={session.errorCount > 0 ? 'border-red-200' : ''}
            />
            <StatCard label="Cost" value={`$${session.totalCostUsd.toFixed(4)}`} />
          </div>
        </div>
      </div>

      {/* Filter buttons (Story 7.5) */}
      <div className="flex flex-wrap items-center gap-2">
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
      {timelineLoading && !timeline ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
        </div>
      ) : timeline ? (
        <Timeline
          events={filteredEvents}
          chainValid={timeline.chainValid}
          onEventClick={handleEventClick}
          selectedEventId={selectedEvent?.id}
        />
      ) : null}

      {/* Event detail side panel */}
      <EventDetailPanel event={selectedEvent} onClose={handleClosePanel} />
    </div>
  );
}
