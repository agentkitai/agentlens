import { describe, it, expect } from 'vitest';
import type {
  Session,
  SessionStatus,
  Agent,
  EventQuery,
  EventQueryResult,
  SessionQuery,
  SessionQueryResult,
  AlertRule,
  AlertCondition,
  AlertHistory,
} from '../types.js';

describe('Story 2.2: Session, Agent, and Query Types', () => {
  describe('Session interface', () => {
    it('should include all required fields', () => {
      const session: Session = {
        id: 'sess_abc123',
        agentId: 'agent_main',
        agentName: 'Research Agent',
        startedAt: '2026-02-07T10:00:00Z',
        endedAt: '2026-02-07T10:30:00Z',
        status: 'completed',
        eventCount: 42,
        toolCallCount: 15,
        errorCount: 2,
        totalCostUsd: 0.15,
        tags: ['research', 'production'],
      };

      expect(session.id).toBe('sess_abc123');
      expect(session.agentId).toBe('agent_main');
      expect(session.agentName).toBe('Research Agent');
      expect(session.startedAt).toBe('2026-02-07T10:00:00Z');
      expect(session.endedAt).toBe('2026-02-07T10:30:00Z');
      expect(session.status).toBe('completed');
      expect(session.eventCount).toBe(42);
      expect(session.toolCallCount).toBe(15);
      expect(session.errorCount).toBe(2);
      expect(session.totalCostUsd).toBe(0.15);
      expect(session.tags).toEqual(['research', 'production']);
    });

    it('should allow optional fields to be omitted', () => {
      const session: Session = {
        id: 'sess_abc123',
        agentId: 'agent_main',
        startedAt: '2026-02-07T10:00:00Z',
        status: 'active',
        eventCount: 0,
        toolCallCount: 0,
        errorCount: 0,
        totalCostUsd: 0,
        tags: [],
      };

      expect(session.agentName).toBeUndefined();
      expect(session.endedAt).toBeUndefined();
    });
  });

  describe('SessionStatus', () => {
    it('should include active, completed, and error', () => {
      const statuses: SessionStatus[] = ['active', 'completed', 'error'];
      expect(statuses).toHaveLength(3);
      expect(statuses).toContain('active');
      expect(statuses).toContain('completed');
      expect(statuses).toContain('error');
    });
  });

  describe('Agent interface', () => {
    it('should include all required fields', () => {
      const agent: Agent = {
        id: 'agent_main',
        name: 'Research Agent',
        description: 'An agent for research tasks',
        firstSeenAt: '2026-01-01T00:00:00Z',
        lastSeenAt: '2026-02-07T10:00:00Z',
        sessionCount: 100,
      };

      expect(agent.id).toBe('agent_main');
      expect(agent.name).toBe('Research Agent');
      expect(agent.description).toBe('An agent for research tasks');
      expect(agent.firstSeenAt).toBe('2026-01-01T00:00:00Z');
      expect(agent.lastSeenAt).toBe('2026-02-07T10:00:00Z');
      expect(agent.sessionCount).toBe(100);
    });

    it('should allow optional description', () => {
      const agent: Agent = {
        id: 'agent_main',
        name: 'Research Agent',
        firstSeenAt: '2026-01-01T00:00:00Z',
        lastSeenAt: '2026-02-07T10:00:00Z',
        sessionCount: 100,
      };

      expect(agent.description).toBeUndefined();
    });
  });

  describe('EventQuery interface', () => {
    it('should support all filter fields', () => {
      const query: EventQuery = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'tool_call',
        severity: 'error',
        from: '2026-02-01T00:00:00Z',
        to: '2026-02-07T23:59:59Z',
        limit: 50,
        offset: 0,
        order: 'desc',
        search: 'web_search',
      };

      expect(query.sessionId).toBe('sess_1');
      expect(query.agentId).toBe('agent_1');
      expect(query.eventType).toBe('tool_call');
      expect(query.severity).toBe('error');
      expect(query.from).toBe('2026-02-01T00:00:00Z');
      expect(query.to).toBe('2026-02-07T23:59:59Z');
      expect(query.limit).toBe(50);
      expect(query.offset).toBe(0);
      expect(query.order).toBe('desc');
      expect(query.search).toBe('web_search');
    });

    it('should support array event types and severities', () => {
      const query: EventQuery = {
        eventType: ['tool_call', 'tool_response', 'tool_error'],
        severity: ['error', 'critical'],
      };

      expect(query.eventType).toHaveLength(3);
      expect(query.severity).toHaveLength(2);
    });

    it('should allow empty query (all optional)', () => {
      const query: EventQuery = {};
      expect(Object.keys(query)).toHaveLength(0);
    });
  });

  describe('EventQueryResult interface', () => {
    it('should include events, total, and hasMore', () => {
      const result: EventQueryResult = {
        events: [],
        total: 0,
        hasMore: false,
      };

      expect(result.events).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('SessionQuery interface', () => {
    it('should support all filter fields', () => {
      const query: SessionQuery = {
        agentId: 'agent_1',
        status: 'active',
        from: '2026-02-01T00:00:00Z',
        to: '2026-02-07T23:59:59Z',
        limit: 50,
        offset: 0,
        tags: ['production'],
      };

      expect(query.agentId).toBe('agent_1');
      expect(query.status).toBe('active');
      expect(query.tags).toEqual(['production']);
    });
  });

  describe('SessionQueryResult interface', () => {
    it('should include sessions and total', () => {
      const result: SessionQueryResult = {
        sessions: [],
        total: 0,
      };

      expect(result.sessions).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('AlertRule interface', () => {
    it('should include all required fields', () => {
      const rule: AlertRule = {
        id: 'rule_1',
        name: 'High Error Rate',
        enabled: true,
        condition: 'error_rate_exceeds',
        threshold: 0.1,
        windowMinutes: 60,
        scope: {
          agentId: 'agent_main',
          tags: ['production'],
        },
        notifyChannels: ['https://hooks.slack.com/xxx'],
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-07T10:00:00Z',
      };

      expect(rule.id).toBe('rule_1');
      expect(rule.name).toBe('High Error Rate');
      expect(rule.enabled).toBe(true);
      expect(rule.condition).toBe('error_rate_exceeds');
      expect(rule.threshold).toBe(0.1);
      expect(rule.windowMinutes).toBe(60);
      expect(rule.scope.agentId).toBe('agent_main');
      expect(rule.notifyChannels).toHaveLength(1);
    });
  });

  describe('AlertCondition type', () => {
    it('should include all condition types', () => {
      const conditions: AlertCondition[] = [
        'error_rate_exceeds',
        'cost_exceeds',
        'latency_exceeds',
        'event_count_exceeds',
        'no_events_for',
      ];
      expect(conditions).toHaveLength(5);
    });
  });

  describe('AlertHistory interface', () => {
    it('should include all required fields', () => {
      const history: AlertHistory = {
        id: 'alert_hist_1',
        ruleId: 'rule_1',
        triggeredAt: '2026-02-07T10:00:00Z',
        resolvedAt: '2026-02-07T10:15:00Z',
        currentValue: 0.15,
        threshold: 0.1,
        message: 'Error rate exceeded threshold',
      };

      expect(history.id).toBe('alert_hist_1');
      expect(history.ruleId).toBe('rule_1');
      expect(history.triggeredAt).toBe('2026-02-07T10:00:00Z');
      expect(history.resolvedAt).toBe('2026-02-07T10:15:00Z');
      expect(history.currentValue).toBe(0.15);
      expect(history.threshold).toBe(0.1);
      expect(history.message).toBe('Error rate exceeded threshold');
    });

    it('should allow optional resolvedAt', () => {
      const history: AlertHistory = {
        id: 'alert_hist_1',
        ruleId: 'rule_1',
        triggeredAt: '2026-02-07T10:00:00Z',
        currentValue: 0.15,
        threshold: 0.1,
        message: 'Error rate exceeded threshold',
      };

      expect(history.resolvedAt).toBeUndefined();
    });
  });
});
