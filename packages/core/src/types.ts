/**
 * @agentlens/core — Core Event Types and Interfaces
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
  tags: string[];
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
}

export interface EventQueryResult {
  events: AgentLensEvent[];
  total: number;
  hasMore: boolean;
}

export interface SessionQuery {
  agentId?: string;
  status?: SessionStatus;
  from?: Timestamp;
  to?: Timestamp;
  limit?: number;
  offset?: number;
  tags?: string[];
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
}

export interface AlertHistory {
  id: string;
  ruleId: string;
  triggeredAt: Timestamp;
  resolvedAt?: Timestamp;
  currentValue: number;
  threshold: number;
  message: string;
}
