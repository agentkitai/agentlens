/**
 * Recommendation Engine (Story 2.3)
 *
 * Analyzes LLM call patterns and recommends cheaper models for
 * each complexity tier where a cheaper alternative has proven
 * reliable (≥95% success rate).
 */

import type {
  IEventStore,
  AgentLensEvent,
  CostRecommendation,
  OptimizationResult,
  ModelCosts,
  ConfidenceLevel,
  ComplexityTier,
  LlmCallPayload,
  LlmResponsePayload,
} from '@agentlensai/core';
import { DEFAULT_MODEL_COSTS, lookupModelCost } from '@agentlensai/core';
import { classifyCallComplexity } from './classifier.js';

/** Allowed downgrade paths — only recommend within these */
const DOWNGRADE_PATHS: Record<string, string[]> = {
  'claude-opus-4-6': ['claude-sonnet-4-6', 'claude-sonnet-4'],
  'claude-opus-4': ['claude-sonnet-4', 'claude-sonnet-4-6'],
  'claude-sonnet-4-6': ['claude-haiku-4-5-20251001'],
  'claude-sonnet-4': ['claude-haiku-4-5-20251001', 'claude-haiku-3.5'],
  'gpt-4o': ['gpt-4o-mini'],
  'gpt-4.1': ['gpt-4.1-mini', 'gpt-4.1-nano'],
  'gpt-4.1-mini': ['gpt-4.1-nano'],
};

/** Minimum calls required at a tier before making a recommendation */
const MIN_CALL_VOLUME = 20;

/** Internal aggregation bucket for (model, tier) groups */
interface ModelTierGroup {
  model: string;
  tier: ComplexityTier;
  callCount: number;
  successCount: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  agentIds: Set<string>;
}

export class OptimizationEngine {
  constructor(
    private readonly modelCosts: ModelCosts = DEFAULT_MODEL_COSTS,
  ) {}

