/**
 * Scorer Interface & Registry (Feature 15 — Story 4)
 */

import type { EvalTestCase, ScorerConfig, ScorerType, ScoreResult } from '@agentlensai/core';

export interface ScorerContext {
  testCase: EvalTestCase;
  actualOutput: unknown;
  config: ScorerConfig;
}

export interface IScorer {
  readonly type: ScorerType;
  score(ctx: ScorerContext): Promise<ScoreResult>;
}

export class ScorerRegistry {
  private scorers = new Map<ScorerType, IScorer>();

  register(scorer: IScorer): void {
    this.scorers.set(scorer.type, scorer);
  }

  async score(ctx: ScorerContext): Promise<ScoreResult> {
    const scorer = this.scorers.get(ctx.config.type);
    if (!scorer) throw new Error(`Unknown scorer type: ${ctx.config.type}`);
    return scorer.score(ctx);
  }

  has(type: ScorerType): boolean {
    return this.scorers.has(type);
  }
}
