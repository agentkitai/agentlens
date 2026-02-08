/**
 * Session Replay Page (Stories 5.1–5.5)
 *
 * Route: /replay/:sessionId
 *
 * Features:
 *  - Fetches GET /api/sessions/:id/replay via api client
 *  - Loading spinner, error state (404: "Session not found")
 *  - Header: agent name, session status badge, duration, total cost, event/error/LLM/tool counts
 *  - Back button to /sessions/:id
 *  - URL query param ?step=N sets initial step
 *  - ReplayControls at top
 *  - ReplayScrubber below controls
 *  - ReplayTimeline (left) — step-by-step event view (Story 5.4)
 *  - ContextPanel (right) — cumulative state display (Story 5.5)
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { SessionStatus } from '@agentlensai/core';
import { getSessionReplay } from '../api/client';
import type { SessionReplayData } from '../api/client';
import { useApi } from '../hooks/useApi';
import { ReplayControls } from '../components/replay/ReplayControls';
import { ReplayScrubber } from '../components/replay/ReplayScrubber';
import { ReplayTimeline } from '../components/replay/ReplayTimeline';
import { ContextPanel } from '../components/replay/ContextPanel';

// ─── Status badge (reuse pattern from SessionDetail) ────────────────

const STATUS_CONFIG: Record<SessionStatus, { label: string; icon: string; className: string }> = {
  completed: { label: 'Completed', icon: '✅', className: 'bg-green-100 text-green-800 border-green-300' },
  error:     { label: 'Error',     icon: '❌', className: 'bg-red-100 text-red-800 border-red-300' },
  active:    { label: 'Active',    icon: '🔄', className: 'bg-blue-100 text-blue-800 border-blue-300' },
};

function StatusBadge({ status }: { status: SessionStatus }): React.ReactElement {
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

function StatCard({ label, value, icon, className = '' }: { label: string; value: string | number; icon: string; className?: string }): React.ReactElement {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 ${className}`}>
      <span className="text-base">{icon}</span>
      <div>
        <div className="text-xs text-gray-500 font-medium">{label}</div>
        <div className="text-sm font-semibold text-gray-900">{value}</div>
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────

export function SessionReplay(): React.ReactElement | null {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();

  // Parse initial step from URL query
  const initialStep = useMemo(() => {
    const stepParam = searchParams.get('step');
    if (stepParam) {
      const parsed = parseInt(stepParam, 10);
      return isNaN(parsed) ? 0 : Math.max(0, parsed);
    }
    return 0;
  }, []); // Only on mount — URL is updated by ReplayControls

  const [currentStep, setCurrentStep] = useState(initialStep);

  // Fetch replay data
  const {
    data: replay,
    loading,
    error,
  } = useApi<SessionReplayData>(() => getSessionReplay(sessionId!), [sessionId]);

  // Clamp step to valid range when data loads
  const totalSteps = replay?.events.length ?? 0;
  const clampedStep = Math.min(currentStep, Math.max(0, totalSteps - 1));

  const handleStepChange = useCallback(
    (step: number) => {
      setCurrentStep(Math.max(0, Math.min(step, totalSteps - 1)));
    },
    [totalSteps],
  );

  // Count event types for stats
  const stats = useMemo(() => {
    if (!replay) return null;
    const events = replay.events;
    let errorCount = 0;
    let llmCount = 0;
    let toolCount = 0;

    for (const ev of events) {
      if (
        ev.severity === 'error' ||
        ev.severity === 'critical' ||
        ev.eventType === 'tool_error' ||
        ev.eventType === 'alert_triggered'
      ) {
        errorCount++;
      }
      if (ev.eventType === 'llm_call' || ev.eventType === 'llm_response') {
        llmCount++;
      }
      if (
        ev.eventType === 'tool_call' ||
        ev.eventType === 'tool_response' ||
        ev.eventType === 'tool_error'
      ) {
        toolCount++;
      }
    }

    return { total: events.length, errorCount, llmCount, toolCount };
  }, [replay]);

  // ── 404 ───────────────────────────────────────────────────────

  if (error?.includes('404') || error?.toLowerCase().includes('not found')) {
    return (
      <div className="text-center py-16">
        <div className="text-6xl mb-4">🔍</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Session Not Found</h1>
        <p className="text-gray-500 mb-6">
          The session <code className="bg-gray-100 px-2 py-0.5 rounded text-sm">{sessionId}</code> does not exist.
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

  // ── Loading ───────────────────────────────────────────────────

  if (loading && !replay) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        <span className="text-sm text-gray-500">Loading replay…</span>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
        Error loading replay: {error}
      </div>
    );
  }

  if (!replay) return null;

  const { session, events } = replay;

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Back button */}
      <Link
        to={`/sessions/${sessionId}`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        ← Back to Session
      </Link>

      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex flex-wrap items-start gap-4 justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                🎬 {session.agentName ?? session.agentId}
              </h1>
              <StatusBadge status={session.status} />
            </div>
            <p className="text-sm text-gray-500">
              Session Replay · {formatDuration(session.startedAt, session.endedAt)}
            </p>
          </div>

          {/* Stats */}
          <div className="flex flex-wrap gap-2">
            <StatCard icon="📋" label="Events" value={stats?.total ?? 0} />
            <StatCard
              icon="❌"
              label="Errors"
              value={stats?.errorCount ?? 0}
              className={stats && stats.errorCount > 0 ? 'border-red-200' : ''}
            />
            <StatCard icon="🧠" label="LLM" value={stats?.llmCount ?? 0} />
            <StatCard icon="🔧" label="Tools" value={stats?.toolCount ?? 0} />
            <StatCard icon="💰" label="Cost" value={`$${session.totalCostUsd.toFixed(4)}`} />
          </div>
        </div>
      </div>

      {/* Replay controls */}
      <ReplayControls
        currentStep={clampedStep}
        totalSteps={totalSteps}
        onStepChange={handleStepChange}
        disabled={loading}
      />

      {/* Timeline scrubber */}
      <ReplayScrubber
        events={events}
        currentStep={clampedStep}
        onStepChange={handleStepChange}
      />

      {/* Timeline + Context Panel */}
      <div className="flex bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden" style={{ height: 'calc(100vh - 340px)', minHeight: 400 }}>
        {/* Left: ReplayTimeline */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <ReplayTimeline
            events={events}
            currentStep={clampedStep}
            onStepChange={handleStepChange}
            sessionStartTime={session.startedAt}
          />
        </div>

        {/* Right: ContextPanel */}
        <ContextPanel
          events={events}
          currentStep={clampedStep}
          sessionStartTime={session.startedAt}
        />
      </div>
    </div>
  );
}
