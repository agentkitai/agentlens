/**
 * Storage Adapter Interface (S-4.1)
 *
 * Abstracts over SQLite (self-hosted) and PostgreSQL (cloud) backends.
 * All query functions go through this adapter. Feature parity is guaranteed
 * by running the same test suite against both implementations.
 *
 * The adapter is tenant-aware: orgId is required on all operations.
 * For SQLite self-hosted, orgId maps to tenantId. For Postgres, RLS
 * enforces isolation via SET LOCAL app.current_org.
 */

import type {
  AgentLensEvent,
  EventQuery,
  EventQueryResult,
  Session,
  SessionQuery,
  Agent,
  HealthSnapshot,
} from '@agentlensai/core';
import type { AnalyticsResult, StorageStats } from '@agentlensai/core';

// ─── Pagination ─────────────────────────────────────────────

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

// ─── Analytics Types (S-4.3) ────────────────────────────────

export interface AnalyticsQuery {
  from: string;
  to: string;
  agentId?: string;
  granularity: 'hour' | 'day' | 'week';
}

export interface CostAnalyticsResult {
  buckets: Array<{
    timestamp: string;
    totalCostUsd: number;
    eventCount: number;
    model?: string;
  }>;
  totalCostUsd: number;
  totalEvents: number;
}

export interface HealthAnalyticsResult {
  snapshots: HealthSnapshot[];
}

export interface TokenUsageResult {
  buckets: Array<{
    timestamp: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    llmCallCount: number;
  }>;
  totals: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    llmCallCount: number;
  };
}

// ─── Search Types (S-4.4) ───────────────────────────────────

export interface SearchQuery {
  query: string;
  scope?: 'events' | 'sessions' | 'all';
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  items: Array<{
    type: 'event' | 'session';
    id: string;
    score: number;
    headline: string;
    timestamp: string;
    sessionId?: string;
  }>;
  total: number;
  hasMore: boolean;
}

// ─── Storage Adapter Interface ──────────────────────────────

export interface StorageAdapter {
  // ─── Events ────────────────────────────────────────────
  /** Query events with filters, scoped to org */
  queryEvents(orgId: string, query: EventQuery): Promise<EventQueryResult>;
  /** Get all events for a session, ordered by timestamp */
  getEventsBySession(orgId: string, sessionId: string): Promise<AgentLensEvent[]>;

  // ─── Sessions ──────────────────────────────────────────
  /** List sessions with filters and pagination */
  getSessions(orgId: string, query: SessionQuery): Promise<PaginatedResult<Session>>;
  /** Get a single session by ID */
  getSession(orgId: string, sessionId: string): Promise<Session | null>;

  // ─── Agents ────────────────────────────────────────────
  /** List all agents for an org */
  getAgents(orgId: string): Promise<Agent[]>;

  // ─── Stats ─────────────────────────────────────────────
  /** Get storage statistics for an org */
  getStats(orgId: string): Promise<StorageStats>;

  // ─── Analytics (S-4.3) ────────────────────────────────
  /** Cost analytics with time-bucketed aggregation */
  getCostAnalytics(orgId: string, query: AnalyticsQuery): Promise<CostAnalyticsResult>;
  /** Health score analytics over time */
  getHealthAnalytics(orgId: string, query: AnalyticsQuery): Promise<HealthAnalyticsResult>;
  /** Token usage analytics with time-bucketed aggregation */
  getTokenUsage(orgId: string, query: AnalyticsQuery): Promise<TokenUsageResult>;
  /** General analytics (buckets + totals) */
  getAnalytics(orgId: string, query: AnalyticsQuery): Promise<AnalyticsResult>;

  // ─── Search (S-4.4) ──────────────────────────────────
  /** Full-text search across events and sessions */
  search(orgId: string, query: SearchQuery): Promise<SearchResult>;
}

// ─── Factory ────────────────────────────────────────────────

export type StorageBackend = 'sqlite' | 'postgres';

/**
 * Determine the active storage backend from environment.
 */
export function getStorageBackend(): StorageBackend {
  const backend = process.env['STORAGE_BACKEND'] ?? process.env['DB_DIALECT'] ?? 'sqlite';
  if (backend === 'postgresql' || backend === 'postgres') return 'postgres';
  return 'sqlite';
}
