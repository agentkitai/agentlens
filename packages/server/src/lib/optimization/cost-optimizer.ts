/**
 * CostOptimizer Façade (Feature 17 — Story 17.4)
 *
 * Orchestrates multiple analyzers in parallel, deduplicates results,
 * sorts by savings, and returns EnhancedOptimizationResult.
 */

import type {
  IEventStore,
  ModelCosts,
  EnhancedOptimizationResult,
  EnhancedRecommendation,
  OptimizationCategory,
  LlmResponsePayload,
  AgentLensEvent,
} from '@agentlensai/core';
import { DEFAULT_MODEL_COSTS } from '@agentlensai/core';
import type { Analyzer, AnalyzerContext } from './analyzers/types.js';
import { ModelDowngradeAnalyzer } from './analyzers/model-downgrade.js';
import { PromptOptimizationAnalyzer } from './analyzers/prompt-optimization.js';

const ALL_CATEGORIES: OptimizationCategory[] = [
  'model_downgrade',
  'prompt_optimization',
  'caching',
  'tool_reduction',
];

export class CostOptimizer {
  private analyzers: Analyzer[];

  constructor(
    private readonly store: IEventStore,
    private readonly modelCosts: ModelCosts = DEFAULT_MODEL_COSTS,
  ) {
    this.analyzers = [
      new ModelDowngradeAnalyzer(modelCosts),
      new PromptOptimizationAnalyzer(modelCosts),
    ];
  }

  async getRecommendations(options: {
    agentId?: string;
    period: number;
    limit: number;
    includeCrossAgent?: boolean;
  }): Promise<EnhancedOptimizationResult> {
    const now = new Date();
    const from = new Date(now.getTime() - options.period * 24 * 60 * 60 * 1000).toISOString();
    const to = now.toISOString();

    // Pre-fetch events once
    const [callResult, responseResult] = await Promise.all([
      this.store.queryEvents({
        eventType: 'llm_call',
        agentId: options.agentId,
        from,
        to,
        limit: 10_000,
        order: 'asc',
      }),
      this.store.queryEvents({
        eventType: 'llm_response',
        agentId: options.agentId,
        from,
        to,
        limit: 10_000,
        order: 'asc',
      }),
    ]);

    // Build response lookup
    const responseMap = new Map<string, AgentLensEvent>();
    for (const evt of responseResult.events) {
      const payload = evt.payload as Partial<LlmResponsePayload>;
      if (payload.callId) {
        responseMap.set(payload.callId, evt);
      }
    }

    const ctx: AnalyzerContext = {
      store: this.store,
      agentId: options.agentId,
      from,
      to,
      period: options.period,
      limit: options.limit,
      llmCallEvents: callResult.events,
      llmResponseEvents: responseResult.events,
      responseMap,
    };

    // Run all analyzers in parallel
    const results = await Promise.all(
      this.analyzers.map(a => a.analyze(ctx)),
    );

    // Flatten, deduplicate, sort
    const seen = new Set<string>();
    let recommendations: EnhancedRecommendation[] = [];
    for (const recs of results) {
      for (const rec of recs) {
        if (!seen.has(rec.id)) {
          seen.add(rec.id);
          recommendations.push(rec);
        }
      }
    }

    recommendations.sort((a, b) => b.estimatedMonthlySavings - a.estimatedMonthlySavings);
    recommendations = recommendations.slice(0, options.limit);

    const totalPotentialSavings = recommendations.reduce(
      (sum, r) => sum + r.estimatedMonthlySavings, 0,
    );

    const byCategory = this.computeCategorySummary(recommendations);

    return {
      recommendations,
      totalPotentialSavings: Math.round(totalPotentialSavings * 1_000_000) / 1_000_000,
      period: options.period,
      analyzedCalls: callResult.events.length,
      byCategory,
    };
  }

  private computeCategorySummary(
    recommendations: EnhancedRecommendation[],
  ): Record<OptimizationCategory, { count: number; totalSavings: number }> {
    const summary: Record<OptimizationCategory, { count: number; totalSavings: number }> = {} as any;
    for (const cat of ALL_CATEGORIES) {
      summary[cat] = { count: 0, totalSavings: 0 };
    }
    for (const rec of recommendations) {
      const entry = summary[rec.category];
      if (entry) {
        entry.count++;
        entry.totalSavings += rec.estimatedMonthlySavings;
      }
    }
    // Round
    for (const cat of ALL_CATEGORIES) {
      summary[cat].totalSavings = Math.round(summary[cat].totalSavings * 1_000_000) / 1_000_000;
    }
    return summary;
  }
}
