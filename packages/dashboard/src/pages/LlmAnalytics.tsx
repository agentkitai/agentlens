/**
 * LLM Analytics Page (Story 4.2)
 *
 * Route: /llm
 *
 * Features:
 *  - Summary cards: Total LLM Calls, Total Cost, Avg Latency, Total Tokens
 *  - Cost by Model: Stacked bar chart by provider/model over time
 *  - Model comparison table: Provider | Model | Calls | Input Tokens | Output Tokens | Cost | Avg Latency
 *  - Time series: LLM calls over time with cost overlay
 *  - Filters: date range, agent dropdown, model filter, provider filter
 */
import React, { useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import { useApi } from '../hooks/useApi';
import { getLlmAnalytics, getAgents } from '../api/client';
import type { LlmAnalyticsResult } from '../api/client';
import type { Agent } from '@agentlensai/core';

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

// ─── Colors ─────────────────────────────────────────────────────────

const COLORS = [
  '#6366f1', // indigo-500
  '#0c8ce9', // brand blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#06b6d4', // cyan
];

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

function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── Metric Card ────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: string;
}) {
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

// ─── Sort helpers ───────────────────────────────────────────────────

type SortKey = 'provider' | 'model' | 'calls' | 'inputTokens' | 'outputTokens' | 'costUsd' | 'avgLatencyMs';
type SortDir = 'asc' | 'desc';

// ─── Component ──────────────────────────────────────────────────────

export function LlmAnalytics(): React.ReactElement {
  const [range, setRange] = useState<TimeRange>('24h');
  const [agentId, setAgentId] = useState('');
  const [modelFilter, setModelFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('costUsd');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const config = TIME_RANGES[range];
  const from = useMemo(() => config.from(), [range]);
  const to = useMemo(() => new Date().toISOString(), [range]);

  // Fetch LLM analytics data
  const { data, loading } = useApi<LlmAnalyticsResult>(
    () =>
      getLlmAnalytics({
        from,
        to,
        granularity: config.granularity,
        agentId: agentId || undefined,
        model: modelFilter || undefined,
        provider: providerFilter || undefined,
      }),
    [from, to, config.granularity, agentId, modelFilter, providerFilter],
  );

  // Fetch agents for dropdown
  const { data: agents } = useApi(() => getAgents(), []);

  // Extract unique providers and models for filter dropdowns
  const { providers, models } = useMemo(() => {
    if (!data?.byModel) return { providers: [] as string[], models: [] as string[] };
    const provSet = new Set<string>();
    const modSet = new Set<string>();
    for (const row of data.byModel) {
      provSet.add(row.provider);
      modSet.add(row.model);
    }
    return {
      providers: Array.from(provSet).sort(),
      models: Array.from(modSet).sort(),
    };
  }, [data]);

  // Chart data: cost by model over time (stacked bar)
  const modelIds = useMemo(() => {
    if (!data?.byModel) return [];
    return data.byModel.map((m) => `${m.provider}/${m.model}`);
  }, [data]);

  const costByModelChartData = useMemo(() => {
    if (!data?.byTime || !data?.byModel) return [];
    // For stacked chart, we only have aggregate byTime. Show total cost per bucket.
    return data.byTime.map((b) => ({
      label: formatBucketLabel(b.bucket, range),
      cost: b.costUsd,
      calls: b.calls,
    }));
  }, [data, range]);

  // Time series data: calls over time with cost overlay
  const timeSeriesData = useMemo(() => {
    if (!data?.byTime) return [];
    return data.byTime.map((b) => ({
      label: formatBucketLabel(b.bucket, range),
      calls: b.calls,
      cost: b.costUsd,
      avgLatency: b.avgLatencyMs,
    }));
  }, [data, range]);

  // Sort model table
  const sortedModels = useMemo(() => {
    if (!data?.byModel) return [];
    return [...data.byModel].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      const aNum = Number(aVal);
      const bNum = Number(bVal);
      return sortDir === 'asc' ? aNum - bNum : bNum - aNum;
    });
  }, [data, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  return (
    <div className="space-y-6">
      {/* Header + Time Range */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">LLM Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">
            Usage, cost, and performance metrics for LLM calls.
          </p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {(Object.keys(TIME_RANGES) as TimeRange[]).map((key) => (
            <button
              key={key}
              onClick={() => setRange(key)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                range === key
                  ? 'bg-white shadow-sm font-medium text-gray-900'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm"
        >
          <option value="">All Agents</option>
          {(agents ?? []).map((a: Agent) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm"
        >
          <option value="">All Providers</option>
          {providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <select
          value={modelFilter}
          onChange={(e) => setModelFilter(e.target.value)}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm"
        >
          <option value="">All Models</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        {(agentId || providerFilter || modelFilter) && (
          <button
            type="button"
            onClick={() => {
              setAgentId('');
              setProviderFilter('');
              setModelFilter('');
            }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Summary Metrics */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            label="Total LLM Calls"
            value={formatNumber(data.summary.totalCalls)}
            icon="🧠"
          />
          <MetricCard
            label="Total Cost"
            value={formatCost(data.summary.totalCostUsd)}
            icon="💰"
          />
          <MetricCard
            label="Avg Latency"
            value={formatLatency(data.summary.avgLatencyMs)}
            icon="⚡"
          />
          <MetricCard
            label="Total Tokens"
            value={formatNumber(
              data.summary.totalInputTokens + data.summary.totalOutputTokens,
            )}
            icon="📊"
          />
        </div>
      )}

      {/* Charts Row: Cost Over Time + Calls Over Time */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cost by Model Over Time */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-gray-900">Cost Over Time</h3>
          <p className="text-xs text-gray-500 mb-4">{config.label}</p>
          {loading ? (
            <div className="h-64 animate-pulse rounded bg-gray-100" />
          ) : costByModelChartData.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
              No LLM cost data in this period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={256}>
              <BarChart data={costByModelChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `$${v}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '13px',
                  }}
                  formatter={(value: number, name: string) => [
                    name === 'cost' ? formatCost(value) : value,
                    name === 'cost' ? 'Cost (USD)' : 'Calls',
                  ]}
                />
                <Legend />
                <Bar
                  dataKey="cost"
                  fill="#6366f1"
                  radius={[4, 4, 0, 0]}
                  name="Cost (USD)"
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* LLM Calls Over Time with Cost Overlay */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-gray-900">LLM Calls Over Time</h3>
          <p className="text-xs text-gray-500 mb-4">{config.label}</p>
          {loading ? (
            <div className="h-64 animate-pulse rounded bg-gray-100" />
          ) : timeSeriesData.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
              No LLM calls in this period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={256}>
              <LineChart data={timeSeriesData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11 }}
                  allowDecimals={false}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `$${v}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '13px',
                  }}
                  formatter={(value: number, name: string) => {
                    if (name === 'Cost') return [formatCost(value), name];
                    if (name === 'Avg Latency') return [formatLatency(value), name];
                    return [value, name];
                  }}
                />
                <Legend />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="calls"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={false}
                  name="Calls"
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="cost"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                  name="Cost"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Model Comparison Table */}
      {data && data.byModel.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-gray-900">Model Comparison</h3>
          <p className="text-xs text-gray-500 mb-4">
            Breakdown by provider and model
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {([
                    ['provider', 'Provider'],
                    ['model', 'Model'],
                    ['calls', 'Calls'],
                    ['inputTokens', 'Input Tokens'],
                    ['outputTokens', 'Output Tokens'],
                    ['costUsd', 'Cost'],
                    ['avgLatencyMs', 'Avg Latency'],
                  ] as [SortKey, string][]).map(([key, label]) => (
                    <th
                      key={key}
                      onClick={() => handleSort(key)}
                      className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase cursor-pointer hover:text-gray-700 ${
                        key === 'provider' || key === 'model'
                          ? 'text-left'
                          : 'text-right'
                      }`}
                    >
                      {label}
                      {sortIndicator(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {sortedModels.map((row) => (
                  <tr
                    key={`${row.provider}-${row.model}`}
                    className="hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                        {row.provider}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 font-mono">
                      {row.model}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {formatNumber(row.calls)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {formatNumber(row.inputTokens)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {formatNumber(row.outputTokens)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900 font-mono">
                      {formatCost(row.costUsd)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {formatLatency(row.avgLatencyMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && data && data.summary.totalCalls === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm">
          <span className="text-4xl">🧠</span>
          <h3 className="mt-4 text-lg font-semibold text-gray-900">
            No LLM calls yet
          </h3>
          <p className="mt-2 text-sm text-gray-500 max-w-md mx-auto">
            Start tracking LLM calls by using the SDK's{' '}
            <code className="text-indigo-600 bg-indigo-50 px-1 rounded">
              logLlmCall()
            </code>{' '}
            method or the MCP{' '}
            <code className="text-indigo-600 bg-indigo-50 px-1 rounded">
              agentlens_log_llm_call
            </code>{' '}
            tool.
          </p>
        </div>
      )}
    </div>
  );
}
