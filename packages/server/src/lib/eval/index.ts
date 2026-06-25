/**
 * Eval Framework — public exports (Feature 15)
 */

export { ScorerRegistry, type IScorer, type ScorerContext } from './scorers/index.js';
export { ExactMatchScorer } from './scorers/exact-match.js';
export { ContainsScorer } from './scorers/contains.js';
export { RegexScorer } from './scorers/regex.js';
export {
  LlmJudgeScorer,
  judgeWithLlm,
  DEFAULT_JUDGE_MODEL,
  type JudgeProviderFactory,
  type JudgeArgs,
} from './scorers/llm-judge.js';
// Compliance scoring is exposed via POST /api/eval/sessions/:id/compliance (and the
// AgentGate gate→lens breach loop), which call evaluateCompliance() directly — it
// needs the session's events, which the dataset-run ScorerContext doesn't carry.
export { evaluateCompliance, matchTool, type ComplianceEvalResult } from './compliance.js';
export { buildBreachEvalResult, type GuardrailBreach } from './guardrail-breach.js';
export { buildAgentEvalResult } from './agenteval-run.js';
export { EvalRunner } from './runner.js';

import { ScorerRegistry } from './scorers/index.js';
import { ExactMatchScorer } from './scorers/exact-match.js';
import { ContainsScorer } from './scorers/contains.js';
import { RegexScorer } from './scorers/regex.js';
import { LlmJudgeScorer, type JudgeProviderFactory } from './scorers/llm-judge.js';
import { createLLMProvider } from '../diagnostics/llm-client.js';

/**
 * Build a judge provider factory from env, or null if no API key is configured.
 * Unlike diagnostics (which defaults to OpenAI), the judge defaults to Anthropic
 * because its default model is a Claude tier; an explicit AGENTLENS_LLM_PROVIDER
 * still wins.
 */
export function judgeProviderFromEnv(): JudgeProviderFactory | null {
  const apiKey = process.env['AGENTLENS_LLM_API_KEY'];
  if (!apiKey) return null;
  const provider = (process.env['AGENTLENS_LLM_PROVIDER'] as 'openai' | 'anthropic') ?? 'anthropic';
  const baseUrl = process.env['AGENTLENS_LLM_BASE_URL'] || undefined;
  return (model: string) => createLLMProvider({ provider, apiKey, model, baseUrl });
}

/**
 * Create a ScorerRegistry with all built-in scorers registered. The LLM judge is
 * always registered; when unconfigured it returns a clear "not configured" result
 * rather than throwing an opaque "unknown scorer type".
 */
export function createDefaultRegistry(): ScorerRegistry {
  const registry = new ScorerRegistry();
  registry.register(new ExactMatchScorer());
  registry.register(new ContainsScorer());
  registry.register(new RegexScorer());
  registry.register(new LlmJudgeScorer(judgeProviderFromEnv()));
  return registry;
}
