/**
 * LLM Judge Scorer (Feature 15 — Story 5; #55 Phase 2)
 *
 * Builds a grading prompt, calls a real Claude (or other) model via the shared
 * diagnostics LLMProvider, parses score + reasoning, and captures the judge's own
 * token spend. The model is non-deterministic, so its result is a *judgment*, not
 * a proof — callers label the chained eval_result as method:'llm_judge'.
 */

import { costUsd, lookupModelCost } from '@agentkitai/agentlens-core';
import type { ScoreResult } from '@agentkitai/agentlens-core';
import type { LLMProvider } from '../../diagnostics/providers/types.js';
import type { IScorer, ScorerContext } from './index.js';

/** Cheap-but-capable default; rubric grading is a bounded classification task. */
export const DEFAULT_JUDGE_MODEL = 'claude-haiku-4-5';
const PASS_THRESHOLD = 0.7;

/**
 * Builds a provider bound to a specific model. The diagnostics LLMProvider fixes
 * its model at construction, so per-call model overrides require a factory.
 */
export type JudgeProviderFactory = (model: string) => LLMProvider;

function stringify(value: unknown): string {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'string') return value;
  // Never throw: JSON.stringify can throw on circular refs and returns undefined
  // for functions/undefined. judgeWithLlm's contract is "always resolves".
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return '[unserializable]';
  }
}

export const JUDGE_SCHEMA = {
  type: 'object',
  // Required by OpenAI strict Structured Outputs — without it the API 400s and the
  // judge silently degrades to a 0 score (same class as the diagnostics schema fix).
  additionalProperties: false,
  properties: {
    score: { type: 'number', description: 'Quality score from 0.0 to 1.0' },
    reasoning: { type: 'string', description: 'Brief explanation of the score' },
  },
  required: ['score', 'reasoning'],
} as const;

export interface JudgeArgs {
  /** null when no LLM is configured — score() then returns a clear error result. */
  makeProvider: JudgeProviderFactory | null;
  model?: string;
  rubric: string;
  inputPrompt: string;
  expectedOutput?: unknown;
  actualOutput: unknown;
}

/**
 * Core judging logic, shared by the dataset scorer and the online session-scoring
 * endpoint. Always resolves to a ScoreResult (never throws); transport/parse
 * failures degrade to a low score with the failure reason.
 */
export async function judgeWithLlm(args: JudgeArgs): Promise<ScoreResult> {
  if (!args.makeProvider) {
    return {
      score: 0,
      passed: false,
      scorerType: 'llm_judge',
      reasoning: 'LLM judge not configured: set AGENTLENS_LLM_API_KEY (and AGENTLENS_LLM_PROVIDER=anthropic).',
    };
  }

  const model = args.model ?? DEFAULT_JUDGE_MODEL;
  const provider = args.makeProvider(model);

  const userPrompt = `You are grading an AI agent's behaviour. Score from 0.0 (fails the rubric) to 1.0 (fully satisfies it).

## Input
${args.inputPrompt}

## Expected (reference)
${args.expectedOutput !== undefined && args.expectedOutput !== null ? stringify(args.expectedOutput) : 'No reference provided'}

## Rubric
${args.rubric}

## Actual Output
${stringify(args.actualOutput)}`;

  let resp;
  try {
    resp = await provider.complete({
      systemPrompt: 'You are a strict, consistent evaluator. Return only the structured score and reasoning.',
      userPrompt,
      jsonSchema: JUDGE_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0,
    });
  } catch {
    // Retry once — transient API/network errors.
    try {
      resp = await provider.complete({
        systemPrompt: 'You are a strict, consistent evaluator. Return only the structured score and reasoning.',
        userPrompt,
        jsonSchema: JUDGE_SCHEMA as unknown as Record<string, unknown>,
        temperature: 0,
      });
    } catch (retryErr) {
      // No usage to record — keep the result shape consistent (zeroed cost).
      return {
        score: 0,
        passed: false,
        scorerType: 'llm_judge',
        reasoning: `LLM API error: ${(retryErr as Error).message}`,
        model,
        costUsd: 0,
        tokenCount: 0,
      };
    }
  }

  const tokenCount = resp.inputTokens + resp.outputTokens;
  const cost = costUsd(resp.model, resp.inputTokens, resp.outputTokens);
  // Cost honesty: an unpriced model records $0 (costUsd never throws). Surface it
  // so the audit/cost trail isn't silently understated.
  if (lookupModelCost(resp.model) === undefined) {
    console.warn(`[eval] judge model "${resp.model}" is not in the pricing table; costUsd recorded as 0`);
  }

  try {
    const parsed = JSON.parse(resp.content);
    const scoreIsNumber = typeof parsed.score === 'number';
    const score = scoreIsNumber ? Math.max(0, Math.min(1, parsed.score)) : 0.5;
    let reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : 'No reasoning provided';
    if (!scoreIsNumber) {
      reasoning = `Judge returned a non-numeric score; defaulted to 0.5. ${reasoning}`;
    }
    return {
      score,
      passed: score >= PASS_THRESHOLD,
      scorerType: 'llm_judge',
      reasoning,
      model: resp.model,
      costUsd: cost,
      tokenCount,
    };
  } catch {
    // Parse failure — record the cost (we paid for the call) and a neutral score.
    return {
      score: 0.5,
      passed: false,
      scorerType: 'llm_judge',
      reasoning: 'Parse error: could not parse LLM judge response',
      model: resp.model,
      costUsd: cost,
      tokenCount,
    };
  }
}

export class LlmJudgeScorer implements IScorer {
  readonly type = 'llm_judge' as const;

  constructor(private readonly makeProvider: JudgeProviderFactory | null) {}

  async score(ctx: ScorerContext): Promise<ScoreResult> {
    const { testCase, actualOutput, config } = ctx;
    return judgeWithLlm({
      makeProvider: this.makeProvider,
      model: config.model,
      rubric: testCase.scoringCriteria ?? config.rubric ?? 'Accuracy, completeness, and relevance',
      inputPrompt: testCase.input.prompt,
      expectedOutput: testCase.expectedOutput,
      actualOutput,
    });
  }
}
