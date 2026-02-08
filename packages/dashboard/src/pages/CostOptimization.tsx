/**
 * Cost Optimization Page (Story 3.5)
 *
 * Route: /cost-optimization
 *
 * Features:
 *  - Total potential savings banner at top
 *  - Recommendations table: current model → recommended model, complexity tier,
 *    monthly savings, confidence level, call volume, agent
 *  - Confidence badges: low (gray), medium (yellow), high (green)
 *  - Filter by agent dropdown
 */
import React, { useState, useMemo } from 'react';
import { useApi } from '../hooks/useApi';
import { getOptimizationRecommendations, getAgents } from '../api/client';
import type { OptimizationRecommendationsData, OptimizationRecommendation } from '../api/client';

// ─── Helpers ────────────────────────────────────────────────────────

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function confidenceBadge(confidence: string): React.ReactElement {
  switch (confidence) {
    case 'high':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
          High
        </span>
      );
    case 'medium':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
          Medium
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
          Low
        </span>
      );
  }
}

function tierBadge(tier: string): React.ReactElement {
  const colors: Record<string, string> = {
    simple: 'bg-blue-50 text-blue-700 border-blue-200',
    moderate: 'bg-purple-50 text-purple-700 border-purple-200',
    complex: 'bg-orange-50 text-orange-700 border-orange-200',
  };
  const cls = colors[tier] || 'bg-gray-50 text-gray-700 border-gray-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {tier}
    </span>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ─── Main Component ─────────────────────────────────────────────────

type Period = '7' | '14' | '30';

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
];

export function CostOptimization(): React.ReactElement {
  const [period, setPeriod] = useState<Period>('7');
  const [agentFilter, setAgentFilter] = useState('');

  const agents = useApi(() => getAgents(), []);

  const { data, loading, error } = useApi<OptimizationRecommendationsData>(
    () =>
      getOptimizationRecommendations({
        period: Number(period),
        limit: 50,
        agentId: agentFilter || undefined,
      }),
    [period, agentFilter],
  );

  const recommendations = data?.recommendations ?? [];

  // Calculate total savings
  const totalSavings = useMemo(
    () => recommendations.reduce((sum, r) => sum + (r.monthlySavings ?? 0), 0),
    [recommendations],
  );

  // Sort: highest savings first
  const sortedRecs = useMemo(
    () => [...recommendations].sort((a, b) => (b.monthlySavings ?? 0) - (a.monthlySavings ?? 0)),
    [recommendations],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cost Optimization</h1>
          <p className="text-sm text-gray-500 mt-1">
            Model recommendations to reduce costs without sacrificing quality.
          </p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPeriod(opt.value)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                period === opt.value
                  ? 'bg-white shadow-sm font-medium text-gray-900'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Savings Banner */}
      {!loading && !error && recommendations.length > 0 && (
        <div className="rounded-xl border-2 border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-green-800">Total Potential Monthly Savings</p>
              <p className="text-4xl font-bold text-green-700 mt-1">{formatCost(totalSavings)}</p>
              <p className="text-sm text-green-600 mt-1">
                from {recommendations.length} recommendation{recommendations.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="text-6xl">💰</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <select
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
        >
          <option value="">All Agents</option>
          {(agents.data ?? []).map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name || agent.id}
            </option>
          ))}
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="animate-pulse p-6 space-y-4">
            <div className="h-6 bg-gray-200 rounded w-1/4" />
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-gray-100 rounded" />
            ))}
          </div>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
          <p className="text-red-600 font-medium">Failed to load recommendations</p>
          <p className="text-red-500 text-sm mt-1">{error}</p>
        </div>
      ) : recommendations.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <span className="text-4xl">✨</span>
          <p className="text-gray-500 mt-3">No optimization recommendations available.</p>
          <p className="text-gray-400 text-sm mt-1">
            Your models are already well-optimized, or there isn't enough data yet.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Agent</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Current Model</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">→</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Recommended</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Complexity</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Call Volume</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Monthly Savings</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {sortedRecs.map((rec, idx) => (
                  <tr key={idx} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {rec.agentName || rec.agentId || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                      {rec.currentModel}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-400">→</td>
                    <td className="px-4 py-3 text-sm text-blue-700 font-mono font-medium">
                      {rec.recommendedModel}
                    </td>
                    <td className="px-4 py-3">
                      {tierBadge(rec.complexityTier)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {formatNumber(rec.callVolume ?? 0)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-green-700 font-mono">
                      {formatCost(rec.monthlySavings ?? 0)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {confidenceBadge(rec.confidence)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary footer */}
          <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
            <span className="text-xs text-gray-500">
              {recommendations.length} recommendation{recommendations.length !== 1 ? 's' : ''}
            </span>
            <span className="text-sm font-semibold text-green-700">
              Total: {formatCost(totalSavings)}/mo
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
