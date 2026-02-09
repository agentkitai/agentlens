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
} from '@agentlensai/core';
import type { AnalyticsResult, StorageStats } from '@agentlensai/core';

// ─── Pagination ─────────────────────────────────────────────

export interface PaginatedResult<T> {
  items: T[];
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
