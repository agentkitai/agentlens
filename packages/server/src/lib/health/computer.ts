/**
 * Health Score Computer (Story 1.2)
 *
 * Computes health scores for agents based on five dimensions:
 * error rate, cost efficiency, tool success, latency, and completion rate.
 * Each dimension is normalized to 0-100 and combined with configurable weights.
 */

import type {
  IEventStore,
  HealthScore,
  HealthDimension,
  HealthTrend,
  HealthWeights,
  Session,
  AgentLensEvent,
} from '@agentlensai/core';

/** Clamp a value between min and max */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Get an ISO date string N days ago from a reference date */
function daysAgo(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export class HealthComputer {
  constructor(private readonly weights: HealthWeights) {}

  /**
   * Compute the health score for a single agent within a time window.
   * Returns null if no sessions exist in the window.
   */
  async compute(
    store: IEventStore,
    agentId: string,
    windowDays: number,
  ): Promise<HealthScore | null> {
    const now = new Date();
    const windowFrom = daysAgo(windowDays, now);
    const windowTo = now.toISOString();

    // Query sessions in the current window
    const { sessions } = await store.querySessions({
      agentId,
      from: windowFrom,
      to: windowTo,
      limit: 10000,
    });

    if (sessions.length === 0) {
      return null;
    }

    // Query sessions for the 30-day baseline
    const baselineFrom = daysAgo(30, now);
    const { sessions: baselineSessions } = await store.querySessions({
      agentId,
      from: baselineFrom,
      to: windowTo,
      limit: 10000,
    });

    // Query tool events in the current window
    const { events: toolEvents } = await store.queryEvents({
      agentId,
      from: windowFrom,
      to: windowTo,
      eventType: ['tool_call', 'tool_response'],
      limit: 10000,
    });

    // Compute each dimension
    const errorRateDim = this.computeErrorRate(sessions);
    const costEfficiencyDim = this.computeCostEfficiency(sessions, baselineSessions);
    const toolSuccessDim = this.computeToolSuccess(toolEvents);
    const latencyDim = this.computeLatency(sessions, baselineSessions);
    const completionRateDim = this.computeCompletionRate(sessions);

    const dimensions: HealthDimension[] = [
      errorRateDim,
      costEfficiencyDim,
      toolSuccessDim,
      latencyDim,
      completionRateDim,
    ];

    const overallScore =
      errorRateDim.score * this.weights.errorRate +
      costEfficiencyDim.score * this.weights.costEfficiency +
      toolSuccessDim.score * this.weights.toolSuccess +
      latencyDim.score * this.weights.latency +
      completionRateDim.score * this.weights.completionRate;

    // Compute trend by comparing against previous window
    const trend = await this.computeTrend(store, agentId, windowDays, overallScore, now);

    return {
      agentId,
      overallScore: Math.round(overallScore * 100) / 100,
      trend: trend.direction,
      trendDelta: trend.delta,
      dimensions,
      window: { from: windowFrom, to: windowTo },
      sessionCount: sessions.length,
      computedAt: now.toISOString(),
    };
  }

  /**
   * Compute health scores for all agents in the store.
   */
  async computeOverview(
    store: IEventStore,
    windowDays: number,
  ): Promise<HealthScore[]> {
    const agents = await store.listAgents();
    const results: HealthScore[] = [];

    for (const agent of agents) {
      const score = await this.compute(store, agent.id, windowDays);
      if (score !== null) {
        results.push(score);
      }
    }

    return results;
  }

  // ─── Dimension Calculations ─────────────────────────────

  private computeErrorRate(sessions: Session[]): HealthDimension {
    const total = sessions.length;
    const withErrors = sessions.filter((s) => s.errorCount > 0).length;
    const errorRate = total > 0 ? withErrors / total : 0;
    const score = (1 - errorRate) * 100;

    return {
      name: 'error_rate',
      score: Math.round(score * 100) / 100,
      weight: this.weights.errorRate,
      rawValue: Math.round(errorRate * 10000) / 10000,
      description: `${withErrors}/${total} sessions had errors`,
    };
  }

  private computeCostEfficiency(
    windowSessions: Session[],
    baselineSessions: Session[],
  ): HealthDimension {
    const windowTotal = windowSessions.reduce((sum, s) => sum + s.totalCostUsd, 0);
    const windowAvg = windowSessions.length > 0 ? windowTotal / windowSessions.length : 0;

    const baselineTotal = baselineSessions.reduce((sum, s) => sum + s.totalCostUsd, 0);
    const baselineAvg = baselineSessions.length > 0 ? baselineTotal / baselineSessions.length : 0;

    let score: number;
    if (baselineAvg === 0 || windowAvg === 0) {
      // No cost data or no baseline — neutral score
      score = 100;
    } else {
      const ratio = windowAvg / baselineAvg;
      score = clamp(100 - (ratio - 1) * 100, 0, 100);
    }

    return {
      name: 'cost_efficiency',
      score: Math.round(score * 100) / 100,
      weight: this.weights.costEfficiency,
      rawValue: Math.round(windowAvg * 1000000) / 1000000,
      description: `Avg cost per session: $${windowAvg.toFixed(4)}`,
    };
  }

  private computeToolSuccess(toolEvents: AgentLensEvent[]): HealthDimension {
    // Separate tool_call and tool_response events
    const toolCalls = toolEvents.filter((e) => e.eventType === 'tool_call');
    const toolResponses = toolEvents.filter((e) => e.eventType === 'tool_response');

    const totalCalls = toolCalls.length;

    if (totalCalls === 0) {
      return {
        name: 'tool_success',
        score: 100,
        weight: this.weights.toolSuccess,
        rawValue: 1,
        description: 'No tool calls in window',
      };
    }

    // Count failed tool responses (isError=true in payload)
    const failedCalls = toolResponses.filter((e) => {
      const payload = e.payload as Record<string, unknown>;
      return payload.isError === true;
    }).length;

    const successRate = (totalCalls - failedCalls) / totalCalls;
    const score = successRate * 100;

    return {
      name: 'tool_success',
      score: Math.round(score * 100) / 100,
      weight: this.weights.toolSuccess,
      rawValue: Math.round(successRate * 10000) / 10000,
      description: `${totalCalls - failedCalls}/${totalCalls} tool calls succeeded`,
    };
  }

  private computeLatency(
    windowSessions: Session[],
    baselineSessions: Session[],
  ): HealthDimension {
    // Compute average duration for sessions with endedAt
    const windowDurations = windowSessions
      .filter((s) => s.endedAt)
      .map((s) => new Date(s.endedAt!).getTime() - new Date(s.startedAt).getTime());

    const avgDuration =
      windowDurations.length > 0
        ? windowDurations.reduce((a, b) => a + b, 0) / windowDurations.length
        : 0;

    const baselineDurations = baselineSessions
      .filter((s) => s.endedAt)
      .map((s) => new Date(s.endedAt!).getTime() - new Date(s.startedAt).getTime());

    const baselineDuration =
      baselineDurations.length > 0
        ? baselineDurations.reduce((a, b) => a + b, 0) / baselineDurations.length
        : 0;

    let score: number;
    if (baselineDuration === 0 || avgDuration === 0) {
      score = 100;
    } else {
      const ratio = avgDuration / baselineDuration;
      score = clamp(100 - (ratio - 1) * 50, 0, 100);
    }

    return {
      name: 'latency',
      score: Math.round(score * 100) / 100,
      weight: this.weights.latency,
      rawValue: Math.round(avgDuration),
      description: `Avg session duration: ${Math.round(avgDuration)}ms`,
    };
  }

  private computeCompletionRate(sessions: Session[]): HealthDimension {
    const total = sessions.length;
    const completed = sessions.filter((s) => s.status === 'completed').length;
    const rate = total > 0 ? completed / total : 0;
    const score = rate * 100;

    return {
      name: 'completion_rate',
      score: Math.round(score * 100) / 100,
      weight: this.weights.completionRate,
      rawValue: Math.round(rate * 10000) / 10000,
      description: `${completed}/${total} sessions completed`,
    };
  }

  // ─── Trend ──────────────────────────────────────────────

  private async computeTrend(
    store: IEventStore,
    agentId: string,
    windowDays: number,
    currentScore: number,
    now: Date,
  ): Promise<{ direction: HealthTrend; delta: number }> {
    // Previous window: windowDays to 2*windowDays ago
    const prevFrom = daysAgo(windowDays * 2, now);
    const prevTo = daysAgo(windowDays, now);

    const { sessions: prevSessions } = await store.querySessions({
      agentId,
      from: prevFrom,
      to: prevTo,
      limit: 10000,
    });

    if (prevSessions.length === 0) {
      // No previous data — stable
      return { direction: 'stable', delta: 0 };
    }

    // Query 30-day baseline for previous window
    const baselineFrom = daysAgo(30, now);
    const { sessions: baselineSessions } = await store.querySessions({
      agentId,
      from: baselineFrom,
      to: prevTo,
      limit: 10000,
    });

    // Query tool events for previous window
    const { events: prevToolEvents } = await store.queryEvents({
      agentId,
      from: prevFrom,
      to: prevTo,
      eventType: ['tool_call', 'tool_response'],
      limit: 10000,
    });

    // Compute previous window dimensions
    const prevErrorRate = this.computeErrorRate(prevSessions);
    const prevCostEff = this.computeCostEfficiency(prevSessions, baselineSessions);
    const prevToolSuccess = this.computeToolSuccess(prevToolEvents);
    const prevLatency = this.computeLatency(prevSessions, baselineSessions);
    const prevCompletion = this.computeCompletionRate(prevSessions);

    const prevOverall =
      prevErrorRate.score * this.weights.errorRate +
      prevCostEff.score * this.weights.costEfficiency +
      prevToolSuccess.score * this.weights.toolSuccess +
      prevLatency.score * this.weights.latency +
      prevCompletion.score * this.weights.completionRate;

    const delta = Math.round((currentScore - prevOverall) * 100) / 100;

    let direction: HealthTrend;
    if (delta > 5) {
      direction = 'improving';
    } else if (delta < -5) {
      direction = 'degrading';
    } else {
      direction = 'stable';
    }

    return { direction, delta };
  }
}
