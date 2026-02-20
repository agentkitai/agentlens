/**
 * Exact Match Scorer (Feature 15 — Story 4)
 */

import type { ScoreResult } from '@agentlensai/core';
import type { IScorer, ScorerContext } from './index.js';

export class ExactMatchScorer implements IScorer {
  readonly type = 'exact_match' as const;

  async score(ctx: ScorerContext): Promise<ScoreResult> {
    const { testCase, actualOutput, config } = ctx;

    if (testCase.expectedOutput === undefined || testCase.expectedOutput === null) {
      return { score: 0, passed: false, scorerType: this.type, reasoning: 'No expected output provided' };
    }

    const caseSensitive = config.caseSensitive !== false;
    const expected = stringify(testCase.expectedOutput);
    const actual = stringify(actualOutput);

    const match = caseSensitive
      ? actual === expected
      : actual.toLowerCase() === expected.toLowerCase();

    const score = match ? 1.0 : 0.0;
    return {
      score,
      passed: match,
      scorerType: this.type,
      reasoning: match ? 'Exact match' : `Expected "${expected}", got "${actual}"`,
    };
  }
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
