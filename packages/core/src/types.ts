/**
 * @agentlensai/core — Core Event Types and Interfaces
 *
 * All types per Architecture §4.1
 */

// ─── Branded Type Aliases ──────────────────────────────────────────

/**
 * Unique identifier (ULID for time-sortability)
 */
export type EventId = string;

/**
 * ISO 8601 timestamp string
 */
export type Timestamp = string;

// ─── Event Type & Severity ─────────────────────────────────────────

/**
 * All supported event types (16 types)
 */
export type EventType =
  // Agent lifecycle
  | 'session_started'
  | 'session_ended'
  // Tool calls
  | 'tool_call'
  | 'tool_response'
  | 'tool_error'
  // Approval flow (from AgentGate)
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_denied'
  | 'approval_expired'
  // Form flow (from FormBridge)
  | 'form_submitted'
  | 'form_completed'
  | 'form_expired'
  // Cost tracking
  | 'cost_tracked'
  // LLM call tracking
  | 'llm_call'
  | 'llm_response'
  // Alerting
  | 'alert_triggered'
  | 'alert_resolved'
  // Custom / extension
  | 'custom';

/**
 * Array of all event types for iteration/validation
 */
export const EVENT_TYPES: readonly EventType[] = [
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
] as const;

/**
 * Severity levels for events
 */
export type EventSeverity = 'debug' | 'info' | 'warn' | 'error' | 'critical';

/**
 * Array of all severity levels for iteration/validation
 */
export const EVENT_SEVERITIES: readonly EventSeverity[] = [
  'debug',
  'info',
  'warn',
  'error',
  'critical',
] as const;

// ─── Typed Payloads ─────────────────────────────────────────────────

export interface ToolCallPayload {
  toolName: string;
  serverName?: string;
  arguments: Record<string, unknown>;
  /** Correlation ID to match with tool_response/tool_error */
  callId: string;
}

export interface ToolResponsePayload {
  callId: string;
  toolName: string;
  result: unknown;
  durationMs: number;
  isError?: boolean;
}

export interface ToolErrorPayload {
  callId: string;
  toolName: string;
  error: string;
  errorCode?: string;
  durationMs: number;
}

export interface SessionStartedPayload {
  agentName?: string;
  agentVersion?: string;
  mcpClientInfo?: Record<string, unknown>;
  tags?: string[];
}

export interface SessionEndedPayload {
  reason: 'completed' | 'error' | 'timeout' | 'manual';
  summary?: string;
  totalToolCalls?: number;
  totalDurationMs?: number;
}

export interface ApprovalRequestedPayload {
  /** AgentGate request ID for cross-reference */
  requestId: string;
  action: string;
  params: Record<string, unknown>;
  urgency: string;
}

export interface ApprovalDecisionPayload {
  requestId: string;
  action: string;
  decidedBy: string;
  reason?: string;
}

export interface FormSubmittedPayload {
  /** FormBridge submission ID */
  submissionId: string;
  formId: string;
  formName?: string;
  fieldCount: number;
}

export interface FormCompletedPayload {
  submissionId: string;
  formId: string;
  completedBy: string;
  durationMs: number;
}

export interface FormExpiredPayload {
  submissionId: string;
  formId: string;
  expiredAfterMs: number;
}

export interface CostTrackedPayload {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  /** What triggered this cost (tool call, completion, etc.) */
  trigger?: string;
}

export interface AlertTriggeredPayload {
  alertRuleId: string;
  alertName: string;
  condition: string;
  currentValue: number;
  threshold: number;
  message: string;
}

export interface AlertResolvedPayload {
  alertRuleId: string;
  alertName: string;
  resolvedBy?: string;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  /** For tool role: which tool call this responds to */
  toolCallId?: string;
  /** For assistant role: tool calls the model wants to make */
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
}

export interface LlmCallPayload {
  /** Correlation ID to match with llm_response */
  callId: string;
  /** Provider name (e.g., "anthropic", "openai", "google") */
  provider: string;
  /** Model identifier (e.g., "claude-opus-4-6", "gpt-4o") */
  model: string;
  /** The messages/prompt sent to the model */
  messages: LlmMessage[];
  /** System prompt (if separate from messages) */
  systemPrompt?: string;
  /** Model parameters */
  parameters?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    stopSequences?: string[];
    [key: string]: unknown;
  };
  /** Tool/function definitions provided to the model */
  tools?: Array<{
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }>;
  /** If true, prompt content was redacted for privacy */
  redacted?: boolean;
}

