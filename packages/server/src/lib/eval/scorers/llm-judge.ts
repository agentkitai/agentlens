/**
 * LLM Judge Scorer (Feature 15 — Story 5)
 *
 * Constructs a grading prompt, calls a configured LLM, and parses score + reasoning.
 */

import type { ScoreResult } from '@agentlensai/core';
import type { IScorer, ScorerContext } from './index.js';

export interface LlmClient {
  chat(model: string, messages: Array<{ role: string; content: string }>, options?: { responseFormat?: 'json' }): Promise<string>;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export class LlmJudgeScorer implements IScorer {
  readonly type = 'llm_judge' as const;

  constructor(private readonly llmClient: LlmClient) {}

  async score(ctx: ScorerContext): Promise<ScoreResult> {
    const { testCase, actualOutput, config } = ctx;

    const criteria = testCase.scoringCriteria ?? config.rubric ?? 'Accuracy, completeness, and relevance';
    const model = config.model ?? 'gpt-4o-mini';

    const prompt = `You are evaluating an AI agent's response. Score from 0.0 to 1.0.

## Input
${testCase.input.prompt}

## Expected Output (reference)
${testCase.expectedOutput !== undefined && testCase.expectedOutput !== null ? stringify(testCase.expectedOutput) : 'No reference provided'}

## Evaluation Criteria
${criteria}

## Actual Output
${stringify(actualOutput)}

Respond in JSON: {"score": <0.0-1.0>, "reasoning": "<explanation>"}`;

    let response: string;
    try {
      response = await this.llmClient.chat(model, [{ role: 'user', content: prompt }], { responseFormat: 'json' });
    } catch (err) {
      // Retry once
      try {
        response = await this.llmClient.chat(model, [{ role: 'user', content: prompt }], { responseFormat: 'json' });
      } catch (retryErr) {
        return {
          score: 0,
          passed: false,
          scorerType: this.type,
          reasoning: `LLM API error: ${(retryErr as Error).message}`,
        };
      }
    }

    // Parse response
    try {
      const parsed = JSON.parse(response);
      const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(1, parsed.score)) : 0.5;
      const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : 'No reasoning provided';

      return {
        score,
        passed: score >= 0.7,
        scorerType: this.type,
        reasoning,
      };
    } catch {
      // Parse failure — return 0.5 per architecture §8
      return {
        score: 0.5,
        passed: false,
        scorerType: this.type,
        reasoning: 'Parse error: Could not parse LLM judge response',
      };
    }
  }
}
