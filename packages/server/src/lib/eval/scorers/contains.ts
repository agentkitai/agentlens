/**
 * Contains Scorer (Feature 15 — Story 4)
 */

import type { ScoreResult } from '@agentlensai/core';
import type { IScorer, ScorerContext } from './index.js';

export class ContainsScorer implements IScorer {
  readonly type = 'contains' as const;

  async score(ctx: ScorerContext): Promise<ScoreResult> {
    const { testCase, actualOutput, config } = ctx;

    if (testCase.expectedOutput === undefined || testCase.expectedOutput === null) {
      return { score: 0, passed: false, scorerType: this.type, reasoning: 'No expected output provided' };
    }

    const caseSensitive = config.caseSensitive !== false;
    const expected = stringify(testCase.expectedOutput);
    const actual = stringify(actualOutput);

    const contains = caseSensitive
      ? actual.includes(expected)
      : actual.toLowerCase().includes(expected.toLowerCase());

    const score = contains ? 1.0 : 0.0;
    return {
      score,
      passed: contains,
      scorerType: this.type,
      reasoning: contains ? `Output contains "${expected}"` : `Output does not contain "${expected}"`,
    };
  }
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
