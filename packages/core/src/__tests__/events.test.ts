import { describe, it, expect } from 'vitest';
import { createEvent, truncatePayload } from '../events.js';
import { computeEventHash } from '../hash.js';
import { MAX_PAYLOAD_SIZE } from '../constants.js';
import type { EventPayload, CustomPayload } from '../types.js';

describe('Story 2.5: Event Creation Helpers', () => {
  describe('createEvent()', () => {
    it('should generate a ULID id', () => {
      const event = createEvent({
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'tool_call',
        payload: {
          toolName: 'search',
          arguments: {},
          callId: 'c1',
        },
      });

      // ULID is 26 chars, uppercase alphanumeric
      expect(event.id).toMatch(/^[0-9A-Z]{26}$/);
    });

    it('should generate an ISO timestamp', () => {
      const event = createEvent({
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'custom',
        payload: { type: 'test', data: {} },
      });

      // Should be valid ISO 8601
      const parsed = new Date(event.timestamp);
      expect(parsed.toISOString()).toBe(event.timestamp);
    });

    it('should default severity to info', () => {
      const event = createEvent({
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'custom',
        payload: { type: 'test', data: {} },
      });

      expect(event.severity).toBe('info');
    });

    it('should accept custom severity', () => {
      const event = createEvent({
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'tool_error',
        severity: 'error',
        payload: {
          callId: 'c1',
          toolName: 'search',
          error: 'Network error',
          durationMs: 5000,
        },
      });

      expect(event.severity).toBe('error');
    });

    it('should compute a valid hash', () => {
      const event = createEvent({
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'custom',
        payload: { type: 'test', data: {} },
      });

      expect(event.hash).toMatch(/^[0-9a-f]{64}$/);

      // Verify hash is correct
      const expectedHash = computeEventHash({
        id: event.id,
        timestamp: event.timestamp,
        sessionId: event.sessionId,
        agentId: event.agentId,
        eventType: event.eventType,
        payload: event.payload,
        prevHash: event.prevHash,
      });
      expect(event.hash).toBe(expectedHash);
    });

    it('should set prevHash to null when not provided', () => {
      const event = createEvent({
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'custom',
        payload: { type: 'test', data: {} },
      });

      expect(event.prevHash).toBeNull();
    });

    it('should accept prevHash for chaining', () => {
      const event = createEvent({
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'custom',
        payload: { type: 'test', data: {} },
        prevHash: 'abc123def456',
      });

      expect(event.prevHash).toBe('abc123def456');
    });

    it('should default metadata to empty object', () => {
      const event = createEvent({
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'custom',
        payload: { type: 'test', data: {} },
      });

      expect(event.metadata).toEqual({});
    });

    it('should accept custom metadata', () => {
      const event = createEvent({
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'custom',
        payload: { type: 'test', data: {} },
        metadata: { source: 'mcp', version: '1.0' },
      });

      expect(event.metadata).toEqual({ source: 'mcp', version: '1.0' });
    });

    it('should use provided timestamp', () => {
      const ts = '2026-02-07T10:00:00.000Z';
      const event = createEvent({
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'custom',
        payload: { type: 'test', data: {} },
        timestamp: ts,
      });

      expect(event.timestamp).toBe(ts);
    });

    it('should return a full AgentLensEvent with all required fields', () => {
      const event = createEvent({
        sessionId: 'sess_abc',
        agentId: 'agent_main',
        eventType: 'tool_call',
        payload: {
          toolName: 'web_search',
          arguments: { query: 'test' },
          callId: 'call_1',
        },
      });

      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('timestamp');
      expect(event).toHaveProperty('sessionId', 'sess_abc');
      expect(event).toHaveProperty('agentId', 'agent_main');
      expect(event).toHaveProperty('eventType', 'tool_call');
      expect(event).toHaveProperty('severity', 'info');
      expect(event).toHaveProperty('payload');
      expect(event).toHaveProperty('metadata');
      expect(event).toHaveProperty('prevHash', null);
      expect(event).toHaveProperty('hash');
    });

    it('should create chainable events', () => {
      const event1 = createEvent({
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'session_started',
        payload: { agentName: 'Test Agent' },
      });

      const event2 = createEvent({
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'tool_call',
        payload: { toolName: 'search', arguments: {}, callId: 'c1' },
        prevHash: event1.hash,
      });

      expect(event2.prevHash).toBe(event1.hash);
    });
  });

  describe('truncatePayload()', () => {
    it('should return payload unchanged when under size limit', () => {
      const payload: EventPayload = {
        type: 'test',
        data: { key: 'value' },
      };

      const result = truncatePayload(payload);
      expect(result).toEqual(payload);
    });

    it('should truncate payload over 10KB with _truncated indicator', () => {
      // Create a payload larger than 10KB
      const largeData: Record<string, unknown> = {};
      for (let i = 0; i < 500; i++) {
        largeData[`key_${i}`] = 'x'.repeat(50);
      }
      const payload: EventPayload = {
        type: 'large_event',
        data: largeData,
      };

      const serialized = JSON.stringify(payload);
      expect(serialized.length).toBeGreaterThan(MAX_PAYLOAD_SIZE);

      const result = truncatePayload(payload) as CustomPayload;
      expect(result.data._truncated).toBe(true);
      expect(result.data.originalSize).toBe(serialized.length);
      expect(result.data.maxSize).toBe(MAX_PAYLOAD_SIZE);
      expect(typeof result.data.preview).toBe('string');
    });

    it('should keep payload exactly at size limit', () => {
      // Build a payload that's exactly at the limit
      const targetSize = MAX_PAYLOAD_SIZE;
      // Base: {"type":"test","data":{"content":"..."}}
      const baseLen = JSON.stringify({ type: 'test', data: { content: '' } }).length;
      const padding = 'a'.repeat(targetSize - baseLen);
      const payload: EventPayload = {
        type: 'test',
        data: { content: padding },
      };

      const serialized = JSON.stringify(payload);
      expect(serialized.length).toBeLessThanOrEqual(MAX_PAYLOAD_SIZE);

      const result = truncatePayload(payload);
      expect(result).toEqual(payload);
    });
  });
});
