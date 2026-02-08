/**
 * @agentlensai/core — Zod Validation Schemas
 *
 * Runtime validation schemas for all API inputs per Architecture §4.2
 */
import { z } from 'zod';

/**
 * Schema for validating event types
 */
export const eventTypeSchema = z.enum([
  'session_started',
  'session_ended',
  'tool_call',
  'tool_response',
  'tool_error',
  'approval_requested',
  'approval_granted',
  'approval_denied',
  'approval_expired',
  'form_submitted',
  'form_completed',
  'form_expired',
  'cost_tracked',
  'llm_call',
  'llm_response',
  'alert_triggered',
  'alert_resolved',
  'custom',
]);

/**
 * Schema for validating severity levels
 */
export const severitySchema = z.enum(['debug', 'info', 'warn', 'error', 'critical']);

// ─── Typed Payload Schemas ──────────────────────────────────────────

export const toolCallPayloadSchema = z.object({
  toolName: z.string().min(1),
  callId: z.string().min(1),
  arguments: z.record(z.unknown()),
  serverName: z.string().optional(),
});

export const toolResponsePayloadSchema = z.object({
  callId: z.string().min(1),
  toolName: z.string().min(1),
  result: z.unknown(),
  durationMs: z.number(),
});

export const toolErrorPayloadSchema = z.object({
  callId: z.string().min(1),
  toolName: z.string().min(1),
  error: z.string(),
  errorCode: z.string().optional(),
  durationMs: z.number(),
});

export const sessionStartedPayloadSchema = z.object({
  agentName: z.string().optional(),
  agentVersion: z.string().optional(),
  mcpClientInfo: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
});

export const sessionEndedPayloadSchema = z.object({
  reason: z.enum(['completed', 'error', 'timeout', 'manual']),
  summary: z.string().optional(),
  totalToolCalls: z.number().optional(),
  totalDurationMs: z.number().optional(),
});

export const approvalRequestedPayloadSchema = z.object({
  requestId: z.string().min(1),
  action: z.string().min(1),
  params: z.record(z.unknown()),
  urgency: z.string(),
});

export const approvalDecisionPayloadSchema = z.object({
  requestId: z.string().min(1),
  action: z.string().min(1),
  decidedBy: z.string().min(1),
  reason: z.string().optional(),
});

export const formSubmittedPayloadSchema = z.object({
  submissionId: z.string().min(1),
  formId: z.string().min(1),
  formName: z.string().optional(),
  fieldCount: z.number(),
});

export const formCompletedPayloadSchema = z.object({
  submissionId: z.string().min(1),
  formId: z.string().min(1),
  completedBy: z.string().min(1),
  durationMs: z.number(),
});

export const formExpiredPayloadSchema = z.object({
  submissionId: z.string().min(1),
  formId: z.string().min(1),
  expiredAfterMs: z.number(),
});

export const costTrackedPayloadSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  costUsd: z.number(),
  trigger: z.string().optional(),
});

export const alertTriggeredPayloadSchema = z.object({
  alertRuleId: z.string().min(1),
  alertName: z.string().min(1),
  condition: z.string(),
  currentValue: z.number(),
  threshold: z.number(),
  message: z.string(),
});

export const alertResolvedPayloadSchema = z.object({
  alertRuleId: z.string().min(1),
  alertName: z.string().min(1),
  resolvedBy: z.string().optional(),
});

export const llmMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(z.record(z.unknown()))]),
  toolCallId: z.string().optional(),
  toolCalls: z.array(z.object({
    id: z.string(),
    name: z.string(),
    arguments: z.record(z.unknown()),
  })).optional(),
});

export const llmCallPayloadSchema = z.object({
  callId: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  messages: z.array(llmMessageSchema).min(1),
  systemPrompt: z.string().optional(),
  parameters: z.object({
    temperature: z.number().optional(),
    maxTokens: z.number().optional(),
    topP: z.number().optional(),
    stopSequences: z.array(z.string()).optional(),
  }).catchall(z.unknown()).optional(),
  tools: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.unknown()).optional(),
  })).optional(),
  redacted: z.boolean().optional(),
});

export const llmResponsePayloadSchema = z.object({
  callId: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  completion: z.string().nullable(),
  toolCalls: z.array(z.object({
    id: z.string(),
    name: z.string(),
    arguments: z.record(z.unknown()),
  })).optional(),
  finishReason: z.string().min(1),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    totalTokens: z.number(),
    thinkingTokens: z.number().optional(),
    cacheReadTokens: z.number().optional(),
    cacheWriteTokens: z.number().optional(),
  }),
  costUsd: z.number(),
  latencyMs: z.number(),
  redacted: z.boolean().optional(),
});

export const customPayloadSchema = z.object({
  type: z.string(),
  data: z.record(z.unknown()),
});

/**
 * Map of event type to payload schema for type-specific validation.
 */
