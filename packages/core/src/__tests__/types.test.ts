import { describe, it, expect } from 'vitest';
import type {
  EventId,
  Timestamp,
  EventType,
  EventSeverity,
  AgentLensEvent,
  ToolCallPayload,
  ToolResponsePayload,
  ToolErrorPayload,
  SessionStartedPayload,
  SessionEndedPayload,
  ApprovalRequestedPayload,
  ApprovalDecisionPayload,
  FormSubmittedPayload,
  FormCompletedPayload,
  FormExpiredPayload,
  CostTrackedPayload,
  AlertTriggeredPayload,
  AlertResolvedPayload,
  CustomPayload,
} from '../types.js';
import { EVENT_TYPES, EVENT_SEVERITIES } from '../types.js';

describe('Story 2.1: Core Event Types and Interfaces', () => {
  describe('EventType union', () => {
    it('should include all 18 event types', () => {
      expect(EVENT_TYPES).toHaveLength(18);

      const expectedTypes: EventType[] = [
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
        'llm_call',
        'llm_response',
        'alert_triggered',
        'alert_resolved',
        'custom',
      ];

      for (const t of expectedTypes) {
        expect(EVENT_TYPES).toContain(t);
      }
    });
  });

  describe('EventSeverity union', () => {
    it('should include all 5 severity levels', () => {
      expect(EVENT_SEVERITIES).toHaveLength(5);

      const expectedSeverities: EventSeverity[] = ['debug', 'info', 'warn', 'error', 'critical'];

      for (const s of expectedSeverities) {
        expect(EVENT_SEVERITIES).toContain(s);
      }
    });
  });

  describe('AgentLensEvent interface', () => {
    it('should include all required fields', () => {
      const event: AgentLensEvent = {
        id: '01HXY0001' as EventId,
        timestamp: '2026-02-07T10:00:00Z' as Timestamp,
        sessionId: 'sess_abc123',
        agentId: 'agent_main',
        eventType: 'tool_call',
        severity: 'info',
        payload: {
          toolName: 'web_search',
          arguments: { query: 'test' },
          callId: 'call_1',
        } satisfies ToolCallPayload,
        metadata: { source: 'mcp' },
        prevHash: null,
        hash: 'abc123def456',
        tenantId: 'default',
      };

      expect(event.id).toBe('01HXY0001');
      expect(event.timestamp).toBe('2026-02-07T10:00:00Z');
      expect(event.sessionId).toBe('sess_abc123');
      expect(event.agentId).toBe('agent_main');
      expect(event.eventType).toBe('tool_call');
      expect(event.severity).toBe('info');
      expect(event.payload).toBeDefined();
      expect(event.metadata).toEqual({ source: 'mcp' });
      expect(event.prevHash).toBeNull();
      expect(event.hash).toBe('abc123def456');
    });
  });

  describe('Typed Payloads', () => {
    it('should type-check ToolCallPayload correctly', () => {
      const payload: ToolCallPayload = {
        toolName: 'web_search',
        arguments: { query: 'test' },
        callId: 'call_1',
        serverName: 'search-server',
      };
      expect(payload.toolName).toBe('web_search');
      expect(payload.callId).toBe('call_1');
    });

    it('should type-check ToolResponsePayload correctly', () => {
      const payload: ToolResponsePayload = {
        callId: 'call_1',
        toolName: 'web_search',
        result: { items: [] },
        durationMs: 150,
      };
      expect(payload.durationMs).toBe(150);
    });

    it('should type-check ToolErrorPayload correctly', () => {
      const payload: ToolErrorPayload = {
        callId: 'call_1',
        toolName: 'web_search',
        error: 'Network timeout',
        errorCode: 'TIMEOUT',
        durationMs: 5000,
      };
      expect(payload.error).toBe('Network timeout');
    });

    it('should type-check SessionStartedPayload correctly', () => {
      const payload: SessionStartedPayload = {
        agentName: 'Research Agent',
        agentVersion: '1.0.0',
        tags: ['research'],
      };
      expect(payload.agentName).toBe('Research Agent');
    });

    it('should type-check SessionEndedPayload correctly', () => {
      const payload: SessionEndedPayload = {
        reason: 'completed',
        summary: 'Finished research',
        totalToolCalls: 10,
        totalDurationMs: 30000,
      };
      expect(payload.reason).toBe('completed');
    });

    it('should type-check ApprovalRequestedPayload correctly', () => {
      const payload: ApprovalRequestedPayload = {
        requestId: 'req_1',
        action: 'delete_file',
        params: { path: '/tmp/test' },
        urgency: 'high',
      };
      expect(payload.requestId).toBe('req_1');
    });

    it('should type-check ApprovalDecisionPayload correctly', () => {
      const payload: ApprovalDecisionPayload = {
        requestId: 'req_1',
        action: 'delete_file',
        decidedBy: 'admin',
        reason: 'Approved after review',
      };
      expect(payload.decidedBy).toBe('admin');
    });

    it('should type-check FormSubmittedPayload correctly', () => {
      const payload: FormSubmittedPayload = {
        submissionId: 'sub_1',
        formId: 'form_1',
        formName: 'Contact Form',
        fieldCount: 5,
      };
      expect(payload.fieldCount).toBe(5);
    });

    it('should type-check FormCompletedPayload correctly', () => {
      const payload: FormCompletedPayload = {
        submissionId: 'sub_1',
        formId: 'form_1',
        completedBy: 'user@example.com',
        durationMs: 30000,
      };
      expect(payload.completedBy).toBe('user@example.com');
    });

    it('should type-check FormExpiredPayload correctly', () => {
      const payload: FormExpiredPayload = {
        submissionId: 'sub_1',
        formId: 'form_1',
        expiredAfterMs: 86400000,
      };
      expect(payload.expiredAfterMs).toBe(86400000);
    });

    it('should type-check CostTrackedPayload correctly', () => {
      const payload: CostTrackedPayload = {
        provider: 'anthropic',
        model: 'claude-3-opus',
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        costUsd: 0.05,
        trigger: 'completion',
      };
      expect(payload.costUsd).toBe(0.05);
    });

    it('should type-check AlertTriggeredPayload correctly', () => {
      const payload: AlertTriggeredPayload = {
        alertRuleId: 'rule_1',
        alertName: 'High Error Rate',
        condition: 'error_rate > 0.1',
        currentValue: 0.15,
        threshold: 0.1,
        message: 'Error rate exceeded threshold',
      };
      expect(payload.currentValue).toBe(0.15);
    });

    it('should type-check AlertResolvedPayload correctly', () => {
      const payload: AlertResolvedPayload = {
        alertRuleId: 'rule_1',
        alertName: 'High Error Rate',
        resolvedBy: 'auto',
      };
      expect(payload.alertRuleId).toBe('rule_1');
    });

    it('should type-check CustomPayload correctly', () => {
      const payload: CustomPayload = {
        type: 'user_defined',
        data: { key: 'value' },
      };
      expect(payload.type).toBe('user_defined');
    });
  });

  describe('Discriminated union narrowing', () => {
    it('should narrow payload type based on eventType', () => {
      const event: AgentLensEvent = {
        id: '01HXY0001',
        timestamp: '2026-02-07T10:00:00Z',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'tool_call',
        severity: 'info',
        payload: {
          toolName: 'search',
          arguments: {},
          callId: 'call_1',
        },
        metadata: {},
        prevHash: null,
        hash: 'abc',
        tenantId: 'default',
      };

      // Runtime check that payload has expected shape for tool_call
      if (event.eventType === 'tool_call') {
        const payload = event.payload as ToolCallPayload;
        expect(payload.toolName).toBe('search');
        expect(payload.callId).toBe('call_1');
      }
    });
  });

  describe('EventId and Timestamp type aliases', () => {
    it('should accept string values for EventId', () => {
      const id: EventId = '01HXYZ123ABC';
      expect(typeof id).toBe('string');
    });

    it('should accept ISO 8601 strings for Timestamp', () => {
      const ts: Timestamp = '2026-02-07T10:00:00.000Z';
      expect(typeof ts).toBe('string');
    });
  });
});
