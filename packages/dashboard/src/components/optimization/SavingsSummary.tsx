/**
 * Savings Summary Card (Feature 17 — Story 17.15)
 *
 * Displays total potential savings and per-category breakdown.
 */
import React from 'react';
import type { OptimizationCategory } from '@agentlensai/core';

interface CategoryBreakdown {
  count: number;
  totalSavings: number;
}

interface SavingsSummaryProps {
  totalPotentialSavings: number;
  analyzedCalls: number;
  period: number;
  byCategory: Partial<Record<OptimizationCategory, CategoryBreakdown>>;
}

const CATEGORY_META: Record<OptimizationCategory, { label: string; icon: string; color: string }> = {
  model_downgrade: { label: 'Model Downgrade', icon: '⬇️', color: 'bg-blue-100 text-blue-800' },
  prompt_optimization: { label: 'Prompt Optimization', icon: '✂️', color: 'bg-purple-100 text-purple-800' },
  caching: { label: 'Caching', icon: '💾', color: 'bg-green-100 text-green-800' },
  tool_reduction: { label: 'Tool Reduction', icon: '🔧', color: 'bg-amber-100 text-amber-800' },
};

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function SavingsSummary({
  totalPotentialSavings,
  analyzedCalls,
  period,
  byCategory,
}: SavingsSummaryProps): React.ReactElement {
  const categories = Object.entries(byCategory).filter(
    ([, v]) => v && v.count > 0,
  ) as [OptimizationCategory, CategoryBreakdown][];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Potential Savings</h3>
          <p className="text-xs text-gray-500">
            Based on {analyzedCalls.toLocaleString()} calls over {period} days
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-green-600">
            {formatCost(totalPotentialSavings)}
          </div>
          <div className="text-xs text-gray-500">per month</div>
        </div>
      </div>

      {categories.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {categories.map(([cat, data]) => {
            const meta = CATEGORY_META[cat];
            return (
              <div
                key={cat}
                className="flex items-center gap-2 rounded-lg border border-gray-100 p-3"
              >
                <span className="text-lg">{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-gray-700">{meta.label}</div>
                  <div className="text-sm font-semibold text-gray-900">
                    {formatCost(data.totalSavings)}
                  </div>
                </div>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}
                >
                  {data.count}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
