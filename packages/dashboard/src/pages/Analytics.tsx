/**
 * Analytics Page (Story 11.3)
 *
 * Route: /analytics
 *
 * Features:
 *  - Time range controls: 24h, 7d, 30d
 *  - Events Over Time chart (line)
 *  - Error Rate trend (area)
 *  - Tool Usage breakdown (bar)
 *  - Cost Over Time chart (bar, stacked by agent)
 */
import React, { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageSkeleton } from '../components/PageSkeleton';
import { TimeRangePicker, DEFAULT_TIME_RANGE, type TimeRange as PickerTimeRange } from '../components/TimeRangePicker';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { useApi } from '../hooks/useApi';
import {
  getAnalytics,
  getCostAnalytics,
  getToolAnalytics,
} from '../api/client';
import type {
  AnalyticsResult,
  CostAnalyticsResult,
  ToolAnalytics,
} from '../api/client';

// ─── Types ──────────────────────────────────────────────────────────

type TimeRange = '24h' | '7d' | '30d';

interface TimeRangeConfig {
  label: string;
  from: () => string;
  granularity: 'hour' | 'day' | 'week';
}

const TIME_RANGES: Record<TimeRange, TimeRangeConfig> = {
  '24h': {
    label: 'Last 24 Hours',
    from: () => new Date(Date.now() - 86400_000).toISOString(),
    granularity: 'hour',
  },
  '7d': {
    label: 'Last 7 Days',
    from: () => new Date(Date.now() - 7 * 86400_000).toISOString(),
    granularity: 'day',
  },
  '30d': {
    label: 'Last 30 Days',
    from: () => new Date(Date.now() - 30 * 86400_000).toISOString(),
    granularity: 'day',
  },
};

// ─── Lazy tab content (merged pages) ────────────────────────────────

const LlmAnalytics = React.lazy(() => import('./LlmAnalytics').then(m => ({ default: m.LlmAnalytics })));
const EventsExplorer = React.lazy(() => import('./EventsExplorer').then(m => ({ default: m.EventsExplorer })));
const HealthOverview = React.lazy(() => import('./HealthOverview').then(m => ({ default: m.HealthOverview })));
const CostOptimization = React.lazy(() => import('./CostOptimization').then(m => ({ default: m.CostOptimization })));
const Insights = React.lazy(() => import('./Insights').then(m => ({ default: m.Insights })));

type AnalyticsTab = 'overview' | 'llm' | 'events' | 'health' | 'cost' | 'insights';

const ANALYTICS_TABS: { key: AnalyticsTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'llm', label: 'LLM' },
  { key: 'events', label: 'Events' },
  { key: 'health', label: 'Health' },
  { key: 'cost', label: 'Cost' },
  { key: 'insights', label: 'Insights' },
];

// ─── Colors ─────────────────────────────────────────────────────────

