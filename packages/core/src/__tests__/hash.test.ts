import { describe, it, expect } from 'vitest';
import { computeEventHash, verifyChain } from '../hash.js';
import type { HashableEvent } from '../hash.js';

describe('Story 2.4: Hash Chain Utilities', () => {
  const baseEvent: HashableEvent = {
    id: '01HXY0001',
    timestamp: '2026-02-07T10:00:00Z',
    sessionId: 'sess_abc123',
    agentId: 'agent_main',
    eventType: 'tool_call',
    payload: {
      toolName: 'web_search',
      arguments: { query: 'test' },
      callId: 'call_1',
    },
    prevHash: null,
  };

  describe('computeEventHash()', () => {
    it('should return a deterministic SHA-256 hex string', () => {
      const hash = computeEventHash(baseEvent);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should return identical hash for the same input (deterministic)', () => {
      const hash1 = computeEventHash(baseEvent);
      const hash2 = computeEventHash(baseEvent);
      expect(hash1).toBe(hash2);
    });

    it('should return different hash for different payload', () => {
      const event2: HashableEvent = {
        ...baseEvent,
        payload: {
          toolName: 'file_read',
          arguments: { path: '/tmp' },
          callId: 'call_2',
        },
      };
      const hash1 = computeEventHash(baseEvent);
      const hash2 = computeEventHash(event2);
      expect(hash1).not.toBe(hash2);
    });

    it('should return different hash for different prevHash', () => {
      const event2: HashableEvent = {
        ...baseEvent,
        prevHash: 'abc123',
      };
      const hash1 = computeEventHash(baseEvent);
      const hash2 = computeEventHash(event2);
      expect(hash1).not.toBe(hash2);
    });

    it('should handle first event with prevHash = null', () => {
      const event: HashableEvent = {
        ...baseEvent,
        prevHash: null,
      };
      const hash = computeEventHash(event);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should return different hash for different id', () => {
      const event2: HashableEvent = {
        ...baseEvent,
        id: '01HXY0002',
      };
      expect(computeEventHash(baseEvent)).not.toBe(computeEventHash(event2));
    });

    it('should return different hash for different timestamp', () => {
      const event2: HashableEvent = {
        ...baseEvent,
        timestamp: '2026-02-07T10:00:01Z',
      };
      expect(computeEventHash(baseEvent)).not.toBe(computeEventHash(event2));
    });

    it('should return different hash for different sessionId', () => {
      const event2: HashableEvent = {
        ...baseEvent,
        sessionId: 'sess_other',
      };
      expect(computeEventHash(baseEvent)).not.toBe(computeEventHash(event2));
    });

    it('should return different hash for different agentId', () => {
      const event2: HashableEvent = {
        ...baseEvent,
        agentId: 'agent_other',
      };
      expect(computeEventHash(baseEvent)).not.toBe(computeEventHash(event2));
    });

    it('should return different hash for different eventType', () => {
      const event2: HashableEvent = {
        ...baseEvent,
        eventType: 'tool_response',
      };
      expect(computeEventHash(baseEvent)).not.toBe(computeEventHash(event2));
    });
  });

  describe('verifyChain()', () => {
    it('should return true for an empty chain', () => {
      expect(verifyChain([])).toBe(true);
    });

    it('should return true for a single event with prevHash = null', () => {
      const hash = computeEventHash(baseEvent);
      expect(verifyChain([{ hash, prevHash: null }])).toBe(true);
    });

    it('should return true for a valid chain of events', () => {
      // Build a chain of 3 events
      const event1: HashableEvent = {
        id: '01HXY0001',
        timestamp: '2026-02-07T10:00:00Z',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'session_started',
        payload: { agentName: 'Test Agent' },
        prevHash: null,
      };
      const hash1 = computeEventHash(event1);

      const event2: HashableEvent = {
        id: '01HXY0002',
        timestamp: '2026-02-07T10:00:01Z',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'tool_call',
        payload: { toolName: 'search', arguments: {}, callId: 'c1' },
        prevHash: hash1,
      };
      const hash2 = computeEventHash(event2);

      const event3: HashableEvent = {
        id: '01HXY0003',
        timestamp: '2026-02-07T10:00:02Z',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'tool_response',
        payload: { callId: 'c1', toolName: 'search', result: {}, durationMs: 50 },
        prevHash: hash2,
      };
      const hash3 = computeEventHash(event3);

      const chain = [
        { hash: hash1, prevHash: null },
        { hash: hash2, prevHash: hash1 },
        { hash: hash3, prevHash: hash2 },
      ];

      expect(verifyChain(chain)).toBe(true);
    });

    it('should return false when an event payload was modified (broken chain)', () => {
      const event1: HashableEvent = {
        id: '01HXY0001',
        timestamp: '2026-02-07T10:00:00Z',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'session_started',
        payload: { agentName: 'Test Agent' },
        prevHash: null,
      };
      const hash1 = computeEventHash(event1);

      const event2: HashableEvent = {
        id: '01HXY0002',
        timestamp: '2026-02-07T10:00:01Z',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'tool_call',
        payload: { toolName: 'search', arguments: {}, callId: 'c1' },
        prevHash: hash1,
      };
      const hash2 = computeEventHash(event2);

      // Tamper: event2's hash is wrong (simulate payload modification)
      const tamperedHash2 = 'aaaa' + hash2.slice(4);

      const chain = [
        { hash: hash1, prevHash: null },
        { hash: tamperedHash2, prevHash: hash1 },
        // event3 still links to the original hash2, but event2 was tampered
        { hash: 'somehash', prevHash: hash2 },
      ];

      expect(verifyChain(chain)).toBe(false);
    });

    it('should return false when prevHash does not match previous hash', () => {
      const chain = [
        { hash: 'hash1', prevHash: null },
        { hash: 'hash2', prevHash: 'wrong_hash' },
      ];

      expect(verifyChain(chain)).toBe(false);
    });

    it('should return false when first event has non-null prevHash', () => {
      const chain = [{ hash: 'hash1', prevHash: 'should_be_null' }];

      expect(verifyChain(chain)).toBe(false);
    });

    it('should return true for a long valid chain', () => {
      const chain: Array<{ hash: string; prevHash: string | null }> = [];
      let prevHash: string | null = null;

      for (let i = 0; i < 100; i++) {
        const event: HashableEvent = {
          id: `01HXY${String(i).padStart(4, '0')}`,
          timestamp: `2026-02-07T10:00:${String(i).padStart(2, '0')}Z`,
          sessionId: 'sess_1',
          agentId: 'agent_1',
          eventType: 'custom',
          payload: { type: 'test', data: { index: i } },
          prevHash,
        };
        const hash = computeEventHash(event);
        chain.push({ hash, prevHash });
        prevHash = hash;
      }

      expect(verifyChain(chain)).toBe(true);
    });

    it('should detect tampering in the middle of a long chain', () => {
      const chain: Array<{ hash: string; prevHash: string | null }> = [];
      let prevHash: string | null = null;

      for (let i = 0; i < 10; i++) {
        const event: HashableEvent = {
          id: `01HXY${String(i).padStart(4, '0')}`,
          timestamp: `2026-02-07T10:00:${String(i).padStart(2, '0')}Z`,
          sessionId: 'sess_1',
          agentId: 'agent_1',
          eventType: 'custom',
          payload: { type: 'test', data: { index: i } },
          prevHash,
        };
        const hash = computeEventHash(event);
        chain.push({ hash, prevHash });
        prevHash = hash;
      }

      // Tamper event at index 5
      chain[5].hash = 'tampered_hash';

      expect(verifyChain(chain)).toBe(false);
    });
  });
});
