/**
 * ModelDowngradeAnalyzer (Feature 17 — Story 17.2)
 *
 * Wraps the existing OptimizationEngine and maps its CostRecommendation
 * output to EnhancedRecommendation with category 'model_downgrade'.
 */

import type { ModelCosts, EnhancedRecommendation } from '@agentlensai/core';
import { DEFAULT_MODEL_COSTS } from '@agentlensai/core';
import { OptimizationEngine } from '../engine.js';
import type { Analyzer, AnalyzerContext } from './types.js';
import { createHash } from 'node:crypto';

export class ModelDowngradeAnalyzer implements Analyzer {
  readonly name = 'model_downgrade';
  private engine: OptimizationEngine;

  constructor(modelCosts: ModelCosts = DEFAULT_MODEL_COSTS) {
    this.engine = new OptimizationEngine(modelCosts);
  }

  async analyze(ctx: AnalyzerContext): Promise<EnhancedRecommendation[]> {
    const result = await this.engine.getRecommendations(ctx.store, {
      agentId: ctx.agentId,
      period: ctx.period,
      limit: ctx.limit,
    });

    const now = new Date().toISOString();

    return result.recommendations.map((rec) => {
      const id = createHash('sha256')
        .update(`model_downgrade:${rec.agentId}:${rec.currentModel}:${rec.recommendedModel}:${rec.complexityTier}`)
        .digest('hex')
        .slice(0, 16);

      return {
        id,
        category: 'model_downgrade' as const,
        estimatedMonthlySavings: rec.monthlySavings,
        confidence: rec.confidence,
        difficulty: 'config_change' as const,
        actionableSteps: [
          `Change model from ${rec.currentModel} to ${rec.recommendedModel} for ${rec.complexityTier} complexity calls`,
          'Monitor success rate for 48h after switch',
        ],
        agentId: rec.agentId,
        evidence: {
          callsAnalyzed: rec.callVolume,
          period: ctx.period,
        },
        createdAt: now,
        modelDowngrade: {
          currentModel: rec.currentModel,
          recommendedModel: rec.recommendedModel,
          complexityTier: rec.complexityTier,
          currentCostPerCall: rec.currentCostPerCall,
          recommendedCostPerCall: rec.recommendedCostPerCall,
          callVolume: rec.callVolume,
          currentSuccessRate: rec.currentSuccessRate,
          recommendedSuccessRate: rec.recommendedSuccessRate,
        },
      };
    });
  }
}
