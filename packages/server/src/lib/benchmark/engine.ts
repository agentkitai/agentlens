/**
 * BenchmarkEngine (Story 3.4)
 *
 * Orchestrator that combines MetricAggregator and StatisticalComparator
 * to produce full benchmark results with human-readable summaries.
 */

import type {
  BenchmarkMetric,
  BenchmarkResults,
  IEventStore,
  MetricComparison,
  MetricStats,
  VariantMetrics,
} from '@agentlensai/core';
import { MetricAggregator } from './metric-aggregator.js';
import { StatisticalComparator } from './statistical.js';
import type { BenchmarkStore, BenchmarkWithVariants } from '../../db/benchmark-store.js';

// ─── Constants ─────────────────────────────────────────────

const MIN_SESSIONS_FOR_RELIABLE_RESULTS = 30;

// ─── Metric display names ──────────────────────────────────

const METRIC_DISPLAY_NAMES: Record<BenchmarkMetric, string> = {
  health_score: 'health score',
  error_rate: 'error rate',
  avg_cost: 'cost',
  avg_latency: 'latency',
  tool_success_rate: 'tool success rate',
  completion_rate: 'completion rate',
  avg_tokens: 'tokens',
  avg_duration: 'duration',
};

// ─── BenchmarkEngine ───────────────────────────────────────

export class BenchmarkEngine {
  private readonly aggregator = new MetricAggregator();
  private readonly comparator = new StatisticalComparator();

  /**
   * Compute full benchmark results: aggregation + statistical comparison.
   *
   * For completed benchmarks, results are cached via store.saveResults().
   * For running benchmarks, results are computed on-the-fly (not cached).
   */
  async computeResults(
    benchmark: BenchmarkWithVariants,
    eventStore: IEventStore,
    benchmarkStore?: BenchmarkStore,
  ): Promise<BenchmarkResults> {
    // For completed benchmarks, try to return cached results first
    if (benchmark.status === 'completed' && benchmarkStore) {
      const cached = benchmarkStore.getResults(benchmark.tenantId, benchmark.id);
      if (cached) return cached;
    }

    const variants = benchmark.variants;
    const metrics = benchmark.metrics;

    // Step 1: Aggregate metrics for each variant
    const variantMetricsList: VariantMetrics[] = [];
    const variantData: Array<{
      id: string;
      name: string;
      metrics: Record<string, MetricStats>;
    }> = [];

    for (const variant of variants) {
      const aggregated = await this.aggregator.aggregate(
        eventStore,
        variant,
        metrics,
        benchmark.timeRange,
      );

      variantMetricsList.push({
        variantId: variant.id,
        variantName: variant.name,
        sessionCount: aggregated.sessionCount,
        metrics: aggregated.metrics,
      });

      variantData.push({
        id: variant.id,
        name: variant.name,
        metrics: aggregated.metrics,
      });
    }

    // Step 2: Pairwise comparisons for each metric
    const comparisons: MetricComparison[] = [];

    for (let i = 0; i < variantData.length; i++) {
      for (let j = i + 1; j < variantData.length; j++) {
        const vA = variantData[i]!;
        const vB = variantData[j]!;

        for (const metric of metrics) {
          try {
            const comparison = this.comparator.compare(vA, vB, metric);
            comparisons.push(comparison);
          } catch {
            // Skip metrics where data is missing for a variant
          }
        }
      }
    }

    // Step 3: Generate summary
    const summary = this.formatSummary(comparisons, variantMetricsList);

    const results: BenchmarkResults = {
      benchmarkId: benchmark.id,
      tenantId: benchmark.tenantId,
      variants: variantMetricsList,
      comparisons,
      summary,
      computedAt: new Date().toISOString(),
    };

    // Cache results for completed benchmarks
    if (benchmark.status === 'completed' && benchmarkStore) {
      benchmarkStore.saveResults(benchmark.tenantId, benchmark.id, results);
    }

    return results;
  }

