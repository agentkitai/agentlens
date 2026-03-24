/**
 * Shared types for the AgentLens client — extracted from client.ts (cq-003)
 */

import type {
  AgentLensEvent,
  Session,
  LlmMessage,
  GuardrailRule,
  GuardrailState,
  GuardrailTriggerHistory,
} from '@agentlensai/core';

// ─── Config Types ───────────────────────────────────────────

export interface RetryConfig {
  /** Maximum number of retries (default: 3) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  backoffBaseMs?: number;
  /** Maximum delay in ms (default: 30000) */
  backoffMaxMs?: number;
}

export interface AgentLensClientOptions {
  /** Base URL of the AgentLens server (e.g. "http://localhost:3400") */
  url: string;
  /** API key for authentication */
  apiKey?: string;
  /** Custom fetch implementation (defaults to global fetch) */
  fetch?: typeof globalThis.fetch;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Retry configuration */
  retry?: RetryConfig;
  /** When true, all methods catch errors and return safe defaults instead of throwing */
  failOpen?: boolean;
  /** Called when an error is swallowed in fail-open mode (default: console.warn) */
  onError?: (error: Error) => void;
  /** Logger for internal warnings (default: console) */
  logger?: { warn: (msg: string) => void };
}

// ─── Result Types ───────────────────────────────────────────

export interface SessionQueryResult {
  sessions: Session[];
  total: number;
  hasMore: boolean;
}

export interface TimelineResult {
  events: AgentLensEvent[];
  chainValid: boolean;
}

export interface HealthResult {
  status: string;
  version: string;
}

export interface BrokenChainDetail {
  sessionId: string;
  failedAtIndex: number;
  failedEventId: string;
  reason: string;
}

export interface VerificationReport {
  verified: boolean;
  verifiedAt: string;
  range: { from: string; to: string } | null;
  sessionId?: string;
  sessionsVerified: number;
  totalEvents: number;
  firstHash: string | null;
  lastHash: string | null;
  brokenChains: BrokenChainDetail[];
  signature: string | null;
}

// ─── LLM Types ──────────────────────────────────────────────

export interface LogLlmCallParams {
  provider: string;
  model: string;
  messages: LlmMessage[];
  systemPrompt?: string;
  completion: string | null;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  finishReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    thinkingTokens?: number;
  };
  costUsd: number;
  latencyMs: number;
  parameters?: Record<string, unknown>;
  tools?: Array<{ name: string; description?: string; parameters?: Record<string, unknown> }>;
  /** If true, prompt/completion content is stripped (redacted) before sending */
  redact?: boolean;
}

export interface LlmAnalyticsParams {
  from?: string;
  to?: string;
  agentId?: string;
  model?: string;
  provider?: string;
  granularity?: 'hour' | 'day' | 'week';
}

export interface LlmAnalyticsSummary {
  totalCalls: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgLatencyMs: number;
  avgCostPerCall: number;
}

export interface LlmAnalyticsByModel {
  provider: string;
  model: string;
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  avgLatencyMs: number;
}

export interface LlmAnalyticsByTime {
  bucket: string;
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  avgLatencyMs: number;
}

export interface LlmAnalyticsResult {
  summary: LlmAnalyticsSummary;
  byModel: LlmAnalyticsByModel[];
  byTime: LlmAnalyticsByTime[];
}

// ─── Guardrail Types ────────────────────────────────────────

export interface GuardrailRuleListResult {
  rules: GuardrailRule[];
}

export interface GuardrailStatusResult {
  rule: GuardrailRule;
  state: GuardrailState | null;
  recentTriggers: GuardrailTriggerHistory[];
}

export interface GuardrailTriggerHistoryResult {
  triggers: GuardrailTriggerHistory[];
  total: number;
}

export interface CreateGuardrailRuleParams {
  name: string;
  description?: string;
  conditionType: string;
  conditionConfig: Record<string, unknown>;
  actionType: string;
  actionConfig: Record<string, unknown>;
  agentId?: string;
  enabled?: boolean;
  dryRun?: boolean;
  cooldownMinutes?: number;
}

export interface UpdateGuardrailRuleParams {
  name?: string;
  description?: string;
  conditionType?: string;
  conditionConfig?: Record<string, unknown>;
  actionType?: string;
  actionConfig?: Record<string, unknown>;
  agentId?: string | null;
  enabled?: boolean;
  dryRun?: boolean;
  cooldownMinutes?: number;
}
