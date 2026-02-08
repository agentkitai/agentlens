/**
 * Analysis Dispatcher (Story 4.6)
 *
 * Maps analysis type strings to handler functions and converts
 * their results into the unified ReflectResult format.
 */

import type { IEventStore, ReflectResult, ReflectAnalysis, ReflectInsight } from '@agentlensai/core';
import { analyzeErrorPatterns } from './error-patterns.js';
import { analyzeToolSequences } from './tool-sequences.js';
import { analyzeCosts } from './cost-analysis.js';
import { analyzePerformance } from './performance-trends.js';

export interface AnalysisOpts {
  agentId?: string;
  from?: string;
  to?: string;
  limit?: number;
  params?: Record<string, unknown>;
}

/**
 * Run an analysis by type string and return a unified ReflectResult.
 */
export async function runAnalysis(
  analysis: string,
  store: IEventStore,
  opts: AnalysisOpts = {},
): Promise<ReflectResult> {
  switch (analysis) {
    case 'error_patterns':
      return runErrorPatterns(store, opts);
    case 'tool_sequences':
      return runToolSequences(store, opts);
    case 'cost_analysis':
      return runCostAnalysis(store, opts);
    case 'performance_trends':
      return runPerformanceTrends(store, opts);
    default:
      throw new Error(`Unknown analysis type: ${analysis}`);
  }
}

async function runErrorPatterns(
  store: IEventStore,
  opts: AnalysisOpts,
): Promise<ReflectResult> {
  const result = await analyzeErrorPatterns(store, opts);

  const insights: ReflectInsight[] = result.patterns.map((p) => ({
    type: 'error_pattern',
    summary: `Error pattern "${p.pattern}" occurred ${p.count} time(s) across ${p.affectedSessions.length} session(s)`,
    data: {
      pattern: p.pattern,
      count: p.count,
      firstSeen: p.firstSeen,
      lastSeen: p.lastSeen,
      affectedSessions: p.affectedSessions,
      precedingTools: p.precedingTools,
    },
    confidence: Math.min(0.5 + p.count * 0.1, 1.0),
  }));

  return {
    analysis: 'error_patterns' as ReflectAnalysis,
    insights,
    metadata: {
      sessionsAnalyzed: new Set(result.patterns.flatMap((p) => p.affectedSessions)).size,
      eventsAnalyzed: result.metadata.eventsAnalyzed,
      timeRange: result.metadata.timeRange,
    },
  };
}

async function runToolSequences(
  store: IEventStore,
  opts: AnalysisOpts,
): Promise<ReflectResult> {
  const result = await analyzeToolSequences(store, opts);

  const insights: ReflectInsight[] = result.sequences.map((s) => ({
    type: s.errorRate > 0 ? 'error_prone_sequence' : 'tool_sequence',
    summary: `Sequence [${s.tools.join(' → ')}] used ${s.frequency} time(s) across ${s.sessions} session(s)${s.errorRate > 0 ? ` (${Math.round(s.errorRate * 100)}% error rate)` : ''}`,
    data: {
      tools: s.tools,
      frequency: s.frequency,
      sessions: s.sessions,
      errorRate: s.errorRate,
    },
    confidence: Math.min(0.4 + s.frequency * 0.1, 1.0),
  }));

  return {
    analysis: 'tool_sequences' as ReflectAnalysis,
    insights,
    metadata: {
      sessionsAnalyzed: result.stats.totalCalls > 0 ? result.sequences.reduce((max, s) => Math.max(max, s.sessions), 0) : 0,
      eventsAnalyzed: result.metadata.eventsAnalyzed,
      timeRange: result.metadata.timeRange,
    },
  };
}

async function runCostAnalysis(
  store: IEventStore,
  opts: AnalysisOpts,
): Promise<ReflectResult> {
  const model = opts.params?.model as string | undefined;
  const result = await analyzeCosts(store, { ...opts, model });

  const insights: ReflectInsight[] = [];

  // Summary insight
  insights.push({
    type: 'cost_summary',
    summary: `Total cost: $${result.summary.totalCost.toFixed(4)} across ${result.summary.totalSessions} session(s) (avg $${result.summary.avgPerSession.toFixed(4)}/session)`,
    data: result.summary as unknown as Record<string, unknown>,
    confidence: 1.0,
  });

  // Trend insight
  insights.push({
    type: 'cost_trend',
    summary: `Cost trend is ${result.trend.direction}`,
    data: {
      direction: result.trend.direction,
      bucketCount: result.trend.buckets.length,
    },
    confidence: result.trend.buckets.length >= 7 ? 0.8 : 0.5,
  });

  // Top model insights
  for (const m of result.byModel.slice(0, 3)) {
    insights.push({
      type: 'cost_by_model',
      summary: `Model "${m.model}": $${m.totalCost.toFixed(4)} (${m.callCount} calls, avg $${m.avgCostPerCall.toFixed(4)}/call)`,
      data: m as unknown as Record<string, unknown>,
      confidence: 0.9,
    });
  }

  return {
    analysis: 'cost_analysis' as ReflectAnalysis,
    insights,
    metadata: {
      sessionsAnalyzed: result.summary.totalSessions,
      eventsAnalyzed: result.metadata.eventsAnalyzed,
      timeRange: result.metadata.timeRange,
    },
  };
}

async function runPerformanceTrends(
  store: IEventStore,
  opts: AnalysisOpts,
): Promise<ReflectResult> {
  const result = await analyzePerformance(store, opts);

  const insights: ReflectInsight[] = [];

  // Current performance insight
  insights.push({
    type: 'performance_current',
    summary: `Current: ${Math.round(result.current.successRate * 100)}% success rate, avg ${result.current.avgDuration}ms duration, ${result.current.avgToolCalls} tool calls/session, ${result.current.avgErrors} errors/session`,
    data: result.current as unknown as Record<string, unknown>,
    confidence: result.metadata.sessionsAnalyzed >= 10 ? 0.9 : 0.6,
  });

  // Assessment insight
  insights.push({
    type: 'performance_assessment',
    summary: `Performance trend: ${result.assessment}`,
    data: { assessment: result.assessment },
    confidence: result.trends.length >= 4 ? 0.8 : 0.5,
  });

  return {
    analysis: 'performance_trends' as ReflectAnalysis,
    insights,
    metadata: result.metadata,
  };
}

// Re-export individual analysis functions
export { analyzeErrorPatterns } from './error-patterns.js';
export { analyzeToolSequences } from './tool-sequences.js';
export { analyzeCosts } from './cost-analysis.js';
export { analyzePerformance } from './performance-trends.js';
