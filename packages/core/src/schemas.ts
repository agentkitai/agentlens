/**
 * @agentkitai/agentlens-core — Zod Validation Schemas
 *
 * Runtime validation schemas for all API inputs per Architecture §4.2
 */
import { z } from 'zod';

/**
 * Schema for validating CLIENT-INGESTIBLE event types (POST /api/events).
 *
 * This is intentionally a SUBSET of the EventType union / EVENT_TYPES: it omits
 * server-only types — notably `eval_result` (and `error`) — so a client cannot
 * forge eval/compliance evidence by ingesting it directly. Server-emitted
 * events (e.g. compliance scoring) bypass this schema and are chained
 * server-side. Keep `eval_result` OUT of this list. (Guarded by a test in
 * schemas.test.ts.)
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
  arguments: z.record(z.string(), z.unknown()),
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
  mcpClientInfo: z.record(z.string(), z.unknown()).optional(),
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
  params: z.record(z.string(), z.unknown()),
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
  content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
  toolCallId: z.string().optional(),
  toolCalls: z.array(z.object({
    id: z.string(),
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
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
    parameters: z.record(z.string(), z.unknown()).optional(),
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
    arguments: z.record(z.string(), z.unknown()),
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
  data: z.record(z.string(), z.unknown()),
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
    payload: z.record(z.string(), z.unknown()),
    metadata: z.record(z.string(), z.unknown()).default({}),
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

// ─── Compliance Eval Schemas (#55) ──────────────────────────────────

/**
 * A single deterministic compliance rule. Validates untrusted rule JSON at the
 * POST /api/eval/sessions/:id/compliance trust boundary so malformed rules are
 * rejected (400) rather than crashing or silently mis-scoring the evaluator.
 */
export const complianceRuleSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.literal('tool_denylist'),
    description: z.string().optional(),
    tools: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('tool_allowlist'),
    description: z.string().optional(),
    tools: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('max_cost'),
    description: z.string().optional(),
    maxUsd: z.number().nonnegative().finite(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('no_severity_above'),
    description: z.string().optional(),
    severity: severitySchema,
  }),
]);

export const complianceScoreRequestSchema = z
  .object({
    /** Inline rules, OR provide `evaluatorId` to instantiate a catalog evaluator's rules.
     *  Not `.min(1)` here — the refine below enforces "rules (non-empty) OR evaluatorId",
     *  so `{ rules: [], evaluatorId }` is accepted rather than wrongly rejected. */
    rules: z.array(complianceRuleSchema).optional(),
    /** Catalog evaluator (scorerType 'compliance') whose rules to apply (#55 Phase 4). */
    evaluatorId: z.string().min(1).optional(),
    /** Optional score-based pass threshold in [0, 1]; omit for strict (any violation fails) */
    passThreshold: z.number().min(0).max(1).optional(),
    agentId: z.string().min(1).optional(),
  })
  .refine((v) => (v.rules?.length ?? 0) > 0 || !!v.evaluatorId, {
    message: 'provide either `rules` (non-empty) or `evaluatorId`',
    path: ['rules'],
  });

export type ComplianceScoreRequest = z.infer<typeof complianceScoreRequestSchema>;

/**
 * Request to score a completed session with the LLM judge (online/retroactive).
 * The judgment is hash-chained as an `eval_result` event labelled method:'llm_judge'.
 */
export const judgeScoreRequestSchema = z
  .object({
    /** The rubric the judge grades against, OR provide `evaluatorId` to use a catalog one.
     *  Not `.min(1)` — the refine enforces "rubric OR evaluatorId". */
    rubric: z.string().optional(),
    /** Catalog evaluator (scorerType 'llm_judge') whose rubric/model to apply (#55 Phase 4). */
    evaluatorId: z.string().min(1).optional(),
    /** Judge model override; defaults to a cheap Claude tier server-side. */
    model: z.string().min(1).optional(),
    /** Pass threshold in [0, 1]; defaults to the judge's 0.7. */
    passThreshold: z.number().min(0).max(1).optional(),
    /** Optional reference answer to ground the judgment. */
    expectedOutput: z.unknown().optional(),
    agentId: z.string().min(1).optional(),
  })
  .refine((v) => !!v.rubric || !!v.evaluatorId, {
    message: 'provide either `rubric` or `evaluatorId`',
    path: ['rubric'],
  });

