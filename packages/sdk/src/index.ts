/**
 * @agentlensai/sdk — Programmatic client for the AgentLens API
 */

// Client
export { AgentLensClient } from './client.js';
export type {
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
} from './client.js';

// Errors
export {
  AgentLensError,
  AuthenticationError,
  NotFoundError,
  ValidationError,
  ConnectionError,
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
  /** @deprecated Use lore-sdk. See https://github.com/amitpaz1/lore */
  Lesson,
  /** @deprecated Use lore-sdk. See https://github.com/amitpaz1/lore */
  LessonQuery,
  /** @deprecated Use lore-sdk. See https://github.com/amitpaz1/lore */
  LessonImportance,
  /** @deprecated Use lore-sdk. See https://github.com/amitpaz1/lore */
  CreateLessonInput,
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
} from '@agentlensai/core';
