import React, { useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import type {
  AgentLensEvent,
  Session,
  EventQueryResult,
  SessionQueryResult,
} from '@agentlensai/core';
import { useApi } from '../hooks/useApi';
import { useSSE } from '../hooks/useSSE';
import { getOverviewStats, getEvents, getSessions, getLlmAnalytics, getAnalytics } from '../api/client';
import type { LlmAnalyticsResult, OverviewStats } from '../api/client';
import { MetricsGrid } from '../components/MetricsGrid';
import type { MetricCard } from '../components/MetricsGrid';
import { TimeRangePicker, DEFAULT_TIME_RANGE } from '../components/TimeRangePicker';
import type { TimeRange } from '../components/TimeRangePicker';

// ─── Helpers ────────────────────────────────────────────────────────

function formatHour(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function statusColor(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-green-100 text-green-700';
    case 'completed':
      return 'bg-blue-100 text-blue-700';
    case 'error':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

function severityColor(severity: string): string {
  switch (severity) {
    case 'error':
      return 'text-red-600';
    case 'critical':
      return 'text-red-800 font-semibold';
    case 'warn':
      return 'text-yellow-600';
    default:
      return 'text-gray-600';
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Hourly bucketing ───────────────────────────────────────────────

interface HourlyBucket {
  hour: string;
  count: number;
}

function bucketByHour(events: AgentLensEvent[]): HourlyBucket[] {
  const now = new Date();
  const buckets = new Map<string, number>();

  // Pre-fill 24 hourly buckets
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600_000);
    const key = d.toISOString().slice(0, 13); // YYYY-MM-DDTHH
    buckets.set(key, 0);
  }

  for (const ev of events) {
    const key = ev.timestamp.slice(0, 13);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }

  return Array.from(buckets.entries()).map(([hour, count]) => ({
    hour: formatHour(`${hour}:00:00Z`),
    count,
  }));
}

// ─── Component ──────────────────────────────────────────────────────

export function Overview(): React.ReactElement {
  // SSE live counters (Story 14.4)
  const [liveEventDelta, setLiveEventDelta] = useState(0);
  const [liveSessionRefreshKey, setLiveSessionRefreshKey] = useState(0);

  // SSE connection for real-time updates
  const { connected: sseConnected } = useSSE({
    url: '/api/stream',
    onEvent: useCallback(() => {
      // Increment live counter for each event received
      setLiveEventDelta((d) => d + 1);
    }, []),
    onSessionUpdate: useCallback(() => {
      // Trigger session list refresh
      setLiveSessionRefreshKey((k) => k + 1);
    }, []),
  });

  const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);

  const now = useMemo(() => new Date(), []);
  const todayStart = useMemo(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, [now]);
  const last24h = useMemo(() => new Date(now.getTime() - 86400_000).toISOString(), [now]);

  // ─── API call 1: Consolidated overview stats ────────────────────
  const overview = useApi<OverviewStats>(
    () => getOverviewStats({ from: timeRange.from, to: timeRange.to }),
    [timeRange],
  );

  // ─── API call 2: Recent sessions (refetched on SSE session updates) ──
  const sessions = useApi<SessionQueryResult & { hasMore: boolean }>(
    () => getSessions({ limit: 10 }),
    [liveSessionRefreshKey],
  );

  // ─── API call 3: Events for chart (use analytics buckets) ──
  const eventsChart = useApi<{ buckets: Array<{ timestamp: string; eventCount: number; toolCallCount: number; errorCount: number }> }>(
    () => getAnalytics(timeRange.range
      ? { range: timeRange.range, granularity: timeRange.granularity }
      : { from: timeRange.from, to: timeRange.to, granularity: timeRange.granularity }),
    [timeRange],
  );

  // Recent errors (included as sub-query in eventsChart or separate small call)
  const recentErrors = useApi<EventQueryResult>(
    () => getEvents({ severity: ['error', 'critical'], limit: 10, order: 'desc' }),
    [],
  );

  // LLM analytics (selected range)
  const llmToday = useApi<LlmAnalyticsResult>(
    () => getLlmAnalytics({
      from: timeRange.from,
      to: timeRange.to,
      granularity: timeRange.granularity,
    }),
    [timeRange],
  );

  // ─── Computed metrics ───────────────────────────────────────────

  const metricsLoading = overview.loading;

  // Add live event delta to "Events Today" for real-time counter (Story 14.4)
  const eventsTodayCount = (overview.data?.eventsTodayCount ?? 0) + liveEventDelta;

  // LLM metrics
  const llmCallCount = llmToday.data?.summary?.totalCalls ?? 0;
  const llmCostUsd = llmToday.data?.summary?.totalCostUsd ?? 0;

  // Short suffix for metric card labels based on selected range
  const rangeSuffix = timeRange.range === '24h' ? 'Today' : timeRange.label.replace('Last ', '');

  const cards: MetricCard[] = [
    {
      label: `Sessions (${rangeSuffix})`,
      value: overview.data?.sessionsTodayCount ?? 0,
      currentValue: overview.data?.sessionsTodayCount ?? 0,
      previousValue: overview.data?.sessionsYesterdayCount ?? 0,
    },
    {
      label: `Events (${rangeSuffix})`,
      value: eventsTodayCount,
      currentValue: eventsTodayCount,
      previousValue: overview.data?.eventsYesterdayCount ?? 0,
    },
    {
      label: `Errors (${rangeSuffix})`,
      value: overview.data?.errorsTodayCount ?? 0,
      currentValue: overview.data?.errorsTodayCount ?? 0,
      previousValue: overview.data?.errorsYesterdayCount ?? 0,
    },
    {
      label: 'Active Agents',
      value: overview.data?.totalAgents ?? 0,
    },
  ];

  // Add LLM metrics when LLM data is available
  if (llmCallCount > 0 || (llmToday.data && !llmToday.loading)) {
    cards.push(
      {
        label: `LLM Calls (${rangeSuffix})`,
        value: llmCallCount,
      },
      {
        label: `LLM Cost (${rangeSuffix})`,
        value: llmCostUsd < 0.01 ? `$${llmCostUsd.toFixed(4)}` : llmCostUsd < 1 ? `$${llmCostUsd.toFixed(3)}` : `$${llmCostUsd.toFixed(2)}`,
      },
    );
  }

  // Chart data — use pre-bucketed analytics data
  const chartData = useMemo(() => {
    if (!eventsChart.data?.buckets) return [];
    return eventsChart.data.buckets.map((b) => {
      const d = new Date(b.timestamp);
      const label = timeRange.granularity === 'day'
        ? d.toLocaleDateString([], { month: 'short', day: 'numeric' })
        : formatHour(b.timestamp);
      const tooltip = timeRange.granularity === 'day'
        ? d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
        : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return { hour: label, tooltip, count: b.eventCount };
    });
  }, [eventsChart.data, timeRange.granularity]);

  const recentSessions: Session[] = sessions.data?.sessions ?? [];
  const recentErrorEvents: AgentLensEvent[] = recentErrors.data?.events ?? [];

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Overview</h2>
          <p className="mt-1 text-sm text-gray-500">
            Real-time overview of your agent activity.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <TimeRangePicker value={timeRange} onChange={setTimeRange} />
        {/* SSE Connection Indicator (Story 14.4) */}
        <div className="flex items-center gap-2 text-xs mt-1">
          {sseConnected ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              <span className="text-green-700">Live</span>
            </>
          ) : (
            <>
              <span className="relative flex h-2 w-2">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-400" />
              </span>
              <span className="text-yellow-700">Connection lost — data may be stale</span>
            </>
          )}
        </div>
        </div>
      </div>

      {/* Metrics Cards */}
      <MetricsGrid cards={cards} loading={metricsLoading} />

      {/* Charts & Feeds Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Events Over Time */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-gray-900">Events Over Time</h3>
          <p className="text-xs text-gray-500 mb-4">{timeRange.label}</p>
          {eventsChart.loading ? (
            <div className="h-64 animate-pulse rounded bg-gray-100" />
          ) : (
            <ResponsiveContainer width="100%" height={256}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="hour"
                  tick={{ fontSize: 11 }}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '13px',
                  }}
                  labelFormatter={(_label, payload) => {
                    const item = payload?.[0]?.payload;
                    return item?.tooltip ?? _label;
                  }}
                />
                <Bar dataKey="count" fill="#0c8ce9" radius={[4, 4, 0, 0]} name="Events" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Recent Sessions */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-gray-900">Recent Sessions</h3>
          <p className="text-xs text-gray-500 mb-4">10 most recent</p>
          {sessions.loading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />
              ))}
            </div>
          ) : recentSessions.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No sessions yet</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {recentSessions.map((s) => (
                <li key={s.id}>
                  <Link
                    to={`/sessions/${s.id}`}
                    className="flex items-center justify-between py-2.5 hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {s.agentName ?? s.agentId}
                      </p>
                      <p className="text-xs text-gray-400 truncate font-mono">
                        {s.id.slice(0, 12)}…
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(s.status)}`}
                      >
                        {s.status}
                      </span>
                      <span className="text-xs text-gray-400">
                        {relativeTime(s.startedAt)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Recent Errors */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-gray-900">Recent Errors</h3>
        <p className="text-xs text-gray-500 mb-4">10 most recent error events</p>
        {recentErrors.loading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />
            ))}
          </div>
        ) : recentErrorEvents.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">No errors — looking good! 🎉</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recentErrorEvents.map((ev) => (
              <li key={ev.id} className="py-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-medium uppercase ${severityColor(ev.severity)}`}
                      >
                        {ev.severity}
                      </span>
                      <span className="text-sm font-medium text-gray-900">
                        {ev.eventType}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500 font-mono truncate">
                      Session: {ev.sessionId.slice(0, 12)}… | Agent: {ev.agentId}
                    </p>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0 ml-4">
                    {relativeTime(ev.timestamp)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
