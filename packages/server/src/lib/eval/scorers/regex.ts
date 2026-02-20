/**
 * Regex Scorer (Feature 15 — Story 4)
 */

import type { ScoreResult } from '@agentlensai/core';
import type { IScorer, ScorerContext } from './index.js';

export class RegexScorer implements IScorer {
  readonly type = 'regex' as const;

  async score(ctx: ScorerContext): Promise<ScoreResult> {
    const { actualOutput, config } = ctx;

    if (!config.pattern) {
      throw new Error('RegexScorer requires a "pattern" in config');
    }

    let regex: RegExp;
    try {
      regex = new RegExp(config.pattern, config.caseSensitive === false ? 'i' : undefined);
    } catch (e) {
      throw new Error(`Invalid regex pattern "${config.pattern}": ${(e as Error).message}`);
    }

    const actual = stringify(actualOutput);
    const matches = regex.test(actual);
    const score = matches ? 1.0 : 0.0;

    return {
      score,
      passed: matches,
      scorerType: this.type,
      reasoning: matches ? `Output matches pattern /${config.pattern}/` : `Output does not match pattern /${config.pattern}/`,
    };
  }
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