export interface LlmResponsePayload {
  /** Correlation ID matching the llm_call */
  callId: string;
  /** Provider name */
  provider: string;
  /** Model used (may differ from requested if auto-routed) */
  model: string;
  /** The completion content */
  completion: string | null;
  /** Tool calls requested by the model */
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  /** Stop reason */
  finishReason: 'stop' | 'length' | 'tool_use' | 'content_filter' | 'error' | string;
  /** Token usage */
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    /** Thinking/reasoning tokens if applicable */
    thinkingTokens?: number;
    /** Cache read/write tokens if applicable */
    cacheReadTokens?: number;
    /** Cache write tokens if applicable */
    cacheWriteTokens?: number;
  };
  /** Cost in USD */
  costUsd: number;
  /** Latency in milliseconds (time from request to full response) */
  latencyMs: number;
  /** If true, completion content was redacted for privacy */
  redacted?: boolean;
}

export interface CustomPayload {
  type: string;
  data: Record<string, unknown>;
}

/**
 * Discriminated union of all payload types
 */
export type EventPayload =
  | ToolCallPayload
  | ToolResponsePayload
  | ToolErrorPayload
  | SessionStartedPayload
  | SessionEndedPayload
  | ApprovalRequestedPayload
  | ApprovalDecisionPayload
  | FormSubmittedPayload
  | FormCompletedPayload
  | FormExpiredPayload
  | CostTrackedPayload
  | LlmCallPayload
  | LlmResponsePayload
  | AlertTriggeredPayload
  | AlertResolvedPayload
  | CustomPayload;

// ─── Core Event Record ──────────────────────────────────────────────

/**
 * The core event record — the fundamental unit of data in AgentLens
 */
export interface AgentLensEvent {
  /** ULID — unique, time-sortable identifier */
  id: EventId;

  /** ISO 8601 timestamp of when the event occurred */
  timestamp: Timestamp;

  /** Session this event belongs to */
  sessionId: string;

  /** Agent that produced this event */
  agentId: string;

  /** Type discriminator */
  eventType: EventType;

  /** Severity level */
  severity: EventSeverity;

  /** Event-type-specific payload (see typed payloads above) */
  payload: EventPayload;

  /** Arbitrary metadata (tags, labels, correlation IDs) */
  metadata: Record<string, unknown>;

  /** SHA-256 hash of previous event in session (hash chain) */
  prevHash: string | null;

  /** SHA-256 hash of this event (computed on ingest) */
  hash: string;

  /** Tenant this event belongs to (multi-tenant isolation) */
  tenantId: string;
}

// ─── Session & Agent ────────────────────────────────────────────────

/**
 * Session status enum values
 */
export type SessionStatus = 'active' | 'completed' | 'error';

/**
 * Agent session — materialized from session_started/session_ended events
 */
export interface Session {
  id: string;
  agentId: string;
  agentName?: string;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  status: SessionStatus;
  eventCount: number;
  toolCallCount: number;
  errorCount: number;
  totalCostUsd: number;
  /** Number of LLM calls in this session */
  llmCallCount: number;
  /** Total input tokens across all LLM calls */
  totalInputTokens: number;
  /** Total output tokens across all LLM calls */
  totalOutputTokens: number;
  tags: string[];
  /** Tenant this session belongs to (multi-tenant isolation) */
  tenantId: string;
}

/**
 * Registered agent
 */
export interface Agent {
  id: string;
  name: string;
  description?: string;
  firstSeenAt: Timestamp;
  lastSeenAt: Timestamp;
  sessionCount: number;
  /** Tenant this agent belongs to (multi-tenant isolation) */
  tenantId: string;
}

// ─── Query Types ────────────────────────────────────────────────────

export interface EventQuery {
  sessionId?: string;
  agentId?: string;
  eventType?: EventType | EventType[];
  severity?: EventSeverity | EventSeverity[];
  from?: Timestamp;
  to?: Timestamp;
  limit?: number;
  offset?: number;
  /** Sort direction (default: desc — newest first) */
  order?: 'asc' | 'desc';
  /** Full-text search on payload */
  search?: string;
  /** Tenant ID for multi-tenant isolation */
  tenantId?: string;
}

