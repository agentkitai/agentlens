/**
 * @agentlens/core — Zod Validation Schemas
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