  /**
   * Generate a human-readable summary of benchmark comparisons.
   */
  formatSummary(
    comparisons: MetricComparison[],
    variants: VariantMetrics[],
  ): string {
    const parts: string[] = [];

    // Warning: insufficient data
    const lowDataVariants = variants.filter(
      (v) => v.sessionCount < MIN_SESSIONS_FOR_RELIABLE_RESULTS,
    );
    if (lowDataVariants.length > 0) {
      const names = lowDataVariants
        .map((v) => `${v.variantName}: ${v.sessionCount} sessions`)
        .join(', ');
      parts.push(`⚠️ Insufficient data (${names}). Results may be unreliable.`);
    }

    // Group significant comparisons by winner
    const significant = comparisons.filter((c) => c.significant);

    if (significant.length === 0) {
      parts.push(
        'No significant differences found between variants.' +
          (variants.length > 0
            ? ` Current sample sizes: ${variants.map((v) => `${v.variantName}: ${v.sessionCount}`).join(', ')}.`
            : ''),
      );
      return parts.join('\n');
    }

    // Build wins map: winnerId → list of comparisons
    const winsByVariant = new Map<string, MetricComparison[]>();
    for (const comp of significant) {
      if (!comp.winner) continue;
      const wins = winsByVariant.get(comp.winner) ?? [];
      wins.push(comp);
      winsByVariant.set(comp.winner, wins);
    }

    // Find variant names
    const variantNameMap = new Map<string, string>();
    for (const v of variants) {
      variantNameMap.set(v.variantId, v.variantName);
    }
    // Also look in comparisons for variant names
    for (const c of comparisons) {
      variantNameMap.set(c.variantA.id, c.variantA.name);
      variantNameMap.set(c.variantB.id, c.variantB.name);
    }

    // Generate per-winner summaries
    for (const [winnerId, wins] of winsByVariant) {
      const winnerName = variantNameMap.get(winnerId) ?? winnerId;

      // For each win, identify the loser from the comparison
      const metricSummaries = wins.map((comp) => {
        const loserId = comp.winner === comp.variantA.id ? comp.variantB.id : comp.variantA.id;
        const loserName = variantNameMap.get(loserId) ?? loserId;
        const metricName = METRIC_DISPLAY_NAMES[comp.metric] ?? comp.metric;
        const pctSign = comp.percentDiff >= 0 ? '+' : '';
        const pctStr = `${pctSign}${comp.percentDiff.toFixed(0)}%`;

        return `${metricName} (${pctStr}, ${comp.confidence})`;
      });

      // Group by loser
      const loserIds = new Set(
        wins.map((c) =>
          c.winner === c.variantA.id ? c.variantB.id : c.variantA.id,
        ),
      );

      for (const loserId of loserIds) {
        const loserName = variantNameMap.get(loserId) ?? loserId;
        const relevantWins = wins.filter(
          (c) =>
            (c.winner === c.variantA.id && c.variantB.id === loserId) ||
            (c.winner === c.variantB.id && c.variantA.id === loserId),
        );
        const metricTexts = relevantWins.map((comp) => {
          const metricName = METRIC_DISPLAY_NAMES[comp.metric] ?? comp.metric;
          const pctSign = comp.percentDiff >= 0 ? '+' : '';
          const pctStr = `${pctSign}${comp.percentDiff.toFixed(0)}%`;
          return `${metricName} (${pctStr}, ${comp.confidence})`;
        });

        parts.push(
          `${winnerName} outperforms ${loserName} on ${metricTexts.join(' and ')}.`,
        );
      }
    }

    // Note metrics with no significant differences
    const notSignificant = comparisons.filter((c) => !c.significant);
    if (notSignificant.length > 0) {
      const nsMetrics = [...new Set(notSignificant.map((c) => METRIC_DISPLAY_NAMES[c.metric] ?? c.metric))];
      parts.push(`No significant difference on ${nsMetrics.join(', ')}.`);
    }

    return parts.join('\n');
  }
}
