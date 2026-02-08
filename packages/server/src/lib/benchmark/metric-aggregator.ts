/**
 * MetricAggregator (Story 3.2)
 *
 * Computes descriptive statistics for each benchmark metric across a variant's sessions.
 * Provides clean inputs for the StatisticalComparator.
 */

import type {
  BenchmarkMetric,
  BenchmarkVariant,
  IEventStore,
  MetricStats,
  Session,
} from '@agentlensai/core';

// ─── Public Interface ──────────────────────────────────────

export class MetricAggregator {
  /**
   * Aggregate metrics for a variant by querying sessions matching the variant's tag.
   *
   * @param store - Event store to query sessions from
   * @param variant - The benchmark variant (identifies sessions via tag)
   * @param metrics - Which metrics to compute
   * @param timeRange - Optional time range filter
   * @returns Record of metric → MetricStats
   */
  async aggregate(
    store: IEventStore,
    variant: BenchmarkVariant,
    metrics: BenchmarkMetric[],
    timeRange?: { from: string; to: string },
  ): Promise<{ sessionCount: number; metrics: Record<BenchmarkMetric, MetricStats> }> {
    // Paginate through all sessions (store caps at 500 per query)
    const sessions: Session[] = [];
    const pageSize = 500;
    let offset = 0;
    while (true) {
      const page = await store.querySessions({
        tenantId: variant.tenantId,
        agentId: variant.agentId,
        tags: [variant.tag],
        from: timeRange?.from,
        to: timeRange?.to,
        limit: pageSize,
        offset,
      });
      sessions.push(...page.sessions);
      if (page.sessions.length < pageSize) break;
      offset += pageSize;
    }

    const result = {} as Record<BenchmarkMetric, MetricStats>;

    for (const metric of metrics) {
      const values = this.extractMetricValues(sessions, metric);
      result[metric] = this.computeStats(values);
    }

    return {
      sessionCount: sessions.length,
      metrics: result,
    };
  }

  /**
   * Extract numeric values for a metric from a list of sessions.
   */
  extractMetricValues(sessions: Session[], metric: BenchmarkMetric): number[] {
    const values: number[] = [];

    for (const session of sessions) {
      const value = this.extractSingleValue(session, metric);
      if (value !== null && !isNaN(value)) {
        values.push(value);
      }
    }

    return values;
  }

  /**
   * Extract a single metric value from a session.
   */
  private extractSingleValue(session: Session, metric: BenchmarkMetric): number | null {
    switch (metric) {
      case 'avg_cost':
        return session.totalCostUsd;

      case 'error_rate':
        // Error rate = errorCount / eventCount
        if (session.eventCount === 0) return null;
        return session.errorCount / session.eventCount;

      case 'completion_rate':
        // Binary: 1 if completed, 0 otherwise
        return session.status === 'completed' ? 1 : 0;

      case 'tool_success_rate':
        // errorCount includes ALL errors (LLM, system, etc.), not just tool errors.
        // Use conservative proxy: cap tool errors at toolCallCount to avoid negative rates.
        if (session.toolCallCount === 0) return null;
        const toolErrors = Math.min(session.errorCount, session.toolCallCount);
        return Math.max(0, (session.toolCallCount - toolErrors) / session.toolCallCount);

      case 'avg_tokens':
        return session.totalInputTokens + session.totalOutputTokens;

      case 'avg_duration': {
        // Duration in milliseconds
        if (!session.endedAt || !session.startedAt) return null;
        const start = new Date(session.startedAt).getTime();
        const end = new Date(session.endedAt).getTime();
        const durationMs = end - start;
        return durationMs > 0 ? durationMs : null;
      }

      case 'avg_latency':
        // avg_latency requires event-level query; we approximate from session-level data
        // latency ≈ duration / llmCallCount (average time per LLM call)
        if (!session.endedAt || !session.startedAt || session.llmCallCount === 0) return null;
        const startMs = new Date(session.startedAt).getTime();
        const endMs = new Date(session.endedAt).getTime();
        const totalDuration = endMs - startMs;
        return totalDuration > 0 ? totalDuration / session.llmCallCount : null;

      case 'health_score':
        // health_score is a composite score that would need the HealthComputer.
        // At the session level, we compute a simplified score:
        // Based on error rate, completion, and tool success
        // This is a placeholder that returns null if not computed elsewhere.
        return null;

      default:
        return null;
    }
  }

  /**
   * Compute descriptive statistics from an array of numeric values.
   */
  computeStats(values: number[]): MetricStats {
    if (values.length === 0) {
      return {
        mean: 0,
        median: 0,
        stddev: 0,
        min: 0,
        max: 0,
        count: 0,
      };
    }

    const n = values.length;
    const sorted = [...values].sort((a, b) => a - b);

    const sum = values.reduce((acc, v) => acc + v, 0);
    const mean = sum / n;

    // Median
    let median: number;
    if (n % 2 === 0) {
      median = (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
    } else {
      median = sorted[Math.floor(n / 2)]!;
    }

    // Sample standard deviation (Bessel's correction)
    let variance: number;
    if (n < 2) {
      variance = 0;
    } else {
      const sumSquaredDiffs = values.reduce((acc, v) => acc + (v - mean) ** 2, 0);
      variance = sumSquaredDiffs / (n - 1);
    }
    const stddev = Math.sqrt(variance);

    return {
      mean,
      median,
      stddev,
      min: sorted[0]!,
      max: sorted[n - 1]!,
      count: n,
    };
  }
}
