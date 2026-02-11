/**
 * SQLite implementation of IEventStore — thin facade.
 *
 * Delegates to focused repository classes (Story S-7.5):
 * - EventRepository — event CRUD
 * - SessionRepository — session CRUD
 * - AgentRepository — agent CRUD
 * - AlertRepository — alert rules + history
 * - AnalyticsRepository — analytics and stats
 * - RetentionService — data retention/cleanup
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
import type { SqliteDb } from './index.js';
import { EventRepository } from './repositories/event-repository.js';
import { SessionRepository } from './repositories/session-repository.js';
import { AgentRepository } from './repositories/agent-repository.js';
import { AlertRepository } from './repositories/alert-repository.js';
import { AnalyticsRepository } from './repositories/analytics-repository.js';
import { RetentionService } from './services/retention-service.js';

// Re-export for backward compatibility
export { safeJsonParse } from './shared/query-helpers.js';

export class SqliteEventStore implements IEventStore {
  private eventRepo: EventRepository;
  private sessionRepo: SessionRepository;
  private agentRepo: AgentRepository;
  private alertRepo: AlertRepository;
  private analyticsRepo: AnalyticsRepository;
  private retentionService: RetentionService;

  constructor(private db: SqliteDb) {
    this.eventRepo = new EventRepository(db);
    this.sessionRepo = new SessionRepository(db);
    this.agentRepo = new AgentRepository(db);
    this.alertRepo = new AlertRepository(db);
    this.analyticsRepo = new AnalyticsRepository(db);
    this.retentionService = new RetentionService(db);
  }

  // ─── Events ────────────────────────────────────────────────

  async insertEvents(eventList: AgentLensEvent[]): Promise<void> {
    this.eventRepo.insertEvents(
      eventList,
      (tx, event, tenantId) => this.sessionRepo.handleSessionUpdate(tx, event, tenantId),
      (tx, event, tenantId) => this.agentRepo.handleAgentUpsert(tx, event, tenantId),
    );
  }

  async queryEvents(query: EventQuery): Promise<EventQueryResult> {
    return this.eventRepo.queryEvents(query);
  }

  async getEvent(id: string, tenantId?: string): Promise<AgentLensEvent | null> {
    return this.eventRepo.getEvent(id, tenantId);
  }

  async getSessionTimeline(sessionId: string, tenantId?: string): Promise<AgentLensEvent[]> {
    return this.eventRepo.getSessionTimeline(sessionId, tenantId);
  }

  async getLastEventHash(sessionId: string, tenantId?: string): Promise<string | null> {
    return this.eventRepo.getLastEventHash(sessionId, tenantId);
  }

  async countEvents(query: Omit<EventQuery, 'limit' | 'offset'>): Promise<number> {
    return this.eventRepo.countEvents(query);
  }

  async countEventsBatch(
    query: { agentId: string; from: string; to: string; tenantId?: string },
  ): Promise<{ total: number; error: number; critical: number; toolError: number }> {
    return this.eventRepo.countEventsBatch(query);
  }

  // ─── Sessions ──────────────────────────────────────────────

  async upsertSession(session: Partial<Session> & { id: string }): Promise<void> {
    return this.sessionRepo.upsertSession(session);
  }

  async querySessions(query: SessionQuery): Promise<{ sessions: Session[]; total: number }> {
    return this.sessionRepo.querySessions(query);
  }

  async getSession(id: string, tenantId?: string): Promise<Session | null> {
    return this.sessionRepo.getSession(id, tenantId);
  }

  async sumSessionCost(
    query: { agentId: string; from: string; tenantId?: string },
  ): Promise<number> {
    return this.sessionRepo.sumSessionCost(query);
  }

  // ─── Agents ────────────────────────────────────────────────

  async upsertAgent(agent: Partial<Agent> & { id: string }): Promise<void> {
    return this.agentRepo.upsertAgent(agent);
  }

  async pauseAgent(tenantId: string, agentId: string, reason: string): Promise<boolean> {
    return this.agentRepo.pauseAgent(tenantId, agentId, reason);
  }

  async unpauseAgent(tenantId: string, agentId: string, clearModelOverride?: boolean): Promise<boolean> {
    return this.agentRepo.unpauseAgent(tenantId, agentId, clearModelOverride);
  }

  async setModelOverride(tenantId: string, agentId: string, model: string): Promise<boolean> {
    return this.agentRepo.setModelOverride(tenantId, agentId, model);
  }

  async listAgents(tenantId?: string): Promise<Agent[]> {
    return this.agentRepo.listAgents(tenantId);
  }

  async getAgent(id: string, tenantId?: string): Promise<Agent | null> {
    return this.agentRepo.getAgent(id, tenantId);
  }

  // ─── Alerts ────────────────────────────────────────────────

  async createAlertRule(rule: AlertRule): Promise<void> {
    return this.alertRepo.createAlertRule(rule);
  }

  async updateAlertRule(id: string, updates: Partial<AlertRule>, tenantId?: string): Promise<void> {
    return this.alertRepo.updateAlertRule(id, updates, tenantId);
  }

  async deleteAlertRule(id: string, tenantId?: string): Promise<void> {
    return this.alertRepo.deleteAlertRule(id, tenantId);
  }

  async listAlertRules(tenantId?: string): Promise<AlertRule[]> {
    return this.alertRepo.listAlertRules(tenantId);
  }

  async getAlertRule(id: string, tenantId?: string): Promise<AlertRule | null> {
    return this.alertRepo.getAlertRule(id, tenantId);
  }

  async insertAlertHistory(entry: AlertHistory): Promise<void> {
    return this.alertRepo.insertAlertHistory(entry);
  }

  async listAlertHistory(opts?: {
    ruleId?: string;
    limit?: number;
    offset?: number;
    tenantId?: string;
  }): Promise<{ entries: AlertHistory[]; total: number }> {
    return this.alertRepo.listAlertHistory(opts);
  }

  // ─── Analytics & Stats ─────────────────────────────────────

  async getAnalytics(params: {
    from: string;
    to: string;
    agentId?: string;
    granularity: 'hour' | 'day' | 'week';
    tenantId?: string;
  }): Promise<AnalyticsResult> {
    return this.analyticsRepo.getAnalytics(params);
  }

  async getStats(tenantId?: string): Promise<StorageStats> {
    return this.analyticsRepo.getStats(tenantId);
  }

  // ─── Maintenance ───────────────────────────────────────────

  async applyRetention(
    olderThan: string,
    tenantId?: string,
  ): Promise<{ deletedCount: number }> {
    return this.retentionService.applyRetention(olderThan, tenantId);
  }
}
