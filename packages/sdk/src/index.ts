/**
 * @agentkitai/agentlens-sdk — Programmatic client for the AgentLens API
 */

// Client
export { AgentLensClient } from './client.js';
export type {
  RetryConfig,
  AgentLensClientOptions,
  SessionQueryResult,
  TimelineResult,
  HealthResult,
  LogLlmCallParams,
  LlmAnalyticsParams,
  LlmAnalyticsResult,
  LlmAnalyticsSummary,
  LlmAnalyticsByModel,
  LlmAnalyticsByTime,
  GuardrailRuleListResult,
  GuardrailStatusResult,
  GuardrailTriggerHistoryResult,
  CreateGuardrailRuleParams,
  UpdateGuardrailRuleParams,
  VerificationReport,
  BrokenChainDetail,
} from './client.js';

// Batch Sender
export { BatchSender } from './batch-sender.js';
export type { BatchSenderOptions } from './batch-sender.js';

// Drop-in instrumentation (#123): init() + provider wrappers in ./openai, ./vercel
export { init, shutdown, getInstrumentation, Instrumentation } from './instrumentation.js';
export type { InitConfig, LlmCapture } from './instrumentation.js';

// Prompt runtime primitives (#145): compile {{variables}} + config client-side
export { compilePrompt, compileText, compileChat, extractVariables } from '@agentkitai/agentlens-core';
export type { PromptType, PromptConfig, ChatMessage, CompiledPrompt, CompilablePrompt, VariableValues } from '@agentkitai/agentlens-core';

// Errors
export {
  AgentLensError,
  AuthenticationError,
  NotFoundError,
  ValidationError,
  ConnectionError,
  RateLimitError,
  QuotaExceededError,
  BackpressureError,
} from './errors.js';

// Re-export core types consumers will need
export type {
  AgentLensEvent,
  EventQuery,
  EventQueryResult,
  EventType,
  EventSeverity,
  Session,
  SessionQuery,
  SessionStatus,
  Agent,
  LlmMessage,
  LlmCallPayload,
  LlmResponsePayload,
  RecallQuery,
  RecallResult,
  ReflectQuery,
  ReflectResult,
  ReflectAnalysis,
  ReflectInsight,
  ContextQuery,
  ContextResult,
  ContextSession,
  ContextKeyEvent,
  ContextLesson,
  HealthScore,
  HealthSnapshot,
  HealthDimension,
  HealthTrend,
  OptimizationResult,
  CostRecommendation,
  GuardrailRule,
  GuardrailConditionType,
  GuardrailActionType,
  GuardrailState,
  GuardrailTriggerHistory,
  GuardrailConditionResult,
} from '@agentkitai/agentlens-core';
