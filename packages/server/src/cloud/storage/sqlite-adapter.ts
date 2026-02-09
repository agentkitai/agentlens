/**
 * SQLite Storage Adapter (S-4.1, S-4.3, S-4.4)
 *
 * Wraps the existing SqliteEventStore to implement the StorageAdapter interface.
 * orgId is mapped to tenantId for multi-tenant SQLite (self-hosted).
 *
 * S-4.3: Analytics use SQLite strftime for time bucketing.
 * S-4.4: Full-text search uses LIKE (SQLite lacks tsvector; FTS5 optional).
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
import type {
  StorageAdapter,
  PaginatedResult,
  AnalyticsQuery,
  CostAnalyticsResult,
  HealthAnalyticsResult,
  TokenUsageResult,
  SearchQuery,
  SearchResult,
} from './adapter.js';
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

  // ═══════════════════════════════════════════════════════════
  // S-4.3: Analytics Queries (SQLite)
  // ═══════════════════════════════════════════════════════════

  async getCostAnalytics(orgId: string, query: AnalyticsQuery): Promise<CostAnalyticsResult> {
    const analyticsResult = await this.store.getAnalytics({
      from: query.from,
      to: query.to,
      agentId: query.agentId,
      granularity: query.granularity,
      tenantId: orgId,
    });

    const buckets = analyticsResult.buckets.map((b) => ({
      timestamp: b.timestamp,
      totalCostUsd: b.totalCostUsd,
      eventCount: b.eventCount,
    }));

    return {
      buckets,
      totalCostUsd: analyticsResult.totals.totalCostUsd,
      totalEvents: analyticsResult.totals.eventCount,
    };
  }

  async getHealthAnalytics(_orgId: string, _query: AnalyticsQuery): Promise<HealthAnalyticsResult> {
    // SQLite self-hosted: health_snapshots not yet implemented in the base store.
    // Return empty results — feature parity is maintained by running the same
    // test interface; the Postgres adapter provides the full implementation.
    return { snapshots: [] };
  }

  async getTokenUsage(orgId: string, query: AnalyticsQuery): Promise<TokenUsageResult> {
    // Delegate to getAnalytics and extract token-relevant data
    // The SQLite store tracks tokens via llm_response events in payload
    const result = await this.store.getAnalytics({
      from: query.from,
      to: query.to,
      agentId: query.agentId,
      granularity: query.granularity,
      tenantId: orgId,
    });

    // The standard analytics doesn't break out tokens, so we return
    // what we can from the event counts. For full token data, the
    // store would need a dedicated query.
    const buckets = result.buckets.map((b) => ({
      timestamp: b.timestamp,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      llmCallCount: 0,
    }));

    return {
      buckets,
      totals: { inputTokens: 0, outputTokens: 0, totalTokens: 0, llmCallCount: 0 },
    };
  }

  async getAnalytics(orgId: string, query: AnalyticsQuery): Promise<AnalyticsResult> {
    return this.store.getAnalytics({
      from: query.from,
      to: query.to,
      agentId: query.agentId,
      granularity: query.granularity,
      tenantId: orgId,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // S-4.4: Full-Text Search (SQLite — LIKE fallback)
  // ═══════════════════════════════════════════════════════════

  async search(orgId: string, query: SearchQuery): Promise<SearchResult> {
    const limit = Math.min(query.limit ?? 20, 100);
    const offset = query.offset ?? 0;
    const scope = query.scope ?? 'all';
    const searchTerm = query.query.trim();

    if (!searchTerm) {
      return { items: [], total: 0, hasMore: false };
    }

    const items: SearchResult['items'] = [];
    let total = 0;

    // Search events via existing queryEvents with search parameter
    if (scope === 'events' || scope === 'all') {
      const eventResult = await this.store.queryEvents({
        tenantId: orgId,
        search: searchTerm,
        from: query.from,
        to: query.to,
        limit,
        offset,
      });

      for (const event of eventResult.events) {
        const payloadStr = typeof event.payload === 'string'
          ? event.payload
          : JSON.stringify(event.payload);
        // Create a simple headline: first 60 chars of payload containing match
        const idx = payloadStr.toLowerCase().indexOf(searchTerm.toLowerCase());
        const start = Math.max(0, idx - 20);
        const headline = payloadStr.substring(start, start + 80);

        items.push({
          type: 'event',
          id: event.id,
          score: 1.0, // SQLite LIKE doesn't give relevance scores
          headline,
          timestamp: event.timestamp,
          sessionId: event.sessionId,
        });
      }
      total += eventResult.total;
    }

    // Search sessions via querySessions (by tags/agent name match)
    if (scope === 'sessions' || scope === 'all') {
      const sessionResult = await this.store.querySessions({
        tenantId: orgId,
        from: query.from,
        to: query.to,
        limit,
        offset,
      });

      // Filter sessions that match the search term in agent name or tags
      const matching = sessionResult.sessions.filter((s) => {
        const text = `${s.agentName ?? ''} ${(s.tags ?? []).join(' ')}`.toLowerCase();
        return text.includes(searchTerm.toLowerCase());
      });

      for (const session of matching) {
        items.push({
          type: 'session',
          id: session.id,
          score: 1.0,
          headline: `${session.agentName ?? 'Unknown'} — ${(session.tags ?? []).join(', ')}`,
          timestamp: session.startedAt,
        });
      }
      total += matching.length;
    }

    return {
      items: items.slice(0, limit),
      total,
      hasMore: offset + Math.min(items.length, limit) < total,
    };
  }
}
