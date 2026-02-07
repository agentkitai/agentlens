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
        payload: {},
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
        payload: {},
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
        payload: {},
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

  describe('Re-exports from index', () => {
    it('should export schemas and types from @agentlens/core barrel', async () => {
      const core = await import('../index.js');
      expect(core.eventTypeSchema).toBeDefined();
      expect(core.severitySchema).toBeDefined();
      expect(core.ingestEventSchema).toBeDefined();
    });
  });
});
