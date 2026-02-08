/**
 * ComparisonTable — Statistical comparison of benchmark variants (Story 6.3)
 *
 * Rows = metrics, Columns = variants + diff + p-value + confidence
 * Color coding: green = winner, red = loser, gray = not significant
 * Confidence: ★★★ (p<0.001), ★★ (p<0.01), ★ (p<0.05), — (not sig)
 */
import React from 'react';
import type { BenchmarkMetricResult } from '../../api/client';

// ─── Types ──────────────────────────────────────────────────────────

export interface ComparisonTableProps {
  metrics: BenchmarkMetricResult[];
  variantNames: { id: string; name: string }[];
}

// ─── Helpers ────────────────────────────────────────────────────────

const METRIC_LABELS: Record<string, string> = {
  cost_per_session: 'Cost/Session',
  avg_latency: 'Avg Latency',
  error_rate: 'Error Rate',
  tool_call_count: 'Tool Calls',
  tokens_per_session: 'Tokens/Session',
  session_duration: 'Duration',
  task_completion: 'Task Completion',
  user_satisfaction: 'User Satisfaction',
};

/** Metrics where lower is better */
const LOWER_IS_BETTER = new Set([
  'cost_per_session',
  'avg_latency',
  'error_rate',
  'tokens_per_session',
  'session_duration',
]);

function metricLabel(metric: string): string {
  return METRIC_LABELS[metric] || metric.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function confidenceStars(pValue?: number): string {
  if (pValue == null) return '—';
  if (pValue < 0.001) return '★★★';
  if (pValue < 0.01) return '★★';
  if (pValue < 0.05) return '★';
  return '—';
}

function confidenceTooltip(pValue?: number): string {
  if (pValue == null) return 'No comparison available';
  if (pValue < 0.001) return `p=${pValue.toFixed(4)} — Very high confidence`;
  if (pValue < 0.01) return `p=${pValue.toFixed(4)} — High confidence`;
  if (pValue < 0.05) return `p=${pValue.toFixed(4)} — Moderate confidence`;
  return `p=${pValue.toFixed(4)} — Not significant`;
}

function formatValue(val: number): string {
  if (Math.abs(val) >= 1_000_000) return (val / 1_000_000).toFixed(2) + 'M';
  if (Math.abs(val) >= 1_000) return (val / 1_000).toFixed(2) + 'k';
  if (Number.isInteger(val)) return String(val);
  return val.toFixed(3);
}

function diffPercent(a: number, b: number): string {
  if (a === 0 && b === 0) return '0%';
  if (a === 0) return '—';
  const pct = ((b - a) / Math.abs(a)) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

// ─── Component ──────────────────────────────────────────────────────

export function ComparisonTable({
  metrics,
  variantNames,
}: ComparisonTableProps): React.ReactElement {
  if (metrics.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
        No results available yet. Start the benchmark and collect sessions to see comparisons.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Metric
            </th>
            {variantNames.map((v) => (
              <th
                key={v.id}
                className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {v.name}
              </th>
            ))}
            {variantNames.length >= 2 && (
              <>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Diff
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  p-value
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Confidence
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {metrics.map((m) => {
            const lowerBetter = LOWER_IS_BETTER.has(m.metric);
            const isSignificant = m.significant ?? (m.pValue != null && m.pValue < 0.05);

            // Determine winner among variants
            let winnerId: string | null = m.winnerId ?? null;
            if (!winnerId && m.variantResults.length >= 2 && isSignificant) {
              // Auto-determine: for lower-is-better, lowest mean wins
              const sorted = [...m.variantResults].sort((a, b) =>
                lowerBetter ? a.mean - b.mean : b.mean - a.mean,
              );
              winnerId = sorted[0].variantId;
            }

            // Diff between first two variants
            const v0 = m.variantResults[0];
            const v1 = m.variantResults[1];
            const diff =
              v0 && v1 ? diffPercent(v0.mean, v1.mean) : '—';

            return (
              <tr key={m.metric}>
                <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">
                  {metricLabel(m.metric)}
                </td>
                {m.variantResults.map((vr) => {
                  let colorClass = 'text-gray-600';
                  if (isSignificant && winnerId) {
                    if (vr.variantId === winnerId) {
                      colorClass = 'text-green-700 font-semibold';
                    } else {
                      colorClass = 'text-red-600';
                    }
                  }

                  return (
                    <td
                      key={vr.variantId}
                      className={`px-4 py-3 text-sm text-right whitespace-nowrap ${colorClass}`}
                      title={`mean=${vr.mean.toFixed(4)}, median=${vr.median.toFixed(4)}, n=${vr.sampleSize}`}
                    >
                      {formatValue(vr.mean)}
                      <span className="text-xs text-gray-400 ml-1">
                        (n={vr.sampleSize})
                      </span>
                    </td>
                  );
                })}
                {variantNames.length >= 2 && (
                  <>
                    <td
                      className={`px-4 py-3 text-sm text-right whitespace-nowrap ${
                        isSignificant ? 'font-medium' : 'text-gray-400'
                      }`}
                    >
                      {diff}
                    </td>
                    <td className="px-4 py-3 text-sm text-right whitespace-nowrap text-gray-500">
                      {m.pValue != null ? m.pValue.toFixed(4) : '—'}
                    </td>
                    <td
                      className="px-4 py-3 text-center whitespace-nowrap"
                      title={confidenceTooltip(m.pValue)}
                    >
                      <span
                        className={`text-sm ${
                          isSignificant ? 'text-yellow-500' : 'text-gray-300'
                        }`}
                      >
                        {confidenceStars(m.pValue)}
                      </span>
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