export interface EventQueryResult {
  events: AgentLensEvent[];
  total: number;
  hasMore: boolean;
}

export interface SessionQuery {
  agentId?: string;
  status?: SessionStatus | SessionStatus[];
  from?: Timestamp;
  to?: Timestamp;
  limit?: number;
  offset?: number;
  tags?: string[];
  /** Tenant ID for multi-tenant isolation */
  tenantId?: string;
}

export interface SessionQueryResult {
  sessions: Session[];
  total: number;
}

// ─── Alert Types ────────────────────────────────────────────────────

export type AlertCondition =
  | 'error_rate_exceeds'
  | 'cost_exceeds'
  | 'latency_exceeds'
  | 'event_count_exceeds'
  | 'no_events_for';

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  condition: AlertCondition;
  threshold: number;
  windowMinutes: number;
  /** Scope: all agents, specific agent, specific session tag */
  scope: {
    agentId?: string;
    tags?: string[];
  };
  /** Notification channels (webhook URLs, email, etc.) */
  notifyChannels: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** Tenant this rule belongs to (multi-tenant isolation) */
  tenantId: string;
}

export interface AlertHistory {
  id: string;
  ruleId: string;
  triggeredAt: Timestamp;
  resolvedAt?: Timestamp;
  currentValue: number;
  threshold: number;
  message: string;
  /** Tenant this alert history belongs to (multi-tenant isolation) */
  tenantId: string;
}

// ─── Recall / Self-Query Types (Epic 2) ─────────────────────────────

/**
 * Query for agent self-recall (semantic search over embeddings)
 */
export interface RecallQuery {
  /** Natural language query to search for */
  query: string;
  /** Scope filter: 'event' | 'session' | 'lesson' */
  scope?: string;
  /** Filter by agent ID */
  agentId?: string;
  /** Filter embeddings created after this ISO 8601 timestamp */
  from?: Timestamp;
  /** Filter embeddings created before this ISO 8601 timestamp */
  to?: Timestamp;
  /** Max number of results to return (default: 10) */
  limit?: number;
  /** Minimum cosine similarity score (0-1, default: 0.5) */
  minScore?: number;
}

/**
 * Result of a recall query
 */
export interface RecallResult {
  /** Matching results, sorted by score descending */
  results: Array<{
    sourceType: string;
    sourceId: string;
    score: number;
    text: string;
    metadata?: Record<string, unknown>;
  }>;
  /** The original query string */
  query: string;
  /** Total number of results found (before limit) */
  totalResults: number;
}

// ─── Lesson Types (Epic 3) ──────────────────────────────────────────

/**
 * Importance levels for lessons
 */
export type LessonImportance = 'low' | 'normal' | 'high' | 'critical';

/**
 * A distilled lesson / insight from agent experience
 */
