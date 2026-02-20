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

// ─── Content Condition Configs (Feature 8) ──────────────────────────

export const PiiDetectionConfigSchema = z.object({
  patterns: z.array(z.enum([
    'ssn', 'credit_card', 'email', 'phone_us', 'phone_intl',
    'ip_address', 'date_of_birth', 'passport', 'drivers_license',
  ])).default(['ssn', 'credit_card', 'email', 'phone_us']),
  customPatterns: z.record(z.string(), z.string()).optional(),
  minConfidence: z.number().min(0).max(1).default(0.8),
});
export type PiiDetectionConfig = z.infer<typeof PiiDetectionConfigSchema>;

export const SecretsDetectionConfigSchema = z.object({
  patterns: z.array(z.enum([
    'aws_access_key', 'aws_secret_key', 'github_token', 'github_fine_grained',
    'openai_key', 'anthropic_key', 'stripe_key', 'generic_bearer',
    'generic_api_key', 'private_key_pem', 'jwt',
  ])).default([
    'aws_access_key', 'github_token', 'openai_key', 'anthropic_key',
    'generic_bearer', 'private_key_pem',
  ]),
  customPatterns: z.record(z.string(), z.string()).optional(),
});
export type SecretsDetectionConfig = z.infer<typeof SecretsDetectionConfigSchema>;

export const ContentRegexConfigSchema = z.object({
  pattern: z.string().min(1),
  flags: z.string().default('gi'),
  patternName: z.string().default('custom_match'),
});
export type ContentRegexConfig = z.infer<typeof ContentRegexConfigSchema>;

export const ToxicityDetectionConfigSchema = z.object({
  backend: z.enum(['local_wordlist', 'perspective_api', 'openai_moderation']).default('local_wordlist'),
  threshold: z.number().min(0).max(1).default(0.7),
  apiKey: z.string().optional(),
  categories: z.array(z.string()).default(['toxic', 'threat', 'insult', 'profanity']),
});
export type ToxicityDetectionConfig = z.infer<typeof ToxicityDetectionConfigSchema>;

export const PromptInjectionConfigSchema = z.object({
  strategies: z.array(z.enum([
    'instruction_override', 'role_play', 'encoding_attack',
    'delimiter_injection', 'context_manipulation',
  ])).default(['instruction_override', 'role_play', 'delimiter_injection']),
  sensitivity: z.enum(['low', 'medium', 'high']).default('medium'),
});
export type PromptInjectionConfig = z.infer<typeof PromptInjectionConfigSchema>;

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
  pii_detection: PiiDetectionConfigSchema,
  secrets_detection: SecretsDetectionConfigSchema,
  content_regex: ContentRegexConfigSchema,
  toxicity_detection: ToxicityDetectionConfigSchema,
  prompt_injection: PromptInjectionConfigSchema,
};

// ─── Action Configs ─────────────────────────────────────────────────

/**
 * Config for `pause_agent` action.
 */
export const PauseAgentActionConfigSchema = z.object({
  message: z.string().optional(),
});
export type PauseAgentActionConfig = z.infer<typeof PauseAgentActionConfigSchema>;

/**
 * Config for `notify_webhook` action.
 */
export const WebhookActionConfigSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  secret: z.string().optional(),
});
export type WebhookActionConfig = z.infer<typeof WebhookActionConfigSchema>;

/**
 * Config for `downgrade_model` action.
 */
export const DowngradeModelActionConfigSchema = z.object({
  targetModel: z.string().min(1),
  message: z.string().optional(),
});
export type DowngradeModelActionConfig = z.infer<typeof DowngradeModelActionConfigSchema>;

/**
 * Config for `agentgate_policy` action.
 */
export const AgentGatePolicyActionConfigSchema = z.object({
  agentgateUrl: z.string().url(),
  policyId: z.string().min(1),
  action: z.enum(['tighten', 'loosen', 'disable']),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type AgentGatePolicyActionConfig = z.infer<typeof AgentGatePolicyActionConfigSchema>;

// ─── Inline Action Configs (Feature 8) ──────────────────────────────

export const BlockActionConfigSchema = z.object({
  message: z.string().default('Request blocked by content guardrail policy'),
  includeDetails: z.boolean().default(false),
});
export type BlockActionConfig = z.infer<typeof BlockActionConfigSchema>;

export const RedactActionConfigSchema = z.object({
  replacementFormat: z.string().default('[{TYPE}_REDACTED]'),
});
export type RedactActionConfig = z.infer<typeof RedactActionConfigSchema>;

export const LogAndContinueActionConfigSchema = z.object({
  logSeverity: z.enum(['info', 'warn']).default('warn'),
});
export type LogAndContinueActionConfig = z.infer<typeof LogAndContinueActionConfigSchema>;

export const AlertActionConfigSchema = z.object({
  webhookUrl: z.string().url().optional(),
  busSeverity: z.enum(['warn', 'error', 'critical']).default('error'),
});
export type AlertActionConfig = z.infer<typeof AlertActionConfigSchema>;

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
  block: BlockActionConfigSchema,
  redact: RedactActionConfigSchema,
  log_and_continue: LogAndContinueActionConfigSchema,
  alert: AlertActionConfigSchema,
};