  async getRecommendations(
    store: IEventStore,
    options: {
      agentId?: string;
      period: number;   // days
      limit: number;
    },
  ): Promise<OptimizationResult> {
    const { agentId, period, limit } = options;

    // Compute date range
    const now = new Date();
    const from = new Date(now.getTime() - period * 24 * 60 * 60 * 1000).toISOString();
    const to = now.toISOString();

    // 1. Query llm_call events for the period
    const callResult = await store.queryEvents({
      eventType: 'llm_call',
      agentId,
      from,
      to,
      limit: 10_000,
      order: 'asc',
    });

    const callEvents = callResult.events;

    if (callEvents.length === 0) {
      return {
        recommendations: [],
        totalPotentialSavings: 0,
        period,
        analyzedCalls: 0,
      };
    }

    // 2. Query llm_response events for pairing
    const responseResult = await store.queryEvents({
      eventType: 'llm_response',
      agentId,
      from,
      to,
      limit: 10_000,
      order: 'asc',
    });

    // Build response lookup by callId
    const responseMap = new Map<string, AgentLensEvent>();
    for (const evt of responseResult.events) {
      const payload = evt.payload as Partial<LlmResponsePayload>;
      if (payload.callId) {
        responseMap.set(payload.callId, evt);
      }
    }

    // 3. Classify each call and group by (model, tier)
    const groups = new Map<string, ModelTierGroup>();

    for (const callEvent of callEvents) {
      const callPayload = callEvent.payload as Partial<LlmCallPayload>;
      const callId = callPayload.callId;
      const model = callPayload.model;

      if (!model) continue;

      const responseEvent = callId ? responseMap.get(callId) ?? null : null;
      const responsePayload = responseEvent?.payload as Partial<LlmResponsePayload> | undefined;

      // Skip unmatched calls (no response yet) — don't count them as failures
      if (!responseEvent) continue;

      const { tier } = classifyCallComplexity(callEvent, responseEvent);

      const groupKey = `${model}::${tier}`;
      let group = groups.get(groupKey);
      if (!group) {
        group = {
          model,
          tier,
          callCount: 0,
          successCount: 0,
          totalCost: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          agentIds: new Set(),
        };
        groups.set(groupKey, group);
      }

      group.callCount++;
      group.agentIds.add(callEvent.agentId);

      // Determine success: finishReason is not 'error'
      const isError = responsePayload?.finishReason === 'error';
      if (!isError) {
        group.successCount++;
      }

      // Accumulate cost from response payload
      const cost = responsePayload?.costUsd ?? 0;
      group.totalCost += cost;

      // Accumulate tokens
      const inputTokens = responsePayload?.usage?.inputTokens ?? 0;
      const outputTokens = responsePayload?.usage?.outputTokens ?? 0;
      group.totalInputTokens += inputTokens;
      group.totalOutputTokens += outputTokens;
    }

    // 4. For each group, look for cheaper alternatives
    const recommendations: CostRecommendation[] = [];

    for (const [, group] of groups) {
      // Never recommend downgrading expert tier
      if (group.tier === 'expert') continue;

      // Require minimum call volume for the current model
      if (group.callCount < MIN_CALL_VOLUME) continue;

      const currentCostPerCall = group.callCount > 0 ? group.totalCost / group.callCount : 0;
      const currentSuccessRate = group.callCount > 0 ? group.successCount / group.callCount : 0;

      // Get effective cost rate for this model
      const currentModelCost = this.getModelCostRate(group);
      if (currentModelCost === null) continue;

      // Get allowed downgrade targets for this model
      const allowedTargets = DOWNGRADE_PATHS[group.model];
      if (!allowedTargets || allowedTargets.length === 0) continue;

      // Find cheaper alternatives that have data at this tier
      for (const [, candidateGroup] of groups) {
        if (candidateGroup.model === group.model) continue;
        if (candidateGroup.tier !== group.tier) continue;

        // Only recommend within allowed downgrade paths
        if (!allowedTargets.includes(candidateGroup.model)) continue;

        // Require minimum call volume for the candidate at this tier
        if (candidateGroup.callCount < MIN_CALL_VOLUME) continue;

        const candidateCostRate = this.getModelCostRate(candidateGroup);
        if (candidateCostRate === null) continue;

        // Must be cheaper
        if (candidateCostRate >= currentModelCost) continue;

        // Must have ≥98% success rate
        const candidateSuccessRate =
          candidateGroup.callCount > 0
            ? candidateGroup.successCount / candidateGroup.callCount
            : 0;
        if (candidateSuccessRate < 0.98) continue;

        const recommendedCostPerCall =
          candidateGroup.callCount > 0
            ? candidateGroup.totalCost / candidateGroup.callCount
            : 0;

        // Don't extrapolate wildly for short periods
        let monthlySavings: number;
        let confidence: ConfidenceLevel;
        const savingsPerPeriod = (currentCostPerCall - recommendedCostPerCall) * group.callCount;

        if (period < 7) {
          // Short period: don't extrapolate, use actual savings, lower confidence
          monthlySavings = savingsPerPeriod;
          confidence = 'low';
        } else {
          monthlySavings = savingsPerPeriod * (30 / period);
          confidence = this.determineConfidence(group.callCount);
        }

        if (monthlySavings <= 0) continue;

        // Pick a representative agentId (first in set)
        const agentId = group.agentIds.values().next().value ?? '';

        recommendations.push({
          currentModel: group.model,
          recommendedModel: candidateGroup.model,
          complexityTier: group.tier,
          currentCostPerCall: roundCost(currentCostPerCall),
          recommendedCostPerCall: roundCost(recommendedCostPerCall),
          monthlySavings: roundCost(monthlySavings),
          callVolume: group.callCount,
          currentSuccessRate: roundRate(currentSuccessRate),
          recommendedSuccessRate: roundRate(candidateSuccessRate),
          confidence,
          agentId,
        });
      }
    }

    // 5. Sort by monthlySavings DESC, take top N
    recommendations.sort((a, b) => b.monthlySavings - a.monthlySavings);
    const limited = recommendations.slice(0, limit);

    const totalPotentialSavings = limited.reduce((sum, r) => sum + r.monthlySavings, 0);

    return {
      recommendations: limited,
      totalPotentialSavings: roundCost(totalPotentialSavings),
      period,
      analyzedCalls: callEvents.length,
    };
  }

  /**
   * Get the weighted cost rate for a model (per 1M tokens).
   * Uses known model costs table, or falls back to actual cost data from events.
   */
  private getModelCostRate(group: ModelTierGroup): number | null {
    const knownCost = lookupModelCost(group.model, this.modelCosts);
    if (knownCost) {
      // Weighted average using actual input/output ratio when available
      const totalTokens = group.totalInputTokens + group.totalOutputTokens;
      let inputWeight = 0.75; // default fallback ~3:1 input:output
      let outputWeight = 0.25;
      if (totalTokens > 0) {
        inputWeight = group.totalInputTokens / totalTokens;
        outputWeight = group.totalOutputTokens / totalTokens;
      }
      return knownCost.input * inputWeight + knownCost.output * outputWeight;
    }

    // Fall back to actual cost from event data
    const totalTokens = group.totalInputTokens + group.totalOutputTokens;
    if (totalTokens > 0 && group.totalCost > 0) {
      // Effective cost per 1M tokens from actual data
      return (group.totalCost / totalTokens) * 1_000_000;
    }

    return null;
  }

  private determineConfidence(callVolume: number): ConfidenceLevel {
    if (callVolume > 200) return 'high';
    if (callVolume >= 50) return 'medium';
    return 'low';
  }
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundRate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
