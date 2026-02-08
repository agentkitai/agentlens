/**
 * @agentlensai/core — Typed Guardrail Condition & Action Config Schemas (B1 — Story 1.1)
 *
 * Typed interfaces + Zod schemas for each guardrail condition and action type.
 * These replace the generic `Record<string,unknown>` conditionConfig/actionConfig
 * with strongly-typed, validated config objects.
 */
import { z } from 'zod';

// ─── Condition Configs ──────────────────────────────────────────────

/**
 * Config for `error_rate_threshold` condition.
 * Triggers when the error rate exceeds a percentage threshold within a time window.
 */
export const ErrorRateConditionConfigSchema = z.object({
  /** Error rate threshold percentage (0-100) */
  threshold: z.number().min(0).max(100),
  /** Time window in minutes (1-1440, default 5) */
  windowMinutes: z.number().int().min(1).max(1440).default(5),
});
export type ErrorRateConditionConfig = z.infer<typeof ErrorRateConditionConfigSchema>;

/**
 * Config for `cost_limit` condition.
 * Triggers when cumulative cost exceeds a USD threshold.
 */
export const CostLimitConditionConfigSchema = z.object({
  /** Maximum cost in USD (must be positive) */
  maxCostUsd: z.number().positive(),
  /** Scope: per-session or daily aggregate */
  scope: z.enum(['session', 'daily']),
});
export type CostLimitConditionConfig = z.infer<typeof CostLimitConditionConfigSchema>;

/**
 * Config for `health_score_threshold` condition.
 * Triggers when an agent's health score drops below a minimum.
 */
export const HealthScoreConditionConfigSchema = z.object({
  /** Minimum acceptable health score (0-100) */
  minScore: z.number().min(0).max(100),
  /** Number of days for the health score window (1-90, default 7) */
  windowDays: z.number().int().min(1).max(90).default(7),
});
export type HealthScoreConditionConfig = z.infer<typeof HealthScoreConditionConfigSchema>;

/**
 * Config for `custom_metric` condition.
 * Triggers when a custom metric matches a comparison operator against a threshold.
 */
export const CustomMetricConditionConfigSchema = z.object({
  /** Dot-delimited key path to the metric in event payload */
  metricKeyPath: z.string().min(1),
  /** Comparison operator */
  operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']),
  /** Numeric threshold value to compare against */
  value: z.number(),
  /** Time window in minutes (1-1440, default 5) */
  windowMinutes: z.number().int().min(1).max(1440).default(5),
});
export type CustomMetricConditionConfig = z.infer<typeof CustomMetricConditionConfigSchema>;

/**
 * Discriminated union of all condition config types.
 */
export type GuardrailConditionConfig =
  | ErrorRateConditionConfig
  | CostLimitConditionConfig
  | HealthScoreConditionConfig
  | CustomMetricConditionConfig;

/**
 * Map from condition type to its Zod schema — for runtime validation.
 */
export const conditionConfigSchemas: Record<string, z.ZodTypeAny> = {
  error_rate_threshold: ErrorRateConditionConfigSchema,
  cost_limit: CostLimitConditionConfigSchema,
  health_score_threshold: HealthScoreConditionConfigSchema,
  custom_metric: CustomMetricConditionConfigSchema,
};

// ─── Action Configs ─────────────────────────────────────────────────

/**
 * Config for `pause_agent` action.
 * Pauses the agent, optionally with a human-readable message.
 */
export const PauseAgentActionConfigSchema = z.object({
  /** Optional message explaining why the agent was paused */
  message: z.string().optional(),
});
export type PauseAgentActionConfig = z.infer<typeof PauseAgentActionConfigSchema>;

/**
 * Config for `notify_webhook` action.
 * Sends a POST request to a webhook URL with trigger details.
 */
export const WebhookActionConfigSchema = z.object({
  /** Webhook URL to POST to */
  url: z.string().url(),
  /** Optional custom HTTP headers */
  headers: z.record(z.string()).optional(),
  /** Optional HMAC secret for signing the payload */
  secret: z.string().optional(),
});
export type WebhookActionConfig = z.infer<typeof WebhookActionConfigSchema>;

/**
 * Config for `downgrade_model` action.
 * Switches the agent to a cheaper/safer model.
 */
export const DowngradeModelActionConfigSchema = z.object({
  /** Target model identifier to switch to */
  targetModel: z.string().min(1),
  /** Optional message explaining the downgrade */
  message: z.string().optional(),
});
export type DowngradeModelActionConfig = z.infer<typeof DowngradeModelActionConfigSchema>;

/**
 * Config for `agentgate_policy` action.
 * Adjusts an AgentGate policy in response to a guardrail trigger.
 */
export const AgentGatePolicyActionConfigSchema = z.object({
  /** AgentGate API URL */
  agentgateUrl: z.string().url(),
  /** Policy ID to modify */
  policyId: z.string().min(1),
  /** Action to take on the policy */
  action: z.enum(['tighten', 'loosen', 'disable']),
  /** Optional additional parameters */
  params: z.record(z.unknown()).optional(),
});
export type AgentGatePolicyActionConfig = z.infer<typeof AgentGatePolicyActionConfigSchema>;

/**
 * Discriminated union of all action config types.
 */
export type GuardrailActionConfig =
  | PauseAgentActionConfig
  | WebhookActionConfig
  | DowngradeModelActionConfig
  | AgentGatePolicyActionConfig;

/**
 * Map from action type to its Zod schema — for runtime validation.
 */
export const actionConfigSchemas: Record<string, z.ZodTypeAny> = {
  pause_agent: PauseAgentActionConfigSchema,
  notify_webhook: WebhookActionConfigSchema,
  downgrade_model: DowngradeModelActionConfigSchema,
  agentgate_policy: AgentGatePolicyActionConfigSchema,
};