export type JudgeScoreRequest = z.infer<typeof judgeScoreRequestSchema>;

/**
 * Service-to-service request (from AgentGate) to record a guardrail breach as a
 * hash-chained compliance `eval_result` in a session's audit trail (#55 — the
 * gate→lens wedge). AgentGate holds no AgentLens session of its own, so it passes
 * the session it observed the breach in explicitly. Authenticated by
 * AGENTGATE_SERVICE_TOKEN; tenant comes from the (org-scoped) body.
 */
export const guardrailBreachRequestSchema = z.object({
  tenantId: z.string().min(1),
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
  breach: z.object({
    /** The gate rule/policy id that was breached. */
    ruleId: z.string().min(1),
    /** Gate rule type (free-form, e.g. 'tool_denylist', 'budget', 'policy'). */
    ruleType: z.string().min(1).optional(),
    /** The tool/action that was denied, if applicable. */
    tool: z.string().min(1).optional(),
    description: z.string().optional(),
    /** Human-readable denial reason from the gate. */
    reason: z.string().optional(),
    /** Where in AgentGate this fired, e.g. 'mcp_guardrail' | 'reactive_guardrail'. */
    source: z.string().min(1),
  }),
});

export type GuardrailBreachRequest = z.infer<typeof guardrailBreachRequestSchema>;

/**
 * Service-to-service request (from agenteval, the external Python eval framework)
 * to record a completed eval-suite run as a hash-chained `eval_result` in a
 * session's audit trail (#55 — the agenteval→lens federation). agenteval holds no
 * AgentLens session, so it passes a synthetic per-run sessionId and the server
 * genesis-chains the result. Authenticated by AGENTGATE_SERVICE_TOKEN; tenant
 * comes from the (org-scoped) body. `eval_result` stays server-authoritative —
 * agenteval cannot POST eval_result events directly (they're excluded from the
 * client ingest enum so evidence can't be forged); this route is the only path in.
 */
export const evalRunRequestSchema = z.object({
  tenantId: z.string().min(1),
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
  run: z.object({
    /** agenteval run id. */
    id: z.string().min(1),
    /** Suite name. */
    suite: z.string().min(1),
    /** When the run completed (ISO-8601), recorded as provenance metadata. */
    createdAt: z.string().min(1).optional(),
    /**
     * Evidence class. agenteval ships LLM/semantic graders, so the emitter marks
     * 'llm_judge' when any case used a non-deterministic grader; otherwise the run
     * is reproducible ('deterministic'). Absent → treated as 'deterministic'.
     */
    method: z.enum(['deterministic', 'llm_judge']).optional(),
    summary: z.object({
      total: z.number().int().nonnegative(),
      passed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      passRate: z.number().min(0).max(1),
      totalCostUsd: z.number().nonnegative().optional(),
    }),
    /** Failed cases, mapped to violations. Bounded so the event stays small. */
    failedCases: z
      .array(
        z.object({
          name: z.string().min(1),
          score: z.number().optional(),
          detail: z.string().max(1000).optional(),
        }),
      )
      .max(1000)
      .optional(),
  }),
});

export type EvalRunRequest = z.infer<typeof evalRunRequestSchema>;

// ─── Human scores + feedback (#122) ─────────────────────────────────
// Client→server request bodies. They DELIBERATELY carry no identity fields:
// the annotator/subject identity is resolved server-side from the authenticated
// context (or a verified token) and stamped onto the server-emitted event, so a
// caller cannot self-report or spoof "who scored this".

