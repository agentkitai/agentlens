/**
 * @agentlensai/core — Storage Interface
 *
 * Defines the IEventStore interface that all storage backends implement.
 * This enables pluggable storage (SQLite, PostgreSQL, in-memory for tests)
 * and clean mock testing.
 */

import type {
  AgentLensEvent,
  EventQuery,
  EventQueryResult,
  Session,
  SessionQuery,
  Agent,
  AlertRule,
  AlertHistory,
} from './types.js';

/**
 * Analytics result with time-bucketed metrics and totals.
 */
export interface AnalyticsResult {
  buckets: Array<{
    timestamp: string;
    eventCount: number;
    toolCallCount: number;
    errorCount: number;
    avgLatencyMs: number;
    totalCostUsd: number;
    uniqueSessions: number;
  }>;
  totals: {
    eventCount: number;
    toolCallCount: number;
    errorCount: number;
    avgLatencyMs: number;
    totalCostUsd: number;
    uniqueSessions: number;
    uniqueAgents: number;
  };
}

/**
 * Storage statistics for monitoring and the /api/stats endpoint.
 */
export interface StorageStats {
  totalEvents: number;
  totalSessions: number;
  totalAgents: number;
  oldestEvent?: string;
  newestEvent?: string;
  storageSizeBytes?: number;
}

/**
 * Core storage interface — all backends implement this.
 *
 * Methods are grouped by domain:
 * - Events: insert, query, get, timeline, count
 * - Sessions: upsert, query, get
 * - Agents: upsert, list, get
 * - Analytics: aggregated metrics
 * - Alert Rules: CRUD
 * - Maintenance: retention, stats
 */
export interface IEventStore {
  // ─── Events ──────────────────────────────────────────────
  /** Persist one or more events (already validated & hashed) */
  insertEvents(events: AgentLensEvent[]): Promise<void>;
  /** Query events with filters */
  queryEvents(query: EventQuery): Promise<EventQueryResult>;
  /** Get a single event by ID */
  getEvent(id: string): Promise<AgentLensEvent | null>;
  /** Get all events in a session, ordered by timestamp ascending */
  getSessionTimeline(sessionId: string): Promise<AgentLensEvent[]>;
  /** Get the hash of the last event in a session (for chain continuation) */
  getLastEventHash(sessionId: string): Promise<string | null>;
  /** Count events matching a query (for pagination) */
  countEvents(query: Omit<EventQuery, 'limit' | 'offset'>): Promise<number>;
  /** Batch count events by category in a single query */
  countEventsBatch(query: { agentId: string; from: string; to: string; tenantId?: string }): Promise<{ total: number; error: number; critical: number; toolError: number }>;
  /** Sum totalCostUsd for sessions matching filters */
  sumSessionCost(query: { agentId: string; from: string; tenantId?: string }): Promise<number>;

  // ─── Sessions ────────────────────────────────────────────
  /** Upsert session (materialized from events) */
  upsertSession(session: Partial<Session> & { id: string }): Promise<void>;
  /** Query sessions */
  querySessions(query: SessionQuery): Promise<{ sessions: Session[]; total: number }>;
  /** Get a single session by ID */
  getSession(id: string): Promise<Session | null>;

  // ─── Agents ──────────────────────────────────────────────
  /** Upsert agent (materialized from events) */
  upsertAgent(agent: Partial<Agent> & { id: string }): Promise<void>;
  /** List all agents */
  listAgents(): Promise<Agent[]>;
  /** Get agent by ID */
  getAgent(id: string): Promise<Agent | null>;

  // ─── Analytics ───────────────────────────────────────────
  /** Get aggregated metrics for a time range */
  getAnalytics(params: {
    from: string;
    to: string;
    agentId?: string;
    granularity: 'hour' | 'day' | 'week';
  }): Promise<AnalyticsResult>;

  // ─── Alert Rules ─────────────────────────────────────────
  /** Create a new alert rule */
  createAlertRule(rule: AlertRule): Promise<void>;
  /** Update an existing alert rule */
  updateAlertRule(id: string, updates: Partial<AlertRule>): Promise<void>;
  /** Delete an alert rule */
  deleteAlertRule(id: string): Promise<void>;
  /** List all alert rules */
  listAlertRules(): Promise<AlertRule[]>;
  /** Get a single alert rule by ID */
  getAlertRule(id: string): Promise<AlertRule | null>;

  // ─── Alert History ───────────────────────────────────────
  /** Insert an alert history record */
  insertAlertHistory(entry: AlertHistory): Promise<void>;
  /** List alert history with optional filters */
  listAlertHistory(opts?: { ruleId?: string; limit?: number; offset?: number }): Promise<{ entries: AlertHistory[]; total: number }>;

  // ─── Maintenance ─────────────────────────────────────────
  /** Apply retention policy — delete events older than given date */
  applyRetention(olderThan: string): Promise<{ deletedCount: number }>;
  /** Get storage statistics */
  getStats(): Promise<StorageStats>;
}
