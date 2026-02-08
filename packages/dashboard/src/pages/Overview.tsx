import React, { useMemo } from 'react';
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
  StorageStats,
  EventQueryResult,
  SessionQueryResult,
} from '@agentlens/core';
import { useApi } from '../hooks/useApi';
import { getStats, getEvents, getSessions } from '../api/client';
import { MetricsGrid } from '../components/MetricsGrid';
import type { MetricCard } from '../components/MetricsGrid';

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
  const now = useMemo(() => new Date(), []);
  const todayStart = useMemo(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, [now]);
  const yesterdayStart = useMemo(() => {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, [now]);
  const last24h = useMemo(() => new Date(now.getTime() - 86400_000).toISOString(), [now]);

  // Fetch stats
  const stats = useApi<StorageStats>(() => getStats(), []);

  // Events today (total count only — limit:1 since we only need the `total`)
  const eventsToday = useApi<EventQueryResult>(
    () => getEvents({ from: todayStart, limit: 1, order: 'desc' }),
    [todayStart],
  );

  // Events yesterday (total count only)
  const eventsYesterday = useApi<EventQueryResult>(
    () => getEvents({ from: yesterdayStart, to: todayStart, limit: 1, order: 'desc' }),
    [yesterdayStart, todayStart],
  );

  // Error counts today (use server-side severity filter + total)
  const errorsToday = useApi<EventQueryResult>(
    () => getEvents({ from: todayStart, severity: ['error', 'critical'], limit: 1, order: 'desc' }),
    [todayStart],
  );

  // Error counts yesterday (for trend)
  const errorsYesterday = useApi<EventQueryResult>(
    () => getEvents({ from: yesterdayStart, to: todayStart, severity: ['error', 'critical'], limit: 1, order: 'desc' }),
    [yesterdayStart, todayStart],
  );

  // Recent sessions
  const sessions = useApi<SessionQueryResult & { hasMore: boolean }>(
    () => getSessions({ limit: 10 }),
    [],
  );

  // Sessions today for count
  const sessionsToday = useApi<SessionQueryResult & { hasMore: boolean }>(
    () => getSessions({ from: todayStart, limit: 1000 }),
    [todayStart],
  );

  // Sessions yesterday for trend
  const sessionsYesterday = useApi<SessionQueryResult & { hasMore: boolean }>(
    () => getSessions({ from: yesterdayStart, to: todayStart, limit: 1000 }),
    [yesterdayStart, todayStart],
  );

  // Events last 24h for chart
  const eventsChart = useApi<EventQueryResult>(
    () => getEvents({ from: last24h, limit: 5000, order: 'asc' }),
    [last24h],
  );

  // Recent errors
  const recentErrors = useApi<EventQueryResult>(
    () => getEvents({ severity: ['error', 'critical'], limit: 10, order: 'desc' }),
    [],
  );

  // ─── Computed metrics ───────────────────────────────────────────

  const todayErrorCount = errorsToday.data?.total ?? 0;
  const yesterdayErrorCount = errorsYesterday.data?.total ?? 0;

  const todaySessionCount = sessionsToday.data?.total ?? 0;
  const yesterdaySessionCount = sessionsYesterday.data?.total ?? 0;

  const metricsLoading =
    eventsToday.loading || eventsYesterday.loading || errorsToday.loading || errorsYesterday.loading || sessionsToday.loading || sessionsYesterday.loading || stats.loading;

  const cards: MetricCard[] = [
    {
      label: 'Sessions Today',
      value: todaySessionCount,
      currentValue: todaySessionCount,
      previousValue: yesterdaySessionCount,
    },
    {
      label: 'Events Today',
      value: eventsToday.data?.total ?? 0,
      currentValue: eventsToday.data?.total ?? 0,
      previousValue: eventsYesterday.data?.total ?? 0,
    },
    {
      label: 'Errors Today',
      value: todayErrorCount,
      currentValue: todayErrorCount,
      previousValue: yesterdayErrorCount,
    },
    {
      label: 'Active Agents',
      value: stats.data?.totalAgents ?? 0,
    },
  ];

  // Chart data
  const chartData = useMemo(() => {
    if (!eventsChart.data) return [];
    return bucketByHour(eventsChart.data.events);
  }, [eventsChart.data]);

  const recentSessions: Session[] = sessions.data?.sessions ?? [];
  const recentErrorEvents: AgentLensEvent[] = recentErrors.data?.events ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Overview</h2>
        <p className="mt-1 text-sm text-gray-500">
          Real-time overview of your agent activity.
        </p>
      </div>

      {/* Metrics Cards */}
      <MetricsGrid cards={cards} loading={metricsLoading} />

      {/* Charts & Feeds Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Events Over Time */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-gray-900">Events Over Time</h3>
          <p className="text-xs text-gray-500 mb-4">Last 24 hours (hourly)</p>
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
