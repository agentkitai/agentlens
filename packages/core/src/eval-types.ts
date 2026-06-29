/**
 * Eval Framework Types (Feature 15 — Story 1)
 *
 * Shared types for the evaluation & quality testing framework.
 */

// ─── Dataset Types ─────────────────────────────────────────

export interface EvalDataset {
  id: string;
  tenantId: string;
  agentId?: string;
  name: string;
  description?: string;
  version: number;
  parentId?: string;
  immutable?: boolean;
  testCaseCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface EvalTestCase {
  id: string;
  datasetId: string;
  tenantId: string;
  input: EvalInput;
  expectedOutput?: unknown;
  tags: string[];
  metadata: Record<string, unknown>;
  scoringCriteria?: string;
  sortOrder: number;
  createdAt: string;
}

export interface EvalInput {
  prompt: string;
  context?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

// ─── Scorer Types ──────────────────────────────────────────

export type ScorerType = 'exact_match' | 'contains' | 'regex' | 'llm_judge' | 'compliance' | 'custom' | 'composite';

/**
 * A single deterministic compliance rule evaluated against a session's events.
 * Tool patterns support a trailing/leading `*` wildcard (e.g. `delete_*`).
 */
export type ComplianceRule =
  | { id: string; type: 'tool_denylist'; description?: string; tools: string[] }
  | { id: string; type: 'tool_allowlist'; description?: string; tools: string[] }
  | { id: string; type: 'max_cost'; description?: string; maxUsd: number }
  | { id: string; type: 'no_severity_above'; description?: string; severity: 'debug' | 'info' | 'warn' | 'error' | 'critical' };

export interface ComplianceViolation {
  ruleId: string;
  ruleType: ComplianceRule['type'];
  description?: string;
  detail: string;
}

export interface ScorerConfig {
  type: ScorerType;
  weight?: number;
  caseSensitive?: boolean;
  pattern?: string;
  rubric?: string;
  model?: string;
  webhookUrl?: string;
  scorers?: ScorerConfig[];
  /** Compliance scorer: policy rules to check the session's events against */
  rules?: ComplianceRule[];
}

export interface ScoreResult {
  score: number;
  passed: boolean;
  scorerType: ScorerType;
  reasoning?: string;
  subScores?: ScoreResult[];
  /** LLM-judge scorers: the judge model that produced this result. */
  model?: string;
  /** LLM-judge scorers: the judge's own token spend (USD), kept distinct from the
   *  agent-under-test's execution cost (which the runner reads from webhook metadata). */
  costUsd?: number;
  /** LLM-judge scorers: input+output tokens the judge consumed. */
  tokenCount?: number;
}

// ─── Run Types ─────────────────────────────────────────────

export type EvalRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface EvalRunConfig {
  scorers: ScorerConfig[];
  passThreshold: number;
  concurrency: number;
  rateLimitPerSec?: number;
  timeoutMs?: number;
  retries?: number;
  baselineRunId?: string;
}

export interface EvalRun {
  id: string;
  tenantId: string;
  datasetId: string;
  datasetVersion: number;
  agentId: string;
  webhookUrl: string;
  status: EvalRunStatus;
  config: EvalRunConfig;
  baselineRunId?: string;
  /** Prompt version under test (#121) — binds the run to a registry version. */
  promptVersionId?: string;
  /** Model variant under test (#121). */
  modelId?: string;
  /** Verified actor / triggering identity that started the run (#121). */
  triggeredBy?: string;
  /** How `triggeredBy` was identified (e.g. agentgate_token, api_key). */
  triggeredByMethod?: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  avgScore?: number;
  totalCostUsd?: number;
  totalDurationMs?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface EvalResult {
  id: string;
  runId: string;
  testCaseId: string;
  tenantId: string;
  sessionId?: string;
  actualOutput?: unknown;
  score: number;
  passed: boolean;
  scorerType: ScorerType;
  scorerDetails: ScoreResult;
  latencyMs?: number;
  costUsd?: number;
  tokenCount?: number;
  error?: string;
  createdAt: string;
}

// ─── Regression Types ──────────────────────────────────────

export interface RegressionReport {
  currentRunId: string;
  baselineRunId: string;
  passRateDelta: number;
  avgScoreDelta: number;
  passRateSignificant: boolean;
  avgScoreSignificant: boolean;
  flippedCases: FlippedCase[];
  overallRegression: boolean;
  /**
   * The two runs were over different dataset versions — deltas/flips may be
   * misleading. Flagged, not silently wrong (#121).
   */
  datasetVersionMismatch: boolean;
}

export interface FlippedCase {
  testCaseId: string;
  direction: 'pass_to_fail' | 'fail_to_pass';
  baselineScore: number;
  currentScore: number;
}

// ─── Webhook Contract ──────────────────────────────────────

export interface EvalWebhookRequest {
  evalRunId: string;
  testCaseId: string;
  input: EvalInput;
  /**
   * The prompt/model variant under test (#121), so the webhook can run the exact
   * variant. `promptContent` is resolved server-side from `promptVersionId`.
   */
  variant?: {
    promptVersionId?: string;
    promptContent?: string;
    model?: string;
  };
}

export interface EvalWebhookResponse {
  output: unknown;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

// ─── Evaluator Catalog (#55 Phase 4) ───────────────────────

export type EvaluatorStatus = 'draft' | 'published';

/**
 * A reusable, named scorer definition in the evaluator catalog. Bundles a scorer
 * config template (rules for `compliance`, rubric+model for `llm_judge`, pattern
 * for `regex`, …) with discovery metadata, so it can be browsed and instantiated
 * into eval runs / session scoring by id instead of re-specifying the config.
 */
export interface EvaluatorDefinition {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  scorerType: ScorerType;
  /** The reusable scorer config this evaluator instantiates. */
  configTemplate: ScorerConfig;
  tags: string[];
  /** Seeded, read-only built-in evaluator (cannot be edited/deleted via the API). */
  builtin: boolean;
  /** `draft` evaluators are private WIP; `published` ones surface in the catalog. */
  status: EvaluatorStatus;
  publishedBy?: string;
  publishedAt?: string;
  /** Set when a curator marks the evaluator trustworthy (a verified-badge signal). */
  verifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}