export interface Lesson {
  id: string;
  tenantId: string;
  agentId?: string;
  category: string;
  title: string;
  content: string;
  context: Record<string, unknown>;
  importance: LessonImportance;
  sourceSessionId?: string;
  sourceEventId?: string;
  accessCount: number;
  lastAccessedAt?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

/**
 * Query filters for listing lessons
 */
export interface LessonQuery {
  agentId?: string;
  category?: string;
  importance?: LessonImportance;
  search?: string;
  limit?: number;
  offset?: number;
  includeArchived?: boolean;
}

// ─── Reflect / Pattern Analysis Types (Epic 4) ─────────────────────

/**
 * Supported analysis types for the reflect endpoint
 */
export type ReflectAnalysis =
  | 'error_patterns'
  | 'tool_sequences'
  | 'cost_analysis'
  | 'performance_trends'
  | 'session_comparison';

/**
 * Query input for the reflect endpoint / MCP tool
 */
export interface ReflectQuery {
  analysis: ReflectAnalysis;
  agentId?: string;
  from?: string;
  to?: string;
  params?: Record<string, unknown>;
  limit?: number;
}

/**
 * Structured insight returned from analysis
 */
export interface ReflectInsight {
  type: string;
  summary: string;
  data: Record<string, unknown>;
  confidence: number;
}

/**
 * Result envelope from the reflect endpoint
 */
export interface ReflectResult {
  analysis: ReflectAnalysis;
  insights: ReflectInsight[];
  metadata: {
    sessionsAnalyzed: number;
    eventsAnalyzed: number;
    timeRange: { from: string; to: string };
  };
}

// ─── Error Pattern Analysis ────────────────────────────────────────

export interface ErrorPattern {
  pattern: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  affectedSessions: string[];
  precedingTools: string[][];
}

export interface ErrorPatternResult {
  patterns: ErrorPattern[];
  metadata: {
    eventsAnalyzed: number;
    timeRange: { from: string; to: string };
  };
}

// ─── Tool Sequence Analysis ────────────────────────────────────────

export interface ToolSequence {
  tools: string[];
  frequency: number;
  sessions: number;
  errorRate: number;
}

export interface ToolSequenceResult {
  sequences: ToolSequence[];
  stats: {
    avgSequenceLength: number;
    uniqueTools: number;
    totalCalls: number;
  };
  metadata: {
    eventsAnalyzed: number;
    timeRange: { from: string; to: string };
  };
}

// ─── Cost Analysis ─────────────────────────────────────────────────

export interface CostByModel {
  model: string;
  totalCost: number;
  callCount: number;
  avgCostPerCall: number;
}

export interface CostByAgent {
  agentId: string;
  totalCost: number;
  sessionCount: number;
  avgCostPerSession: number;
}

export interface CostTrendBucket {
  date: string;
  totalCost: number;
  sessionCount: number;
}

export interface CostAnalysisResult {
  summary: {
    totalCost: number;
    avgPerSession: number;
    totalSessions: number;
  };
  byModel: CostByModel[];
  byAgent: CostByAgent[];
  trend: {
    direction: 'increasing' | 'stable' | 'decreasing';
    buckets: CostTrendBucket[];
  };
  topSessions: Array<{
    sessionId: string;
    agentId: string;
    totalCost: number;
    startedAt: string;
  }>;
  metadata: {
    eventsAnalyzed: number;
    timeRange: { from: string; to: string };
  };
}

// ─── Performance Trends ────────────────────────────────────────────

export interface PerformanceTrendBucket {
  date: string;
  successRate: number;
  duration: number;
  toolCalls: number;
  errors: number;
}

export interface PerformanceTrendsResult {
  current: {
    successRate: number;
    avgDuration: number;
    avgToolCalls: number;
    avgErrors: number;
  };
  trends: PerformanceTrendBucket[];
  assessment: 'improving' | 'stable' | 'degrading';
  metadata: {
    sessionsAnalyzed: number;
    eventsAnalyzed: number;
    timeRange: { from: string; to: string };
  };
}

// ─── Create Lesson Input (Epic 6) ──────────────────────────────

/**
 * Input for creating a new lesson
 */
export interface CreateLessonInput {
  title: string;
  content: string;
  category?: string;
  importance?: LessonImportance;
  agentId?: string;
  context?: Record<string, unknown>;
  sourceSessionId?: string;
  sourceEventId?: string;
}

// ─── Context Types (Epic 5) ────────────────────────────────────

/**
 * Query for cross-session context retrieval
 */
export interface ContextQuery {
  /** Topic to retrieve context for */
  topic: string;
  /** Filter by user ID */
  userId?: string;
  /** Filter by agent ID */
  agentId?: string;
  /** Start of time range (ISO 8601) */
  from?: string;
  /** End of time range (ISO 8601) */
  to?: string;
  /** Maximum number of sessions to include */
  limit?: number;
}

/**
 * A key event within a context session
 */
export interface ContextKeyEvent {
  id: string;
  eventType: string;
  summary: string;
  timestamp: string;
}

/**
 * A lesson relevant to the context query
 */
export interface ContextLesson {
  id: string;
  title: string;
  content: string;
  category: string;
  importance: LessonImportance;
  relevanceScore: number;
}

/**
 * A session included in context results
 */
export interface ContextSession {
  sessionId: string;
  agentId: string;
  startedAt: string;
  endedAt?: string;
  summary?: string;
  relevanceScore: number;
  keyEvents: ContextKeyEvent[];
}

/**
 * Result of a context query
 */
export interface ContextResult {
  /** The original topic queried */
  topic: string;
  /** Related sessions, sorted by relevance */
  sessions: ContextSession[];
  /** Related lessons */
  lessons: ContextLesson[];
  /** Total number of matching sessions */
  totalSessions: number;
  /** Summary of the context */
  summary?: string;
}

// ─── Health Score Types (Epic 6 — Story 1.1) ───────────────────────

/** Health score dimension */
export interface HealthDimension {
  name: 'error_rate' | 'cost_efficiency' | 'tool_success' | 'latency' | 'completion_rate';
  score: number;       // 0-100
  weight: number;      // 0-1
  rawValue: number;    // original metric value
  description: string;
}

export type HealthTrend = 'improving' | 'stable' | 'degrading';

/** Health score for a single agent */
export interface HealthScore {
  agentId: string;
  overallScore: number;    // 0-100, weighted sum of dimensions
  trend: HealthTrend;
  trendDelta: number;      // point change from previous window
  dimensions: HealthDimension[];
  window: { from: string; to: string };
  sessionCount: number;
  computedAt: string;
}

/** Configurable weights for health score dimensions */
export interface HealthWeights {
  errorRate: number;        // default 0.30
  costEfficiency: number;   // default 0.20
  toolSuccess: number;      // default 0.20
  latency: number;          // default 0.15
  completionRate: number;   // default 0.15
}

/** Historical health snapshot */
export interface HealthSnapshot {
  agentId: string;
  date: string;
  overallScore: number;
  errorRateScore: number;
  costEfficiencyScore: number;
  toolSuccessScore: number;
  latencyScore: number;
  completionRateScore: number;
  sessionCount: number;
}

// ─── Cost Optimization Types (Epic 6 — Story 2.1) ──────────────────

export type ComplexityTier = 'simple' | 'moderate' | 'complex';
export type ConfidenceLevel = 'low' | 'medium' | 'high';

/** Cost optimization recommendation */
export interface CostRecommendation {
  currentModel: string;
  recommendedModel: string;
  complexityTier: ComplexityTier;
  currentCostPerCall: number;
  recommendedCostPerCall: number;
  monthlySavings: number;
  callVolume: number;
  currentSuccessRate: number;
  recommendedSuccessRate: number;
  confidence: ConfidenceLevel;
  agentId: string;
}

/** Result of optimization analysis */
export interface OptimizationResult {
  recommendations: CostRecommendation[];
  totalPotentialSavings: number;
  period: number;
  analyzedCalls: number;
}

/** Model cost configuration (per 1M tokens) */
export interface ModelCosts {
  [model: string]: { input: number; output: number };
}

// ─── Replay Types (v0.7.0 — Story 1.1) ─────────────────────────────

/**
 * A single step in a replay — one event with its accumulated context.
 */
export interface ReplayStep {
  /** 0-based index in the replay */
  index: number;
  /** The event at this step */
  event: AgentLensEvent;
  /** If this event has a paired event (e.g., tool_call → tool_response) */
  pairedEvent?: AgentLensEvent;
  /** Duration between paired events (ms), if applicable */
  pairDurationMs?: number;
  /** Cumulative context at this point in the session */
  context: ReplayContext;
}

/**
 * Cumulative context at a specific point in the replay.
 */
export interface ReplayContext {
  /** Total events processed so far (including current) */
  eventIndex: number;
  /** Total events in the session */
  totalEvents: number;
  /** Cumulative cost in USD */
  cumulativeCostUsd: number;
  /** Elapsed time from session start (ms) */
  elapsedMs: number;
  /** Counts by event type up to this point */
  eventCounts: Record<string, number>;
  /** LLM conversation history up to this point */
  llmHistory: Array<{
    callId: string;
    provider: string;
    model: string;
    messages: LlmMessage[];
    response?: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    costUsd: number;
    latencyMs: number;
  }>;
  /** Tool call results available at this point */
  toolResults: Array<{
    callId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    result?: unknown;
    error?: string;
    durationMs?: number;
    completed: boolean;
  }>;
  /** Pending approvals at this point */
  pendingApprovals: Array<{
    requestId: string;
    action: string;
    status: 'pending' | 'granted' | 'denied' | 'expired';
  }>;
  /** Error count so far */
  errorCount: number;
  /** Warnings at this point (e.g., high cost, slow tool) */
  warnings: string[];
}

/**
 * Full replay state for a session.
 */
export interface ReplayState {
  /** Session metadata */
  session: Session;
  /** Chain validity of the event sequence */
  chainValid: boolean;
  /** Total steps in the replay */
  totalSteps: number;
  /** Ordered replay steps (may be paginated) */
  steps: ReplayStep[];
  /** Pagination info */
  pagination: {
    offset: number;
    limit: number;
    hasMore: boolean;
  };
  /** Session-level summary */
  summary: ReplaySummary;
}

/**
 * Session-level replay summary.
 */
export interface ReplaySummary {
  totalCost: number;
  totalDurationMs: number;
  totalLlmCalls: number;
  totalToolCalls: number;
  totalErrors: number;
  models: string[];
  tools: string[];
}

// ─── Benchmark Types (v0.7.0 — Story 1.2) ──────────────────────────

/**
 * Benchmark status lifecycle.
 */
export type BenchmarkStatus = 'draft' | 'running' | 'completed' | 'cancelled';

/**
 * Available metrics for benchmark comparison.
 */
export type BenchmarkMetric =
  | 'health_score'
  | 'error_rate'
  | 'avg_cost'
  | 'avg_latency'
  | 'tool_success_rate'
  | 'completion_rate'
  | 'avg_tokens'
  | 'avg_duration';

/**
 * Array of all benchmark metrics for iteration/validation.
 */
export const BENCHMARK_METRICS: readonly BenchmarkMetric[] = [
  'health_score',
  'error_rate',
  'avg_cost',
  'avg_latency',
  'tool_success_rate',
  'completion_rate',
  'avg_tokens',
  'avg_duration',
] as const;

/**
 * A benchmark configuration — the parent entity.
 */
export interface Benchmark {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  status: BenchmarkStatus;
  /** Agent ID if scoped to one agent (optional, can compare across agents) */
  agentId?: string;
  /** Which metrics to compare */
  metrics: BenchmarkMetric[];
  /** Minimum sessions per variant for completion */
  minSessionsPerVariant: number;
  /** Time range filter for sessions (optional) */
  timeRange?: { from: string; to: string };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/**
 * A variant within a benchmark.
 */
export interface BenchmarkVariant {
  id: string;
  benchmarkId: string;
  tenantId: string;
  name: string;
  description?: string;
  /** Tag used to identify sessions belonging to this variant */
  tag: string;
  /** Optional: filter to a specific agent */
  agentId?: string;
  /** Order for display */
  sortOrder: number;
}

/**
 * Statistical summary for a single metric.
 */
export interface MetricStats {
  mean: number;
  median: number;
  stddev: number;
  min: number;
  max: number;
  count: number;
  /** Raw values array (for distribution charts) — only included when requested */
  values?: number[];
}

/**
 * Pairwise comparison result between two variants for one metric.
 */
export interface MetricComparison {
  metric: BenchmarkMetric;
  variantA: { id: string; name: string; stats: MetricStats };
  variantB: { id: string; name: string; stats: MetricStats };
  /** Absolute difference (B.mean - A.mean) */
  absoluteDiff: number;
  /** Percentage difference ((B.mean - A.mean) / A.mean * 100) */
  percentDiff: number;
  /** Statistical test used */
  testType: 'welch_t' | 'chi_squared';
  /** Test statistic value */
  testStatistic: number;
  /** p-value */
  pValue: number;
  /** 95% confidence interval for the difference */
  confidenceInterval: { lower: number; upper: number };
  /** Effect size (Cohen's d or phi coefficient) */
  effectSize: number;
  /** Is the result statistically significant at p < 0.05? */
  significant: boolean;
  /** Which variant is better for this metric */
  winner?: string;
  /** Confidence stars: ★★★ p<0.01, ★★ p<0.05, ★ p<0.1, — ns */
  confidence: '★★★' | '★★' | '★' | '—';
}

/**
 * Aggregated metrics for a single variant.
 */
export interface VariantMetrics {
  variantId: string;
  variantName: string;
  sessionCount: number;
  metrics: Record<BenchmarkMetric, MetricStats>;
}

/**
 * Cached results for a completed benchmark.
 */
export interface BenchmarkResults {
  benchmarkId: string;
  tenantId: string;
  /** Per-variant metric summaries */
  variants: VariantMetrics[];
  /** Pairwise comparisons */
  comparisons: MetricComparison[];
  /** Human-readable summary */
  summary: string;
  /** When results were computed */
  computedAt: string;
}