/**
 * Record a human review of a session/trace. Identity (userId+role for humans,
 * verifiedAgentId for agent reviewers) is server-set, not in this body.
 */
export const humanScoreRequestSchema = z
  .object({
    /** Normalized score in [0, 1] (optional when a categorical verdict is given). */
    score: z.number().min(0).max(1).optional(),
    /** Categorical verdict, e.g. 'pass' | 'fail' | 'needs_review' or a custom label. */
    verdict: z.string().min(1).max(64).optional(),
    /** Explicit pass/fail; otherwise derived from score (≥0.5) / verdict. */
    passed: z.boolean().optional(),
    reasoning: z.string().max(5000).optional(),
    labels: z.array(z.string().min(1).max(64)).max(50).optional(),
    /** Catalog evaluator/rubric the human graded against (#55 Phase 4). */
    evaluatorId: z.string().min(1).optional(),
    /** Trace/span scope within the session. */
    traceId: z.string().min(1).optional(),
    /** Annotation-queue item this review resolves, when submitted via a queue. */
    queueItemId: z.string().min(1).optional(),
  })
  .refine((v) => v.score !== undefined || v.verdict !== undefined || v.passed !== undefined, {
    message: 'provide a score, verdict, or passed',
    path: ['score'],
  });

export type HumanScoreRequest = z.infer<typeof humanScoreRequestSchema>;

/**
 * End-user feedback on a session. The session's verified agent id is inherited
 * server-side; an optional `subjectToken` (verified server-side) identifies the
 * end user — the raw subject id is never client-trusted.
 */
export const feedbackRequestSchema = z
  .object({
    kind: z.enum(['rating', 'thumbs']).optional(),
    /** Numeric rating (e.g. 1–5) when kind='rating'. */
    rating: z.number().optional(),
    /** Thumbs sentiment when kind='thumbs'. */
    sentiment: z.enum(['up', 'down']).optional(),
    comment: z.string().max(5000).optional(),
    /** Verified end-user subject token; server verifies + sets the subject id. */
    subjectToken: z.string().min(1).optional(),
  })
  .refine((v) => v.rating !== undefined || v.sentiment !== undefined || (v.comment?.trim().length ?? 0) > 0, {
    message: 'provide a rating, sentiment, or comment',
    path: ['rating'],
  });

export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>;

// ─── Evaluator Catalog (#55 Phase 4) ────────────────────────────────

const scorerTypeSchema = z.enum([
  'exact_match', 'contains', 'regex', 'llm_judge', 'compliance', 'custom', 'composite',
]);

/**
 * Create a catalog evaluator. The configTemplate is validated against the scorerType
 * at the trust boundary: a compliance evaluator must carry valid `rules`, an
 * llm_judge one a `rubric`, a regex one a `pattern`.
 */
export const createEvaluatorRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    scorerType: scorerTypeSchema,
    configTemplate: z.record(z.string(), z.unknown()),
    tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  })
  .superRefine((val, ctx) => {
    const ct = val.configTemplate as Record<string, unknown>;
    if (val.scorerType === 'compliance') {
      if (!z.array(complianceRuleSchema).min(1).safeParse(ct.rules).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['configTemplate', 'rules'],
          message: 'compliance evaluator requires configTemplate.rules: a non-empty array of valid ComplianceRule' });
      }
    } else if (val.scorerType === 'llm_judge') {
      if (typeof ct.rubric !== 'string' || !ct.rubric.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['configTemplate', 'rubric'],
          message: 'llm_judge evaluator requires configTemplate.rubric (a non-empty string)' });
      }
    } else if (val.scorerType === 'regex') {
      if (typeof ct.pattern !== 'string' || !ct.pattern.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['configTemplate', 'pattern'],
          message: 'regex evaluator requires configTemplate.pattern (a non-empty string)' });
      }
    }
  });

export type CreateEvaluatorRequest = z.infer<typeof createEvaluatorRequestSchema>;

