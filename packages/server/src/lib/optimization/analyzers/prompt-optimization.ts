/**
 * PromptOptimizationAnalyzer (Feature 17 — Story 17.3)
 *
 * Detects cost-saving opportunities in prompt construction:
 * 1. System prompts exceeding 4,000 tokens (string length ÷ 4 estimation)
 * 2. Repeated context patterns within sessions (>30% shared prefix)
 */

import type {
  ModelCosts,
  EnhancedRecommendation,
  LlmCallPayload,
  LlmResponsePayload,
  ConfidenceLevel,
  AgentLensEvent,
} from '@agentlensai/core';
import { DEFAULT_MODEL_COSTS, lookupModelCost } from '@agentlensai/core';
import type { Analyzer, AnalyzerContext } from './types.js';
import { createHash } from 'node:crypto';

const SYSTEM_PROMPT_TOKEN_THRESHOLD = 4000;
const REPEATED_CONTEXT_RATIO = 0.3;

export class PromptOptimizationAnalyzer implements Analyzer {
  readonly name = 'prompt_optimization';

  constructor(private readonly modelCosts: ModelCosts = DEFAULT_MODEL_COSTS) {}

  async analyze(ctx: AnalyzerContext): Promise<EnhancedRecommendation[]> {
    const recommendations: EnhancedRecommendation[] = [];
    const now = new Date().toISOString();

    // Group calls by (agentId, model)
    const groupMap = new Map<string, {
      agentId: string;
      model: string;
      systemTokenCounts: number[];
      sessionIds: Set<string>;
      callCount: number;
    }>();

    // Session-level grouping for repeated context detection
    const sessionCalls = new Map<string, {
      agentId: string;
      model: string;
      prefixHashes: string[];
    }>();

    for (const evt of ctx.llmCallEvents) {
      const payload = evt.payload as Partial<LlmCallPayload>;
      const model = payload.model;
      if (!model || !payload.messages) continue;

      const agentId = evt.agentId;
      const groupKey = `${agentId}::${model}`;

      // System prompt analysis
      let group = groupMap.get(groupKey);
      if (!group) {
        group = { agentId, model, systemTokenCounts: [], sessionIds: new Set(), callCount: 0 };
        groupMap.set(groupKey, group);
      }
      group.callCount++;
      if (evt.sessionId) group.sessionIds.add(evt.sessionId);

      const systemMsgs = payload.messages.filter(m => m.role === 'system');
      if (systemMsgs.length > 0) {
        const totalLen = systemMsgs.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
        const estimatedTokens = Math.ceil(totalLen / 4);
        group.systemTokenCounts.push(estimatedTokens);
      }

      // Repeated context: hash first non-system message content as prefix
      if (evt.sessionId) {
        const sessionKey = `${evt.sessionId}::${model}`;
        let sc = sessionCalls.get(sessionKey);
        if (!sc) {
          sc = { agentId, model, prefixHashes: [] };
          sessionCalls.set(sessionKey, sc);
        }
        const nonSystem = payload.messages.filter(m => m.role !== 'system');
        if (nonSystem.length > 0) {
          const prefix = nonSystem.map(m => m.content ?? '').join('|').slice(0, 500);
          const hash = createHash('md5').update(prefix).digest('hex');
          sc.prefixHashes.push(hash);
        }
      }
    }

    // Detect large system prompts
    for (const [, group] of groupMap) {
      if (group.systemTokenCounts.length === 0) continue;
      const sorted = [...group.systemTokenCounts].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];

      if (median > SYSTEM_PROMPT_TOKEN_THRESHOLD) {
        const reducible = Math.floor((median - SYSTEM_PROMPT_TOKEN_THRESHOLD) * 0.5);
        const modelCost = lookupModelCost(group.model, this.modelCosts);
        const inputCostPer1M = modelCost?.input ?? 3;
        const savings = (reducible / 1_000_000) * inputCostPer1M * group.callCount * (30 / ctx.period);

        if (savings <= 0) continue;

        const id = createHash('sha256')
          .update(`prompt_optimization:system_prompt_size:${group.agentId}:${group.model}`)
          .digest('hex')
          .slice(0, 16);

        const sessionArr = Array.from(group.sessionIds);
        recommendations.push({
          id,
          category: 'prompt_optimization',
          estimatedMonthlySavings: Math.round(savings * 1_000_000) / 1_000_000,
          confidence: this.determineConfidence(group.callCount),
          difficulty: 'code_change',
          actionableSteps: [
            `Reduce system prompt for ${group.model} — median is ~${median} tokens, ${SYSTEM_PROMPT_TOKEN_THRESHOLD} recommended`,
            'Consider extracting static instructions into a reference doc or using prompt compression',
          ],
          agentId: group.agentId,
          evidence: { callsAnalyzed: group.callCount, period: ctx.period },
          createdAt: now,
          promptOptimization: {
            targetType: 'system_prompt_size',
            currentTokens: median,
            estimatedReducibleTokens: reducible,
            sampleSessionIds: sessionArr.slice(0, 3),
          },
        });
      }
    }

    // Detect repeated context within sessions
    for (const [sessionKey, sc] of sessionCalls) {
      if (sc.prefixHashes.length < 3) continue;

      // Count most frequent prefix hash
      const freq = new Map<string, number>();
      for (const h of sc.prefixHashes) {
        freq.set(h, (freq.get(h) ?? 0) + 1);
      }
      const maxFreq = Math.max(...freq.values());
      const ratio = maxFreq / sc.prefixHashes.length;

      if (ratio > REPEATED_CONTEXT_RATIO && maxFreq >= 3) {
        // Estimate token savings: average message length of repeated prefix
        const estimatedTokensSaved = 500; // conservative estimate per repeated call
        const modelCost = lookupModelCost(sc.model, this.modelCosts);
        const inputCostPer1M = modelCost?.input ?? 3;
        const redundantCalls = maxFreq - 1;
        const savings = (estimatedTokensSaved / 1_000_000) * inputCostPer1M * redundantCalls * (30 / ctx.period);

        if (savings <= 0) continue;

        const sessionId = sessionKey.split('::')[0];
        const id = createHash('sha256')
          .update(`prompt_optimization:repeated_context:${sc.agentId}:${sessionId}`)
          .digest('hex')
          .slice(0, 16);

        recommendations.push({
          id,
          category: 'prompt_optimization',
          estimatedMonthlySavings: Math.round(savings * 1_000_000) / 1_000_000,
          confidence: this.determineConfidence(sc.prefixHashes.length),
          difficulty: 'code_change',
          actionableSteps: [
            `Session has ${maxFreq} calls with repeated context prefix — consider caching or summarizing context`,
            'Use conversation summarization to reduce context window growth',
          ],
          agentId: sc.agentId,
          evidence: { callsAnalyzed: sc.prefixHashes.length, period: ctx.period },
          createdAt: now,
          promptOptimization: {
            targetType: 'repeated_context',
            currentTokens: estimatedTokensSaved * maxFreq,
            estimatedReducibleTokens: estimatedTokensSaved * redundantCalls,
            sampleSessionIds: [sessionId],
          },
        });
      }
    }

    return recommendations;
  }

  private determineConfidence(callCount: number): ConfidenceLevel {
    if (callCount >= 50) return 'high';
    if (callCount >= 20) return 'medium';
    return 'low';
  }
}
