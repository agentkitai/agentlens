/**
 * Eval Framework — public exports (Feature 15)
 */

export { ScorerRegistry, type IScorer, type ScorerContext } from './scorers/index.js';
export { ExactMatchScorer } from './scorers/exact-match.js';
export { ContainsScorer } from './scorers/contains.js';
export { RegexScorer } from './scorers/regex.js';
export { LlmJudgeScorer, type LlmClient } from './scorers/llm-judge.js';
export { EvalRunner } from './runner.js';

import { ScorerRegistry } from './scorers/index.js';
import { ExactMatchScorer } from './scorers/exact-match.js';
import { ContainsScorer } from './scorers/contains.js';
import { RegexScorer } from './scorers/regex.js';

/**
 * Create a ScorerRegistry with all built-in deterministic scorers registered.
 */
export function createDefaultRegistry(): ScorerRegistry {
  const registry = new ScorerRegistry();
  registry.register(new ExactMatchScorer());
  registry.register(new ContainsScorer());
  registry.register(new RegexScorer());
  return registry;
}