export const payloadSchemasByEventType: Record<string, z.ZodTypeAny> = {
  tool_call: toolCallPayloadSchema,
  tool_response: toolResponsePayloadSchema,
  tool_error: toolErrorPayloadSchema,
  session_started: sessionStartedPayloadSchema,
  session_ended: sessionEndedPayloadSchema,
  approval_requested: approvalRequestedPayloadSchema,
  approval_granted: approvalDecisionPayloadSchema,
  approval_denied: approvalDecisionPayloadSchema,
  approval_expired: approvalDecisionPayloadSchema,
  form_submitted: formSubmittedPayloadSchema,
  form_completed: formCompletedPayloadSchema,
  form_expired: formExpiredPayloadSchema,
  cost_tracked: costTrackedPayloadSchema,
  llm_call: llmCallPayloadSchema,
  llm_response: llmResponsePayloadSchema,
  alert_triggered: alertTriggeredPayloadSchema,
  alert_resolved: alertResolvedPayloadSchema,
  custom: customPayloadSchema,
};

/**
 * Schema for validating inbound event ingestion.
 *
 * Uses superRefine to validate the payload against the correct
 * type-specific schema based on eventType.
 */
export const ingestEventSchema = z
  .object({
    sessionId: z.string().min(1, 'sessionId is required'),
    agentId: z.string().min(1, 'agentId is required'),
    eventType: eventTypeSchema,
    severity: severitySchema.default('info'),
    payload: z.record(z.unknown()),
    metadata: z.record(z.unknown()).default({}),
    /** Optional client-side timestamp; server will validate and may override */
    timestamp: z.string().datetime().optional(),
  })
  .superRefine((data, ctx) => {
    const schema = payloadSchemasByEventType[data.eventType];
    if (schema) {
      const result = schema.safeParse(data.payload);
      if (!result.success) {
        for (const issue of result.error.issues) {
          ctx.addIssue({
            ...issue,
            path: ['payload', ...issue.path],
          });
        }
      }
    }
  });

/**
 * Type inferred from the ingest event schema
 */
export type IngestEventInput = z.infer<typeof ingestEventSchema>;

// ─── Health Score Schemas (Story 1.1) ───────────────────────────────

export const HealthDimensionSchema = z.object({
  name: z.enum(['error_rate', 'cost_efficiency', 'tool_success', 'latency', 'completion_rate']),
  score: z.number().min(0).max(100),
  weight: z.number().min(0).max(1),
  rawValue: z.number(),
  description: z.string().min(1),
});

export const HealthTrendSchema = z.enum(['improving', 'stable', 'degrading']);

export const HealthScoreSchema = z.object({
  agentId: z.string().min(1),
  overallScore: z.number().min(0).max(100),
  trend: HealthTrendSchema,
  trendDelta: z.number(),
  dimensions: z.array(HealthDimensionSchema).min(1),
  window: z.object({
    from: z.string().min(1),
    to: z.string().min(1),
  }),
  sessionCount: z.number().int().min(0),
  computedAt: z.string().min(1),
});

export const HealthWeightsSchema = z
  .object({
    errorRate: z.number().min(0).max(1),
    costEfficiency: z.number().min(0).max(1),
    toolSuccess: z.number().min(0).max(1),
    latency: z.number().min(0).max(1),
    completionRate: z.number().min(0).max(1),
  })
  .refine(
    (w) => {
      const sum = w.errorRate + w.costEfficiency + w.toolSuccess + w.latency + w.completionRate;
      return sum >= 0.95 && sum <= 1.05;
    },
    { message: 'Weights must sum to approximately 1.0 (tolerance: 0.95–1.05)' },
  );

export const HealthSnapshotSchema = z.object({
  agentId: z.string().min(1),
  date: z.string().min(1),
  overallScore: z.number().min(0).max(100),
  errorRateScore: z.number().min(0).max(100),
  costEfficiencyScore: z.number().min(0).max(100),
  toolSuccessScore: z.number().min(0).max(100),
  latencyScore: z.number().min(0).max(100),
  completionRateScore: z.number().min(0).max(100),
  sessionCount: z.number().int().min(0),
});

// ─── Cost Optimization Schemas (Story 2.1) ──────────────────────────

export const ComplexityTierSchema = z.enum(['simple', 'moderate', 'complex']);
export const ConfidenceLevelSchema = z.enum(['low', 'medium', 'high']);

export const CostRecommendationSchema = z.object({
  currentModel: z.string().min(1),
  recommendedModel: z.string().min(1),
  complexityTier: ComplexityTierSchema,
  currentCostPerCall: z.number().min(0),
  recommendedCostPerCall: z.number().min(0),
  monthlySavings: z.number(),
  callVolume: z.number().int().min(0),
  currentSuccessRate: z.number().min(0).max(1),
  recommendedSuccessRate: z.number().min(0).max(1),
  confidence: ConfidenceLevelSchema,
  agentId: z.string().min(1),
});

export const OptimizationResultSchema = z.object({
  recommendations: z.array(CostRecommendationSchema),
  totalPotentialSavings: z.number().min(0),
  period: z.number().int().min(1),
  analyzedCalls: z.number().int().min(0),
});
