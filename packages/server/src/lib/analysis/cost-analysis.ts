/**
 * Cost Analysis (Story 4.3)
 *
 * Analyzes cost data from sessions and llm_response events to provide
 * cost breakdowns by model, agent, and time trends.
 */

import type { IEventStore } from '@agentlensai/core';
import type {
  CostAnalysisResult,
  CostByModel,
  CostByAgent,
  CostTrendBucket,
  LlmResponsePayload,
} from '@agentlensai/core';

export interface CostAnalysisOpts {
  agentId?: string;
  from?: string;
  to?: string;
  model?: string;
  limit?: number;
}

/**
 * Analyze costs across sessions and LLM calls.
 */
export async function analyzeCosts(
  store: IEventStore,
  opts: CostAnalysisOpts = {},
): Promise<CostAnalysisResult> {
  const limit = opts.limit ?? 20;

  // Query sessions with cost data
  const sessionResult = await store.querySessions({
    agentId: opts.agentId,
    from: opts.from,
    to: opts.to,
    limit: 1000,
  });

  // Query llm_response events for model breakdown
  const llmResult = await store.queryEvents({
    agentId: opts.agentId,
    from: opts.from,
    to: opts.to,
    eventType: 'llm_response',
    limit: 1000,
    order: 'asc',
  });

  // Track whether either query hit its limit (results may be truncated)
  const possiblyTruncated =
    sessionResult.sessions.length === 1000 || llmResult.events.length === 1000;

  const sessions = sessionResult.sessions;
  const llmEvents = llmResult.events;

  // Filter llm events by model if specified
  const filteredLlmEvents = opts.model
    ? llmEvents.filter((e) => {
        const p = e.payload as Record<string, unknown>;
        return p.model === opts.model;
      })
    : llmEvents;

  const eventsAnalyzed = filteredLlmEvents.length;
  const timeRange = {
    from: sessions.length > 0
      ? sessions.reduce((min, s) => (s.startedAt < min ? s.startedAt : min), sessions[0]!.startedAt)
      : (opts.from ?? ''),
    to: sessions.length > 0
      ? sessions.reduce((max, s) => (s.startedAt > max ? s.startedAt : max), sessions[0]!.startedAt)
      : (opts.to ?? ''),
  };

  // Summary from sessions
  const totalCost = sessions.reduce((sum, s) => sum + s.totalCostUsd, 0);
  const totalSessions = sessions.length;
  const avgPerSession = totalSessions > 0 ? totalCost / totalSessions : 0;

  // Cost by model from llm_response events
  const modelMap = new Map<string, { totalCost: number; callCount: number }>();
  for (const event of filteredLlmEvents) {
    const p = event.payload as LlmResponsePayload;
    const model = p.model ?? 'unknown';
    const cost = p.costUsd ?? 0;

    const entry = modelMap.get(model) ?? { totalCost: 0, callCount: 0 };
    entry.totalCost += cost;
    entry.callCount++;
    modelMap.set(model, entry);
  }

  const byModel: CostByModel[] = Array.from(modelMap.entries())
    .map(([model, data]) => ({
      model,
      totalCost: Math.round(data.totalCost * 1_000_000) / 1_000_000,
      callCount: data.callCount,
      avgCostPerCall:
        data.callCount > 0
          ? Math.round((data.totalCost / data.callCount) * 1_000_000) / 1_000_000
          : 0,
    }))
    .sort((a, b) => b.totalCost - a.totalCost);

  // Cost by agent from sessions
  const agentMap = new Map<string, { totalCost: number; sessionCount: number }>();
  for (const session of sessions) {
    const entry = agentMap.get(session.agentId) ?? { totalCost: 0, sessionCount: 0 };
    entry.totalCost += session.totalCostUsd;
    entry.sessionCount++;
    agentMap.set(session.agentId, entry);
  }

  const byAgent: CostByAgent[] = Array.from(agentMap.entries())
    .map(([agentId, data]) => ({
      agentId,
      totalCost: Math.round(data.totalCost * 1_000_000) / 1_000_000,
      sessionCount: data.sessionCount,
      avgCostPerSession:
        data.sessionCount > 0
          ? Math.round((data.totalCost / data.sessionCount) * 1_000_000) / 1_000_000
          : 0,
    }))
    .sort((a, b) => b.totalCost - a.totalCost);

  // Cost trend over time (daily buckets)
  const dailyMap = new Map<string, { totalCost: number; sessionCount: number }>();
  for (const session of sessions) {
    const date = session.startedAt.slice(0, 10); // YYYY-MM-DD
    const entry = dailyMap.get(date) ?? { totalCost: 0, sessionCount: 0 };
    entry.totalCost += session.totalCostUsd;
    entry.sessionCount++;
    dailyMap.set(date, entry);
  }

  const buckets: CostTrendBucket[] = Array.from(dailyMap.entries())
    .map(([date, data]) => ({
      date,
      totalCost: Math.round(data.totalCost * 1_000_000) / 1_000_000,
      sessionCount: data.sessionCount,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Trend detection: compare last 7 days vs previous 7 days
  const direction = detectCostTrend(buckets);

  // Top sessions by cost
  const topSessions = [...sessions]
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd)
    .slice(0, limit)
    .map((s) => ({
      sessionId: s.id,
      agentId: s.agentId,
      totalCost: Math.round(s.totalCostUsd * 1_000_000) / 1_000_000,
      startedAt: s.startedAt,
    }));

  return {
    summary: {
      totalCost: Math.round(totalCost * 1_000_000) / 1_000_000,
      avgPerSession: Math.round(avgPerSession * 1_000_000) / 1_000_000,
      totalSessions,
    },
    byModel,
    byAgent,
    trend: {
      direction,
      buckets,
    },
    topSessions,
    metadata: {
      eventsAnalyzed,
      timeRange,
      ...(possiblyTruncated ? { truncated: true, note: 'Results may be incomplete — query limit reached' } : {}),
    },
  };
}

/**
 * Detect cost trend by comparing the most recent 7 day-buckets vs the previous 7.
 */
function detectCostTrend(
  buckets: CostTrendBucket[],
): 'increasing' | 'stable' | 'decreasing' {
  if (buckets.length < 2) return 'stable';

  const recent = buckets.slice(-7);
  const previous = buckets.slice(-14, -7);

  if (previous.length === 0) return 'stable';

  const recentTotal = recent.reduce((s, b) => s + b.totalCost, 0);
  const previousTotal = previous.reduce((s, b) => s + b.totalCost, 0);

  if (previousTotal === 0) {
    return recentTotal > 0 ? 'increasing' : 'stable';
  }

  const changeRatio = (recentTotal - previousTotal) / previousTotal;

  if (changeRatio > 0.1) return 'increasing';
  if (changeRatio < -0.1) return 'decreasing';
  return 'stable';
}
