/**
 * @agentlens/core — Core Types
 *
 * Stub types for Epic 3 (Event Storage Layer).
 * These will be fully fleshed out by Epic 2 (Core Types & Validation).
 */

/** Unique identifier (ULID for time-sortability) */
export type EventId = string;

/** ISO 8601 timestamp string */
export type Timestamp = string;

/** All supported event types */
export type EventType =
  | 'session_started'
  | 'session_ended'
  | 'tool_call'
  | 'tool_response'
  | 'tool_error'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_denied'
  | 'approval_expired'
  | 'form_submitted'
  | 'form_completed'
  | 'form_expired'
  | 'cost_tracked'
  | 'alert_triggered'
  | 'alert_resolved'
  | 'custom';

/** Severity levels for events */
export type EventSeverity = 'debug' | 'info' | 'warn' | 'error' | 'critical';

/** The core event record — the fundamental unit of data in AgentLens */
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
  /** Event-type-specific payload */
  payload: Record<string, unknown>;
  /** Arbitrary metadata (tags, labels, correlation IDs) */
  metadata: Record<string, unknown>;
  /** SHA-256 hash of previous event in session (hash chain) */
  prevHash: string | null;
  /** SHA-256 hash of this event (computed on ingest) */
  hash: string;
}

/** Agent session — materialized from session_started/session_ended events */
export interface Session {
  id: string;
  agentId: string;
  agentName?: string;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  status: 'active' | 'completed' | 'error';
  eventCount: number;
  toolCallCount: number;
  errorCount: number;
  totalCostUsd: number;
  tags: string[];
}

/** Registered agent */
export interface Agent {
  id: string;
  name: string;
  description?: string;
  firstSeenAt: Timestamp;
  lastSeenAt: Timestamp;
  sessionCount: number;
}

/** Query parameters for events */
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

/** Result of an event query */
export interface EventQueryResult {
  events: AgentLensEvent[];
  total: number;
  hasMore: boolean;
}

/** Query parameters for sessions */
export interface SessionQuery {
  agentId?: string;
  status?: Session['status'];
  from?: Timestamp;
  to?: Timestamp;
  limit?: number;
  offset?: number;
  tags?: string[];
}

/** Alert condition types */
export type AlertCondition =
  | 'error_rate_exceeds'
  | 'cost_exceeds'
  | 'latency_exceeds'
  | 'event_count_exceeds'
  | 'no_events_for';

/** Alert rule configuration */
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
