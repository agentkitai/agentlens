/**
 * Optimization Panel (Feature 17 — Story 17.15)
 *
 * Main container for the Optimization tab in LLM Analytics.
 * Fetches enhanced recommendations and renders SavingsSummary + RecommendationCards.
 */
import React from 'react';
import { useApi } from '../../hooks/useApi';
import { request, toQueryString } from '../../api/core';
import type { EnhancedOptimizationResult } from '@agentlensai/core';
import { SavingsSummary } from './SavingsSummary';
import { RecommendationCard } from './RecommendationCard';

interface OptimizationPanelProps {
  agentId?: string;
}

async function getEnhancedRecommendations(params?: {
  agentId?: string;
  period?: number;
  limit?: number;
}): Promise<EnhancedOptimizationResult> {
  const qs = toQueryString({
    enhanced: 'true',
    agentId: params?.agentId,
    period: params?.period,
    limit: params?.limit,
  });
  return request<EnhancedOptimizationResult>(`/api/optimize/recommendations${qs}`);
}

export function OptimizationPanel({ agentId }: OptimizationPanelProps): React.ReactElement {
  const { data, loading, error, refetch } = useApi(
    () => getEnhancedRecommendations({ agentId, period: 30, limit: 20 }),
    [agentId],
  );

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="h-32 animate-pulse rounded-xl bg-gray-100" />
        <div className="h-40 animate-pulse rounded-xl bg-gray-100" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
        Error loading optimization data: {error}
      </div>
    );
  }

  if (!data || data.recommendations.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm">
        <span className="text-4xl">✨</span>
        <h3 className="mt-4 text-lg font-semibold text-gray-900">No recommendations</h3>
        <p className="mt-2 text-sm text-gray-500 max-w-md mx-auto">
          No cost optimization opportunities found. This could mean your LLM usage is already
          efficient, or there isn't enough data yet. Check back after more calls are recorded.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SavingsSummary
        totalPotentialSavings={data.totalPotentialSavings}
        analyzedCalls={data.analyzedCalls}
        period={data.period}
        byCategory={data.byCategory}
      />

      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-3">
          Recommendations ({data.recommendations.length})
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.recommendations.map((rec) => (
            <RecommendationCard
              key={rec.id}
              recommendation={rec}
              onApplied={refetch}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
