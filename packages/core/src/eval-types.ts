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

export type ScorerType = 'exact_match' | 'contains' | 'regex' | 'llm_judge' | 'custom' | 'composite';

export interface ScorerConfig {
  type: ScorerType;
  weight?: number;
  caseSensitive?: boolean;
  pattern?: string;
  rubric?: string;
  model?: string;
  webhookUrl?: string;
  scorers?: ScorerConfig[];
}

export interface ScoreResult {
  score: number;
  passed: boolean;
  scorerType: ScorerType;
  reasoning?: string;
  subScores?: ScoreResult[];
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
}

export interface EvalWebhookResponse {
  output: unknown;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}
