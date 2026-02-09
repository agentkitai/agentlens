/**
 * Usage Dashboard Page (S-7.4)
 *
 * Dashboard page showing:
 * - Event counts, API call volume, storage usage
 * - Per-tier quota bars
 * - Time range selector (7d/30d/90d)
 * - Ingestion volume chart over time
 * - 80% quota warning banner
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useOrg } from './OrgContext';
import {
  getUsage,
  type UsageBreakdown,
  type UsageTimeRange,
} from './api';

const TIME_RANGES: { value: UsageTimeRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** Simple bar chart using div widths */
function QuotaBar({
  label,
  current,
  max,
  formatter,
  testId,
}: {
  label: string;
  current: number;
  max: number;
  formatter: (n: number) => string;
  testId: string;
}): React.ReactElement {
  const pct = max > 0 ? Math.min((current / max) * 100, 100) : 0;
  const isWarning = pct >= 80;
  const isCritical = pct >= 95;

  return (
    <div className="mb-4" data-testid={testId}>
      <div className="flex justify-between text-sm mb-1">
        <span className="font-medium">{label}</span>
        <span className="text-gray-500">
          {formatter(current)} / {formatter(max)} ({pct.toFixed(0)}%)
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-3">
        <div
          className={`h-3 rounded-full transition-all ${
            isCritical ? 'bg-red-500' : isWarning ? 'bg-yellow-500' : 'bg-blue-500'
          }`}
          style={{ width: `${pct}%` }}
          data-testid={`${testId}-bar`}
        />
      </div>
    </div>
  );
}

/** Simple ASCII-style bar chart for timeseries */
function TimeseriesChart({
  data,
  dataKey,
}: {
  data: { timestamp: string; events: number; api_calls: number }[];
  dataKey: 'events' | 'api_calls';
}): React.ReactElement {
  const maxVal = Math.max(...data.map((d) => d[dataKey]), 1);

  return (
    <div className="flex items-end gap-1 h-32" data-testid="timeseries-chart">
      {data.map((point, i) => {
        const height = (point[dataKey] / maxVal) * 100;
        return (
          <div
            key={i}
            className="flex-1 bg-blue-400 hover:bg-blue-600 rounded-t transition-colors min-w-[2px]"
            style={{ height: `${Math.max(height, 2)}%` }}
            title={`${new Date(point.timestamp).toLocaleDateString()}: ${formatNumber(point[dataKey])}`}
          />
        );
      })}
    </div>
  );
}

export function UsageDashboard(): React.ReactElement {
  const { currentOrg } = useOrg();
  const [range, setRange] = useState<UsageTimeRange>('30d');
  const [usage, setUsage] = useState<UsageBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const orgId = currentOrg?.id;

  const refresh = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getUsage(orgId, range);
      setUsage(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load usage data');
    } finally {
      setLoading(false);
    }
  }, [orgId, range]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const quotaWarning = useMemo(() => {
    if (!usage) return null;
    const pct = usage.summary.quota_events > 0
      ? (usage.summary.events_count / usage.summary.quota_events) * 100
      : 0;
    if (pct >= 80) return pct;
    return null;
  }, [usage]);

  if (!currentOrg) {
    return <div className="p-6 text-gray-500">Select an organization to view usage.</div>;
  }

  return (
    <div className="p-6 max-w-4xl" data-testid="usage-dashboard">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Usage</h1>
        <div className="flex gap-1 bg-gray-100 rounded p-1" data-testid="time-range-selector">
          {TIME_RANGES.map((tr) => (
            <button
              key={tr.value}
              onClick={() => setRange(tr.value)}
              className={`px-3 py-1 text-sm rounded ${
                range === tr.value
                  ? 'bg-white shadow text-blue-600 font-medium'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
              data-testid={`range-${tr.value}`}
            >
              {tr.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4" role="alert">
          {error}
        </div>
      )}

      {/* 80% quota warning */}
      {quotaWarning !== null && (
        <div
          className={`border px-4 py-3 rounded mb-4 ${
            quotaWarning >= 95
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-yellow-50 border-yellow-200 text-yellow-700'
          }`}
          data-testid="quota-warning"
          role="alert"
        >
          ⚠️ You've used {quotaWarning.toFixed(0)}% of your event quota this period.
          {quotaWarning >= 95 ? ' Consider upgrading your plan.' : ''}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading usage data...</p>
      ) : usage ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4 mb-6" data-testid="usage-summary">
            <div className="bg-white border rounded p-4">
              <div className="text-sm text-gray-500">Events</div>
              <div className="text-2xl font-bold" data-testid="events-count">
                {formatNumber(usage.summary.events_count)}
              </div>
              <div className="text-xs text-gray-400">
                {usage.summary.period_start} — {usage.summary.period_end}
              </div>
            </div>
            <div className="bg-white border rounded p-4">
              <div className="text-sm text-gray-500">API Calls</div>
              <div className="text-2xl font-bold" data-testid="api-calls-count">
                {formatNumber(usage.summary.api_calls)}
              </div>
            </div>
            <div className="bg-white border rounded p-4">
              <div className="text-sm text-gray-500">Storage</div>
              <div className="text-2xl font-bold" data-testid="storage-usage">
                {formatBytes(usage.summary.storage_bytes)}
              </div>
            </div>
          </div>

          {/* Quota bars */}
          <div className="mb-6" data-testid="quota-bars">
            <h2 className="text-lg font-semibold mb-3">Quota Usage ({usage.summary.plan} plan)</h2>
            <QuotaBar
              label="Events"
              current={usage.summary.events_count}
              max={usage.summary.quota_events}
              formatter={formatNumber}
              testId="quota-events"
            />
            <QuotaBar
              label="Storage"
              current={usage.summary.storage_bytes}
              max={usage.summary.quota_storage_bytes}
              formatter={formatBytes}
              testId="quota-storage"
            />
          </div>

          {/* Timeseries chart */}
          {usage.timeseries.length > 0 && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-3">Ingestion Volume Over Time</h2>
              <div className="bg-white border rounded p-4">
                <TimeseriesChart data={usage.timeseries} dataKey="events" />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>{new Date(usage.timeseries[0].timestamp).toLocaleDateString()}</span>
                  <span>{new Date(usage.timeseries[usage.timeseries.length - 1].timestamp).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

export default UsageDashboard;
