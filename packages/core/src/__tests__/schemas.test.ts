import { describe, it, expect } from 'vitest';
import {
  eventTypeSchema,
  severitySchema,
  ingestEventSchema,
  type IngestEventInput,
} from '../schemas.js';

describe('Story 2.3: Zod Validation Schemas', () => {
  describe('eventTypeSchema', () => {
    it('should accept all valid event types', () => {
      const validTypes = [
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

      for (const type of validTypes) {
        const result = eventTypeSchema.safeParse(type);
        expect(result.success, `Expected "${type}" to be valid`).toBe(true);
      }
    });

    it('should reject unknown event type strings', () => {
      const result = eventTypeSchema.safeParse('unknown_type');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1);
      }
    });

    it('should reject non-string values', () => {
      expect(eventTypeSchema.safeParse(42).success).toBe(false);
      expect(eventTypeSchema.safeParse(null).success).toBe(false);
      expect(eventTypeSchema.safeParse(undefined).success).toBe(false);
    });
  });

  describe('severitySchema', () => {
    it('should accept all valid severity levels', () => {
      const validSeverities = ['debug', 'info', 'warn', 'error', 'critical'];
      for (const s of validSeverities) {
        const result = severitySchema.safeParse(s);
        expect(result.success, `Expected "${s}" to be valid`).toBe(true);
      }
    });

    it('should reject unknown severity strings', () => {
      const result = severitySchema.safeParse('fatal');
      expect(result.success).toBe(false);
    });

    it('should work with .default("info")', () => {
      const schemaWithDefault = severitySchema.default('info');
      const result = schemaWithDefault.parse(undefined);
      expect(result).toBe('info');
    });
  });

  describe('ingestEventSchema', () => {
    it('should validate a valid event with all fields', () => {
      const input = {
        sessionId: 'sess_abc123',
        agentId: 'agent_main',
        eventType: 'tool_call',
        severity: 'info',
        payload: {
          toolName: 'web_search',
          arguments: { query: 'test' },
          callId: 'call_1',
        },
        metadata: { source: 'mcp' },
        timestamp: '2026-02-07T10:00:00Z',
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sessionId).toBe('sess_abc123');
        expect(result.data.agentId).toBe('agent_main');
        expect(result.data.eventType).toBe('tool_call');
        expect(result.data.severity).toBe('info');
        expect(result.data.timestamp).toBe('2026-02-07T10:00:00Z');
      }
    });

    it('should pass with correctly typed output', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'custom',
        payload: { type: 'test', data: {} },
      };

      const result = ingestEventSchema.parse(input);
      // Type check: result should be IngestEventInput
      const typed: IngestEventInput = result;
      expect(typed.sessionId).toBe('sess_1');
      expect(typed.severity).toBe('info'); // default
      expect(typed.metadata).toEqual({}); // default
    });

    it('should return descriptive error when sessionId is missing', () => {
      const input = {
        agentId: 'agent_1',
        eventType: 'tool_call',
        payload: { toolName: 'test', callId: '1', arguments: {} },
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        const sessionIdError = result.error.issues.find((i) => i.path.includes('sessionId'));
        expect(sessionIdError).toBeDefined();
      }
    });

    it('should return descriptive error when agentId is missing', () => {
      const input = {
        sessionId: 'sess_1',
        eventType: 'tool_call',
        payload: { toolName: 'test', callId: '1', arguments: {} },
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        const agentIdError = result.error.issues.find((i) => i.path.includes('agentId'));
        expect(agentIdError).toBeDefined();
      }
    });

    it('should return error when sessionId is empty string', () => {
      const input = {
        sessionId: '',
        agentId: 'agent_1',
        eventType: 'tool_call',
        payload: { toolName: 'x', callId: '1', arguments: {} },
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        const sessionIdError = result.error.issues.find((i) => i.path.includes('sessionId'));
        expect(sessionIdError).toBeDefined();
        expect(sessionIdError!.message).toBe('sessionId is required');
      }
    });

    it('should return error when agentId is empty string', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: '',
        eventType: 'tool_call',
        payload: { toolName: 'x', callId: '1', arguments: {} },
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        const agentIdError = result.error.issues.find((i) => i.path.includes('agentId'));
        expect(agentIdError).toBeDefined();
        expect(agentIdError!.message).toBe('agentId is required');
      }
    });

    it('should default severity to info when missing', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'custom',
        payload: { type: 'test', data: {} },
      };

      const result = ingestEventSchema.parse(input);
      expect(result.severity).toBe('info');
    });

    it('should default metadata to empty object when missing', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'custom',
        payload: { type: 'test', data: {} },
      };

      const result = ingestEventSchema.parse(input);
      expect(result.metadata).toEqual({});
    });

    it('should reject invalid eventType', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'invalid_type',
        payload: {},
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject invalid severity', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'tool_call',
        severity: 'fatal',
        payload: { toolName: 'x', callId: '1', arguments: {} },
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should accept optional timestamp as valid ISO 8601', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'custom',
        payload: { type: 'test', data: {} },
        timestamp: '2026-02-07T10:00:00.000Z',
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject invalid timestamp format', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'custom',
        payload: { type: 'test', data: {} },
        timestamp: 'not-a-date',
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should allow timestamp to be omitted', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'custom',
        payload: { type: 'test', data: {} },
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.timestamp).toBeUndefined();
      }
    });
  });

  describe('Type-specific payload validation', () => {
    it('should reject tool_call with missing toolName', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'tool_call',
        payload: { arguments: {}, callId: 'c1' },
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        const payloadError = result.error.issues.find(
          (i) => i.path[0] === 'payload' && i.path[1] === 'toolName',
        );
        expect(payloadError).toBeDefined();
      }
    });

    it('should reject tool_call with missing callId', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'tool_call',
        payload: { toolName: 'search', arguments: {} },
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        const payloadError = result.error.issues.find(
          (i) => i.path[0] === 'payload' && i.path[1] === 'callId',
        );
        expect(payloadError).toBeDefined();
      }
    });

    it('should accept valid tool_call payload', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'tool_call',
        payload: { toolName: 'search', callId: 'c1', arguments: {} },
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject tool_response with missing durationMs', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'tool_response',
        payload: { callId: 'c1', toolName: 'search', result: {} },
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject tool_error with missing error field', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'tool_error',
        payload: { callId: 'c1', toolName: 'search', durationMs: 100 },
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject session_ended with invalid reason', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'session_ended',
        payload: { reason: 'crashed' },
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should accept valid session_ended payload', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'session_ended',
        payload: { reason: 'completed', summary: 'Done' },
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept valid cost_tracked payload', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'cost_tracked',
        payload: {
          provider: 'anthropic',
          model: 'claude-3',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          costUsd: 0.01,
        },
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject cost_tracked with missing provider', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'cost_tracked',
        payload: {
          model: 'claude-3',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          costUsd: 0.01,
        },
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should accept custom payload with type and data', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'custom',
        payload: { type: 'my_event', data: { foo: 'bar' } },
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject custom payload missing type field', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'custom',
        payload: { data: { foo: 'bar' } },
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should accept valid approval_requested payload', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'approval_requested',
        payload: {
          requestId: 'req_1',
          action: 'delete_file',
          params: { path: '/tmp' },
          urgency: 'high',
        },
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept valid form_submitted payload', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'form_submitted',
        payload: {
          submissionId: 'sub_1',
          formId: 'form_1',
          fieldCount: 3,
        },
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept valid alert_triggered payload', () => {
      const input = {
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'alert_triggered',
        payload: {
          alertRuleId: 'rule_1',
          alertName: 'High Error Rate',
          condition: 'error_rate > 0.1',
          currentValue: 0.15,
          threshold: 0.1,
          message: 'Error rate exceeded',
        },
      };

      const result = ingestEventSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('Re-exports from index', () => {
    it('should export schemas and types from @agentlensai/core barrel', async () => {
      const core = await import('../index.js');
      expect(core.eventTypeSchema).toBeDefined();
      expect(core.severitySchema).toBeDefined();
      expect(core.ingestEventSchema).toBeDefined();
    });
  });
});
