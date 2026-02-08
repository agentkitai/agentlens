/**
 * Performance Trends Analysis (Story 4.4)
 *
 * Analyzes sessions over time to calculate success rates, durations,
 * tool call averages, and error averages, with trend detection.
 */

import type { IEventStore } from '@agentlensai/core';
import type {
  PerformanceTrendsResult,
  PerformanceTrendBucket,
  Session,
} from '@agentlensai/core';

export interface PerformanceTrendsOpts {
  agentId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * Analyze performance trends across sessions.
 */
export async function analyzePerformance(
  store: IEventStore,
  opts: PerformanceTrendsOpts = {},
): Promise<PerformanceTrendsResult> {
  // Query sessions
  const sessionResult = await store.querySessions({
    agentId: opts.agentId,
    from: opts.from,
    to: opts.to,
    limit: 500,
  });

  const sessions = sessionResult.sessions;
  const sessionsAnalyzed = sessions.length;

  // Count events for metadata
  const eventCount = await store.countEvents({
    agentId: opts.agentId,
    from: opts.from,
    to: opts.to,
  });

  const timeRange = {
    from: sessions.length > 0
      ? sessions.reduce((min, s) => (s.startedAt < min ? s.startedAt : min), sessions[0]!.startedAt)
      : (opts.from ?? ''),
    to: sessions.length > 0
      ? sessions.reduce((max, s) => (s.startedAt > max ? s.startedAt : max), sessions[0]!.startedAt)
      : (opts.to ?? ''),
  };

  // Current aggregate metrics
  const successCount = sessions.filter((s) => s.errorCount === 0).length;
  const successRate = sessionsAnalyzed > 0 ? successCount / sessionsAnalyzed : 0;

  const durations = sessions
    .filter((s) => s.endedAt && s.startedAt)
    .map((s) => new Date(s.endedAt!).getTime() - new Date(s.startedAt).getTime());
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  const avgToolCalls = sessionsAnalyzed > 0
    ? sessions.reduce((sum, s) => sum + s.toolCallCount, 0) / sessionsAnalyzed
    : 0;

  const avgErrors = sessionsAnalyzed > 0
    ? sessions.reduce((sum, s) => sum + s.errorCount, 0) / sessionsAnalyzed
    : 0;

  // Bucket by day for trend lines
  const dailyMap = new Map<
    string,
    {
      sessions: Session[];
    }
  >();

  for (const session of sessions) {
    const date = session.startedAt.slice(0, 10); // YYYY-MM-DD
    const entry = dailyMap.get(date) ?? { sessions: [] };
    entry.sessions.push(session);
    dailyMap.set(date, entry);
  }

  const limit = opts.limit ?? 20;
  const allBuckets: PerformanceTrendBucket[] = Array.from(dailyMap.entries())
    .map(([date, data]) => {
      const daySessions = data.sessions;
      const daySuccess = daySessions.filter((s) => s.errorCount === 0).length;
      const dayDurations = daySessions
        .filter((s) => s.endedAt && s.startedAt)
        .map((s) => new Date(s.endedAt!).getTime() - new Date(s.startedAt).getTime());

      return {
        date,
        successRate: daySessions.length > 0 ? daySuccess / daySessions.length : 0,
        duration:
          dayDurations.length > 0
            ? dayDurations.reduce((a, b) => a + b, 0) / dayDurations.length
            : 0,
        toolCalls:
          daySessions.length > 0
            ? daySessions.reduce((sum, s) => sum + s.toolCallCount, 0) / daySessions.length
            : 0,
        errors:
          daySessions.length > 0
            ? daySessions.reduce((sum, s) => sum + s.errorCount, 0) / daySessions.length
            : 0,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // Respect limit on trend buckets
  const trends = allBuckets.slice(-limit);

  // Trend assessment: compare recent half vs historical half
  const assessment = detectPerformanceTrend(allBuckets);

  return {
    current: {
      successRate: Math.round(successRate * 10000) / 10000,
      avgDuration: Math.round(avgDuration),
      avgToolCalls: Math.round(avgToolCalls * 100) / 100,
      avgErrors: Math.round(avgErrors * 100) / 100,
    },
    trends,
    assessment,
    metadata: {
      sessionsAnalyzed,
      eventsAnalyzed: eventCount,
      timeRange,
    },
  };
}

/**
 * Detect performance trend by comparing recent vs historical success rates.
 */
function detectPerformanceTrend(
  buckets: PerformanceTrendBucket[],
): 'improving' | 'stable' | 'degrading' {
  if (buckets.length < 2) return 'stable';

  const midpoint = Math.floor(buckets.length / 2);
  const recent = buckets.slice(midpoint);
  const historical = buckets.slice(0, midpoint);

  if (historical.length === 0 || recent.length === 0) return 'stable';

  const recentAvgSuccess =
    recent.reduce((s, b) => s + b.successRate, 0) / recent.length;
  const historicalAvgSuccess =
    historical.reduce((s, b) => s + b.successRate, 0) / historical.length;

  const diff = recentAvgSuccess - historicalAvgSuccess;

  if (diff > 0.05) return 'improving';
  if (diff < -0.05) return 'degrading';
  return 'stable';
}
