/**
 * Recommendation Card (Feature 17 — Story 17.15)
 *
 * Displays an individual optimization recommendation.
 */
import React, { useState } from 'react';
import type {
  EnhancedRecommendation,
  OptimizationCategory,
  ImplementationDifficulty,
} from '@agentlensai/core';
import { request } from '../../api/core';

const CATEGORY_META: Record<OptimizationCategory, { label: string; icon: string }> = {
  model_downgrade: { label: 'Model Downgrade', icon: '⬇️' },
  prompt_optimization: { label: 'Prompt Optimization', icon: '✂️' },
  caching: { label: 'Caching', icon: '💾' },
  tool_reduction: { label: 'Tool Reduction', icon: '🔧' },
};

const CONFIDENCE_STYLES: Record<string, string> = {
  high: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-gray-100 text-gray-600',
};

const DIFFICULTY_LABELS: Record<ImplementationDifficulty, string> = {
  auto: 'Automatic',
  config_change: 'Config Change',
  code_change: 'Code Change',
};

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

interface RecommendationCardProps {
  recommendation: EnhancedRecommendation;
  onApplied?: () => void;
}

export function RecommendationCard({
  recommendation: rec,
  onApplied,
}: RecommendationCardProps): React.ReactElement {
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  const meta = CATEGORY_META[rec.category];
  const canApply = rec.difficulty === 'auto' || rec.difficulty === 'config_change';

  const handleApply = async () => {
    setApplying(true);
    try {
      await request(`/api/optimize/recommendations/${encodeURIComponent(rec.id)}/apply`, {
        method: 'POST',
      });
      setApplied(true);
      onApplied?.();
    } catch {
      // Apply endpoint may not exist yet (Story 17.12)
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{meta.icon}</span>
          <div>
            <span className="text-sm font-semibold text-gray-900">{meta.label}</span>
            {rec.agentId && (
              <span className="ml-2 text-xs text-gray-400">Agent: {rec.agentId}</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-green-600">
            {formatCost(rec.estimatedMonthlySavings)}
          </div>
          <div className="text-xs text-gray-500">/month</div>
        </div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-2 mb-3">
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${CONFIDENCE_STYLES[rec.confidence] ?? CONFIDENCE_STYLES.low}`}
        >
          {rec.confidence} confidence
        </span>
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
          {DIFFICULTY_LABELS[rec.difficulty]}
        </span>
        <span className="text-xs text-gray-400">
          {rec.evidence.callsAnalyzed.toLocaleString()} calls analyzed
        </span>
      </div>

      {/* Model downgrade detail */}
      {rec.modelDowngrade && (
        <div className="mb-3 rounded-lg bg-gray-50 p-3 text-sm">
          <span className="font-mono text-gray-600">{rec.modelDowngrade.currentModel}</span>
          <span className="mx-2 text-gray-400">→</span>
          <span className="font-mono font-medium text-indigo-600">
            {rec.modelDowngrade.recommendedModel}
          </span>
          <span className="ml-2 text-xs text-gray-400">
            ({rec.modelDowngrade.callVolume.toLocaleString()} calls,{' '}
            {rec.modelDowngrade.complexityTier} tier)
          </span>
        </div>
      )}

      {/* Actionable steps */}
      {rec.actionableSteps.length > 0 && (
        <ul className="mb-3 space-y-1">
          {rec.actionableSteps.map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
              <span className="text-gray-400 mt-0.5">•</span>
              {step}
            </li>
          ))}
        </ul>
      )}

      {/* Apply button */}
      <div className="flex justify-end">
        {applied ? (
          <span className="text-sm font-medium text-green-600">✓ Applied</span>
        ) : canApply ? (
          <button
            onClick={handleApply}
            disabled={applying}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {applying ? 'Applying...' : 'Apply'}
          </button>
        ) : (
          <span className="text-xs text-gray-400 italic">Requires code change</span>
        )}
      </div>
    </div>
  );
}