const COLORS = ['#0c8ce9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

// ─── Formatters ─────────────────────────────────────────────────────

function formatBucketLabel(ts: string, range: TimeRange): string {
  if (!ts) return '';
  if (range === '24h') {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const d = new Date(ts);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ─── Metric Card ────────────────────────────────────────────────────

function MetricCard({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <span className="text-xs font-medium text-gray-500 uppercase">{label}</span>
      </div>
      <div className="mt-1 text-xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────

function AnalyticsOverview(): React.ReactElement {
  const [timeRange, setTimeRange] = useState<PickerTimeRange>(DEFAULT_TIME_RANGE);

  const from = timeRange.from;
  const to = timeRange.to ?? new Date().toISOString();
  const granularity = (timeRange.granularity ?? 'hour') as 'hour' | 'day' | 'week';
  // Keep `range` for bucket label formatting
  const range: TimeRange = (['24h', '7d', '30d'].includes(timeRange.range ?? '') ? timeRange.range : '24h') as TimeRange;

  // Fetch analytics data
  const { data: analytics, loading: analyticsLoading } = useApi<AnalyticsResult>(
    () => getAnalytics({ from, to, granularity }),
    [from, to, granularity],
  );

  const { data: costs, loading: costsLoading } = useApi<CostAnalyticsResult>(
    () => getCostAnalytics({ from, to, granularity }),
    [from, to, granularity],
  );

  const { data: toolsData, loading: toolsLoading } = useApi<{ tools: ToolAnalytics[] }>(
    () => getToolAnalytics({ from, to }),
    [from, to],
  );

  // Chart data
  const eventsChartData = useMemo(() => {
    if (!analytics?.buckets) return [];
    return analytics.buckets.map((b) => ({
      label: formatBucketLabel(b.timestamp, range),
      events: b.eventCount,
      toolCalls: b.toolCallCount,
      errors: b.errorCount,
    }));
  }, [analytics, range]);

  const errorRateData = useMemo(() => {
    if (!analytics?.buckets) return [];
    return analytics.buckets.map((b) => ({
      label: formatBucketLabel(b.timestamp, range),
      errorRate: b.eventCount > 0 ? (b.errorCount / b.eventCount) * 100 : 0,
    }));
  }, [analytics, range]);

  // Collect all unique agent IDs from cost data for stacked bars
  const costAgentIds = useMemo(() => {
    if (!costs?.overTime) return [];
    const agentSet = new Set<string>();
    for (const b of costs.overTime) {
      if (b.byAgent) {
        for (const agentId of Object.keys(b.byAgent)) {
          agentSet.add(agentId);
        }
      }
    }
    return Array.from(agentSet);
  }, [costs]);

  const costChartData = useMemo(() => {
    if (!costs?.overTime) return [];
    return costs.overTime.map((b) => {
      const row: Record<string, unknown> = {
        label: formatBucketLabel(b.bucket, range),
      };
      // Add per-agent cost fields for stacked bars
      if (b.byAgent && costAgentIds.length > 0) {
        for (const agentId of costAgentIds) {
          row[agentId] = b.byAgent[agentId] ?? 0;
        }
      } else {
        row['cost'] = b.totalCostUsd;
      }
      return row;
    });
  }, [costs, range, costAgentIds]);

  const toolChartData = useMemo(() => {
    if (!toolsData?.tools) return [];
    return toolsData.tools.slice(0, 10).map((t) => ({
      name: t.toolName,
      calls: t.callCount,
      errors: t.errorCount,
    }));
  }, [toolsData]);

  const toolPieData = useMemo(() => {
    if (!toolsData?.tools) return [];
    return toolsData.tools.slice(0, 8).map((t) => ({
      name: t.toolName,
      value: t.callCount,
    }));
  }, [toolsData]);

  const isLoading = analyticsLoading || costsLoading || toolsLoading;

  return (
    <div className="space-y-6">
      {/* Header + Time Range */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">
            Aggregated metrics, trends, and cost insights.
          </p>
        </div>
        <TimeRangePicker value={timeRange} onChange={setTimeRange} />
      </div>

      {/* Summary Metrics */}
      {analytics && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <MetricCard label="Total Events" value={formatNumber(analytics.totals.eventCount)} icon="📊" />
          <MetricCard label="Tool Calls" value={formatNumber(analytics.totals.toolCallCount)} icon="🔧" />
          <MetricCard label="Errors" value={formatNumber(analytics.totals.errorCount)} icon="❌" />
          <MetricCard label="Sessions" value={formatNumber(analytics.totals.uniqueSessions)} icon="📋" />
          <MetricCard label="Agents" value={formatNumber(analytics.totals.uniqueAgents)} icon="🤖" />
          <MetricCard label="Total Cost" value={formatCost(costs?.totals?.totalCostUsd ?? analytics.totals.totalCostUsd)} icon="💰" />
        </div>
      )}

      {/* Charts Row 1: Events Over Time + Error Rate */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Events Over Time */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-gray-900">Events Over Time</h3>
          <p className="text-xs text-gray-500 mb-4">{timeRange.label}</p>
          {isLoading ? (
            <div className="h-64 animate-pulse rounded bg-gray-100" />
          ) : (
            <ResponsiveContainer width="100%" height={256}>
              <LineChart data={eventsChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '13px',
                  }}
                />
                <Legend />
                <Line type="monotone" dataKey="events" stroke="#0c8ce9" strokeWidth={2} dot={false} name="Events" />
                <Line type="monotone" dataKey="toolCalls" stroke="#10b981" strokeWidth={2} dot={false} name="Tool Calls" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Error Rate */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-gray-900">Error Rate</h3>
          <p className="text-xs text-gray-500 mb-4">{timeRange.label}</p>
          {isLoading ? (
            <div className="h-64 animate-pulse rounded bg-gray-100" />
          ) : (
            <ResponsiveContainer width="100%" height={256}>
              <AreaChart data={errorRateData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} unit="%" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '13px',
                  }}
                  formatter={(value: number) => [`${value.toFixed(1)}%`, 'Error Rate']}
                />
                <Area type="monotone" dataKey="errorRate" stroke="#ef4444" fill="#fee2e2" strokeWidth={2} name="Error Rate %" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Charts Row 2: Tool Usage + Cost Over Time */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tool Usage */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-gray-900">Tool Usage</h3>
          <p className="text-xs text-gray-500 mb-4">Top tools by call count</p>
          {isLoading ? (
            <div className="h-64 animate-pulse rounded bg-gray-100" />
          ) : toolChartData.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
              No tool calls in this period
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <ResponsiveContainer width="100%" height={256}>
                <BarChart data={toolChartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      fontSize: '13px',
                    }}
                  />
                  <Bar dataKey="calls" fill="#0c8ce9" radius={[0, 4, 4, 0]} name="Calls" />
                  <Bar dataKey="errors" fill="#ef4444" radius={[0, 4, 4, 0]} name="Errors" />
                </BarChart>
              </ResponsiveContainer>
              {toolPieData.length > 0 && (
                <ResponsiveContainer width="100%" height={256}>
                  <PieChart>
                    <Pie
                      data={toolPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={90}
                      dataKey="value"
                      label={(entry) => entry.name}
                    >
                      {toolPieData.map((_, idx) => (
                        <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#fff',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        fontSize: '13px',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          )}
        </div>

        {/* Cost Over Time */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-gray-900">Cost Over Time</h3>
          <p className="text-xs text-gray-500 mb-4">{timeRange.label}</p>
          {isLoading ? (
            <div className="h-64 animate-pulse rounded bg-gray-100" />
          ) : costChartData.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
              No cost data in this period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={256}>
              <BarChart data={costChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '13px',
                  }}
                  formatter={(value: number) => [formatCost(value)]}
                />
                <Legend />
                {costAgentIds.length > 0 ? (
                  costAgentIds.map((agentId, idx) => (
                    <Bar
                      key={agentId}
                      dataKey={agentId}
                      stackId="cost"
                      fill={COLORS[idx % COLORS.length]}
                      name={agentId}
                    />
                  ))
                ) : (
                  <Bar dataKey="cost" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Cost (USD)" />
                )}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Cost by Agent Table */}
      {costs && costs.byAgent.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-gray-900">Cost by Agent</h3>
          <p className="text-xs text-gray-500 mb-4">Breakdown of costs per agent</p>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Agent</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Cost</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Input</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Output</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Cache Read</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Cache Write</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Events</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {costs.byAgent.map((agent) => (
                  <tr key={agent.agentId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{agent.agentId}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900 font-mono">{formatCost(agent.totalCostUsd)}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">{formatNumber(agent.totalInputTokens)}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">{formatNumber(agent.totalOutputTokens)}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">{formatNumber(agent.cacheReadTokens ?? 0)}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">{formatNumber(agent.cacheWriteTokens ?? 0)}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">{agent.eventCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tabbed Analytics Wrapper ───────────────────────────────────────

export function Analytics(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as AnalyticsTab) || 'overview';

  const setTab = (tab: AnalyticsTab) => {
    if (tab === 'overview') {
      setSearchParams({});
    } else {
      setSearchParams({ tab });
    }
  };

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200">
        {ANALYTICS_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === key
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && <AnalyticsOverview />}
      {activeTab === 'llm' && <Suspense fallback={<PageSkeleton />}><LlmAnalytics /></Suspense>}
      {activeTab === 'events' && <Suspense fallback={<PageSkeleton />}><EventsExplorer /></Suspense>}
      {activeTab === 'health' && <Suspense fallback={<PageSkeleton />}><HealthOverview /></Suspense>}
      {activeTab === 'cost' && <Suspense fallback={<PageSkeleton />}><CostOptimization /></Suspense>}
      {activeTab === 'insights' && <Suspense fallback={<PageSkeleton />}><Insights /></Suspense>}
    </div>
  );
}
