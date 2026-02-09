/**
 * SQLite Storage Adapter (S-4.1)
 *
 * Wraps the existing SqliteEventStore to implement the StorageAdapter interface.
 * orgId is mapped to tenantId for multi-tenant SQLite (self-hosted).
 */

import type {
  AgentLensEvent,
  EventQuery,
  EventQueryResult,
  Session,
  SessionQuery,
  Agent,
} from '@agentlensai/core';
import type { StorageStats } from '@agentlensai/core';
import type { StorageAdapter, PaginatedResult } from './adapter.js';
import type { SqliteEventStore } from '../../db/sqlite-store.js';

export class SqliteStorageAdapter implements StorageAdapter {
  constructor(private readonly store: SqliteEventStore) {}

  async queryEvents(orgId: string, query: EventQuery): Promise<EventQueryResult> {
    return this.store.queryEvents({ ...query, tenantId: orgId });
  }

  async getEventsBySession(orgId: string, sessionId: string): Promise<AgentLensEvent[]> {
    return this.store.getSessionTimeline(sessionId, orgId);
  }

  async getSessions(orgId: string, query: SessionQuery): Promise<PaginatedResult<Session>> {
    const result = await this.store.querySessions({ ...query, tenantId: orgId });
    const limit = Math.min(query.limit ?? 50, 500);
    const offset = query.offset ?? 0;
    return {
      items: result.sessions,
      total: result.total,
      hasMore: offset + result.sessions.length < result.total,
    };
  }

  async getSession(orgId: string, sessionId: string): Promise<Session | null> {
    return this.store.getSession(sessionId, orgId);
  }

  async getAgents(orgId: string): Promise<Agent[]> {
    return this.store.listAgents(orgId);
  }

  async getStats(orgId: string): Promise<StorageStats> {
    return this.store.getStats(orgId);
  }
}
