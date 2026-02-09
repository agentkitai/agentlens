/**
 * Tenant-Scoped Event Store Wrapper (Story 1.3)
 *
 * Wraps a SqliteEventStore and injects `tenantId` into every operation.
 * Created per-request in route handlers to enforce tenant isolation.
 *
 * All queries and writes go through this wrapper, ensuring that
 * a tenant can never access another tenant's data.
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
} from '@agentlensai/core';
import type { IEventStore, AnalyticsResult, StorageStats } from '@agentlensai/core';
import type { SqliteEventStore } from './sqlite-store.js';

export class TenantScopedStore implements IEventStore {
  constructor(
    private readonly inner: SqliteEventStore,
    public readonly tenantId: string,
  ) {}

  // ─── Events ──────────────────────────────────────────────

  async insertEvents(eventList: AgentLensEvent[]): Promise<void> {
    // Stamp every event with this tenant's ID
    const stamped = eventList.map((e) => ({ ...e, tenantId: this.tenantId }));
    return this.inner.insertEvents(stamped);
  }

  async queryEvents(query: EventQuery): Promise<EventQueryResult> {
    return this.inner.queryEvents({ ...query, tenantId: this.tenantId });
  }

  async getEvent(id: string): Promise<AgentLensEvent | null> {
    return this.inner.getEvent(id, this.tenantId);
  }

  async getSessionTimeline(sessionId: string): Promise<AgentLensEvent[]> {
    return this.inner.getSessionTimeline(sessionId, this.tenantId);
  }

  async getLastEventHash(sessionId: string): Promise<string | null> {
    return this.inner.getLastEventHash(sessionId, this.tenantId);
  }

  async countEvents(query: Omit<EventQuery, 'limit' | 'offset'>): Promise<number> {
    return this.inner.countEvents({ ...query, tenantId: this.tenantId });
  }

  // ─── Sessions ────────────────────────────────────────────

  async upsertSession(session: Partial<Session> & { id: string }): Promise<void> {
    return this.inner.upsertSession({ ...session, tenantId: this.tenantId });
  }

  async querySessions(query: SessionQuery): Promise<{ sessions: Session[]; total: number }> {
    return this.inner.querySessions({ ...query, tenantId: this.tenantId });
  }

  async getSession(id: string): Promise<Session | null> {
    return this.inner.getSession(id, this.tenantId);
  }

  // ─── Agents ──────────────────────────────────────────────

  async upsertAgent(agent: Partial<Agent> & { id: string }): Promise<void> {
    return this.inner.upsertAgent({ ...agent, tenantId: this.tenantId });
  }

  async listAgents(): Promise<Agent[]> {
    return this.inner.listAgents(this.tenantId);
  }

  async getAgent(id: string): Promise<Agent | null> {
    return this.inner.getAgent(id, this.tenantId);
  }

  async unpauseAgent(agentId: string, clearModelOverride: boolean): Promise<boolean> {
    return this.inner.unpauseAgent(this.tenantId, agentId, clearModelOverride);
  }

  // ─── Analytics ───────────────────────────────────────────

  async getAnalytics(params: {
    from: string;
    to: string;
    agentId?: string;
    granularity: 'hour' | 'day' | 'week';
  }): Promise<AnalyticsResult> {
    return this.inner.getAnalytics({ ...params, tenantId: this.tenantId });
  }

  // ─── Alert Rules ─────────────────────────────────────────

  async createAlertRule(rule: AlertRule): Promise<void> {
    return this.inner.createAlertRule({ ...rule, tenantId: this.tenantId });
  }

  async updateAlertRule(id: string, updates: Partial<AlertRule>): Promise<void> {
    return this.inner.updateAlertRule(id, updates, this.tenantId);
  }

  async deleteAlertRule(id: string): Promise<void> {
    return this.inner.deleteAlertRule(id, this.tenantId);
  }

  async listAlertRules(): Promise<AlertRule[]> {
    return this.inner.listAlertRules(this.tenantId);
  }

  async getAlertRule(id: string): Promise<AlertRule | null> {
    return this.inner.getAlertRule(id, this.tenantId);
  }

  // ─── Alert History ───────────────────────────────────────

  async insertAlertHistory(entry: AlertHistory): Promise<void> {
    return this.inner.insertAlertHistory({ ...entry, tenantId: this.tenantId });
  }

  async listAlertHistory(opts?: {
    ruleId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: AlertHistory[]; total: number }> {
    return this.inner.listAlertHistory({ ...opts, tenantId: this.tenantId });
  }

  // ─── Maintenance ─────────────────────────────────────────

  async applyRetention(olderThan: string): Promise<{ deletedCount: number }> {
    // Retention is scoped to this tenant — only deletes this tenant's old data
    return this.inner.applyRetention(olderThan, this.tenantId);
  }

  async getStats(): Promise<StorageStats> {
    return this.inner.getStats(this.tenantId);
  }
}
