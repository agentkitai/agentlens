/**
 * Cost Forecaster (Feature 17 — Story 17.5)
 *
 * Projects daily costs forward using linear regression on historical
 * cost buckets. Integrates with CostOptimizer for savings projections
 * and BudgetEngine for burn-rate calculation.
 */

import type {
  IEventStore,
  CostForecast,
  ForecastBucket,
  ForecastSummary,
  BudgetBurnRate,
} from '@agentlensai/core';
import { analyzeCosts } from '../analysis/cost-analysis.js';
import { CostOptimizer } from './cost-optimizer.js';

export interface ForecastOptions {
  agentId?: string;
  days: number;
  store: IEventStore;
  budgetStore?: {
    listBudgets(tenantId: string): { id: string; limitUsd: number; currentSpend: number }[];
  };
  tenantId?: string;
}

/**
 * Simple linear regression: y = slope * x + intercept
 */
function linearRegression(points: { x: number; y: number }[]): { slope: number; intercept: number } {
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export class CostForecaster {
  constructor(private readonly optimizer?: CostOptimizer) {}

  async forecast(opts: ForecastOptions): Promise<CostForecast> {
    const { agentId, days, store } = opts;

    // Get historical data (last 30 days)
    const historyDays = 30;
    const now = new Date();
    const from = new Date(now.getTime() - historyDays * 24 * 60 * 60 * 1000).toISOString();
    const to = now.toISOString();

    const costResult = await analyzeCosts(store, { agentId, from, to });
    const buckets = costResult.trend.buckets;

    // Build regression points from daily buckets
    const points = buckets.map((bucket, i) => ({
      x: i,
      y: bucket.totalCost,
    }));

    const { slope, intercept } = linearRegression(points);
    const lastX = points.length > 0 ? points.length - 1 : 0;

    // Get potential savings from optimizer
    let dailySavings = 0;
    if (this.optimizer) {
      try {
        const optResult = await this.optimizer.getRecommendations({
          agentId,
          period: 14,
          limit: 50,
        });
        dailySavings = optResult.totalPotentialSavings / 30;
      } catch {
        // Optimization unavailable, proceed without
      }
    }

    // Project forward
    const daily: ForecastBucket[] = [];
    let totalProjected = 0;
    let totalOptimized = 0;

    for (let d = 1; d <= days; d++) {
      const x = lastX + d;
      const projected = Math.max(0, slope * x + intercept);
      const optimized = Math.max(0, projected - dailySavings);

      const date = new Date(now.getTime() + d * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      daily.push({
        date,
        projectedCost: Math.round(projected * 1_000_000) / 1_000_000,
        projectedCostOptimized: Math.round(optimized * 1_000_000) / 1_000_000,
      });

      totalProjected += projected;
      totalOptimized += optimized;
    }

    const withoutOptimizations: ForecastSummary = {
      totalProjectedCost: Math.round(totalProjected * 1_000_000) / 1_000_000,
      avgDailyCost: days > 0 ? Math.round((totalProjected / days) * 1_000_000) / 1_000_000 : 0,
    };

    const withOptimizations: ForecastSummary = {
      totalProjectedCost: Math.round(totalOptimized * 1_000_000) / 1_000_000,
      avgDailyCost: days > 0 ? Math.round((totalOptimized / days) * 1_000_000) / 1_000_000 : 0,
    };

    // Budget burn rate
    let budgetBurnRate: BudgetBurnRate | undefined;
    if (opts.budgetStore && opts.tenantId) {
      try {
        const budgets = opts.budgetStore.listBudgets(opts.tenantId);
        if (budgets.length > 0) {
          const budget = budgets[0];
          // Recent week cost from trend
          const recentBuckets = buckets.slice(-7);
          const recentCost = recentBuckets.reduce((s, b) => s + b.totalCost, 0);
          const dailyBurn = recentBuckets.length > 0 ? recentCost / recentBuckets.length : 0;
          const remaining = budget.limitUsd - budget.currentSpend;

          budgetBurnRate = {
            budgetId: budget.id,
            limitUsd: budget.limitUsd,
            currentSpend: budget.currentSpend,
            dailyBurnRate: Math.round(dailyBurn * 1_000_000) / 1_000_000,
            daysUntilExhaustion: dailyBurn > 0 ? Math.round(remaining / dailyBurn) : null,
          };
        }
      } catch {
        // Budget store unavailable
      }
    }

    return {
      agentId,
      days,
      daily,
      withOptimizations,
      withoutOptimizations,
      budgetBurnRate,
    };
  }
}

// Export linearRegression for testing
export { linearRegression };