/** Update an evaluator's metadata. configTemplate/scorerType are fixed at creation. */
export const updateEvaluatorRequestSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'provide at least one field to update' });

export type UpdateEvaluatorRequest = z.infer<typeof updateEvaluatorRequestSchema>;

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

export const ComplexityTierSchema = z.enum(['simple', 'moderate', 'complex', 'expert']);
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

// ─── Benchmark Schemas (v0.7.0 — Story 1.2) ────────────────────────

export const BenchmarkStatusSchema = z.enum(['draft', 'running', 'completed', 'cancelled']);

export const BenchmarkMetricSchema = z.enum([
  'health_score',
  'error_rate',
  'avg_cost',
  'avg_latency',
  'tool_success_rate',
  'completion_rate',
  'avg_tokens',
  'avg_duration',
]);

export const BenchmarkSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  status: BenchmarkStatusSchema,
  agentId: z.string().optional(),
  metrics: z.array(BenchmarkMetricSchema).min(1),
  minSessionsPerVariant: z.number().int().min(1),
  timeRange: z
    .object({
      from: z.string().min(1),
      to: z.string().min(1),
    })
    .optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  completedAt: z.string().optional(),
});

export const BenchmarkVariantSchema = z.object({
  id: z.string().min(1),
  benchmarkId: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  tag: z.string().min(1),
  agentId: z.string().optional(),
  sortOrder: z.number().int().min(0),
});

// ─── Guardrail Schemas (v0.8.0 — Phase 3) ──────────────────────────

export const GuardrailConditionTypeSchema = z.enum([
  'error_rate_threshold',
  'cost_limit',
  'health_score_threshold',
  'custom_metric',
  // Content-level conditions (Feature 8):
  'pii_detection',
  'secrets_detection',
  'content_regex',
  'toxicity_detection',
  'prompt_injection',
]);

export const GuardrailActionTypeSchema = z.enum([
  'pause_agent',
  'notify_webhook',
  'downgrade_model',
  'agentgate_policy',
  // Inline enforcement actions (Feature 8):
  'block',
  'redact',
  'log_and_continue',
  'alert',
  // Phase 2 — proactive guardrails v2 (Feature 5):
  'rate_limit',
]);

export const GuardrailDirectionSchema = z.enum(['input', 'output', 'both']);

export const CreateGuardrailRuleSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  enabled: z.boolean().default(true),
  conditionType: GuardrailConditionTypeSchema,
  conditionConfig: z.record(z.string(), z.unknown()),
  actionType: GuardrailActionTypeSchema,
  actionConfig: z.record(z.string(), z.unknown()),
  agentId: z.string().optional(),
  cooldownMinutes: z.number().int().min(0).max(1440).default(15),
  dryRun: z.boolean().default(true),
  // Feature 8 — content-level fields:
  direction: GuardrailDirectionSchema.optional(),
  toolNames: z.array(z.string()).optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
});

export const UpdateGuardrailRuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  enabled: z.boolean().optional(),
  conditionType: GuardrailConditionTypeSchema.optional(),
  conditionConfig: z.record(z.string(), z.unknown()).optional(),
  actionType: GuardrailActionTypeSchema.optional(),
  actionConfig: z.record(z.string(), z.unknown()).optional(),
  agentId: z.string().nullable().optional(),
  cooldownMinutes: z.number().int().min(0).max(1440).optional(),
  dryRun: z.boolean().optional(),
  // Feature 8 — content-level fields:
  direction: GuardrailDirectionSchema.optional(),
  toolNames: z.array(z.string()).optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
});

export const GuardrailRuleSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean(),
  conditionType: GuardrailConditionTypeSchema,
  conditionConfig: z.record(z.string(), z.unknown()),
  actionType: GuardrailActionTypeSchema,
  actionConfig: z.record(z.string(), z.unknown()),
  agentId: z.string().optional(),
  cooldownMinutes: z.number().int().min(0),
  dryRun: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
