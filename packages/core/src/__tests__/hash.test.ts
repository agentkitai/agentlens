import { describe, it, expect } from 'vitest';
import { computeEventHash, verifyChain, HASH_VERSION } from '../hash.js';
import type { HashableEvent, ChainEvent } from '../hash.js';

describe('Story 2.4: Hash Chain Utilities', () => {
  const baseEvent: HashableEvent = {
    id: '01HXY0001',
    timestamp: '2026-02-07T10:00:00Z',
    sessionId: 'sess_abc123',
    agentId: 'agent_main',
    eventType: 'tool_call',
    severity: 'info',
    payload: {
      toolName: 'web_search',
      arguments: { query: 'test' },
      callId: 'call_1',
    },
    metadata: {},
    prevHash: null,
  };

  describe('HASH_VERSION', () => {
    it('should be 2', () => {
      expect(HASH_VERSION).toBe(2);
    });
  });

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

    it('should return different hash for different severity', () => {
      const event2: HashableEvent = {
        ...baseEvent,
        severity: 'error',
      };
      expect(computeEventHash(baseEvent)).not.toBe(computeEventHash(event2));
    });

    it('should return different hash for different metadata', () => {
      const event2: HashableEvent = {
        ...baseEvent,
        metadata: { source: 'mcp' },
      };
      expect(computeEventHash(baseEvent)).not.toBe(computeEventHash(event2));
    });
  });

  describe('verifyChain()', () => {
    /** Helper to build a ChainEvent from a HashableEvent */
    function toChainEvent(event: HashableEvent): ChainEvent {
      const hash = computeEventHash(event);
      return { ...event, hash };
    }

    it('should return valid for an empty chain', () => {
      const result = verifyChain([]);
      expect(result.valid).toBe(true);
      expect(result.failedAtIndex).toBe(-1);
      expect(result.reason).toBeNull();
    });

    it('should return valid for a single event with prevHash = null', () => {
      const chainEvent = toChainEvent(baseEvent);
      const result = verifyChain([chainEvent]);
      expect(result.valid).toBe(true);
    });

    it('should return valid for a valid chain of events', () => {
      // Build a chain of 3 events
      const event1: HashableEvent = {
        id: '01HXY0001',
        timestamp: '2026-02-07T10:00:00Z',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'session_started',
        severity: 'info',
        payload: { agentName: 'Test Agent' },
        metadata: {},
        prevHash: null,
      };
      const ce1 = toChainEvent(event1);

      const event2: HashableEvent = {
        id: '01HXY0002',
        timestamp: '2026-02-07T10:00:01Z',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'tool_call',
        severity: 'info',
        payload: { toolName: 'search', arguments: {}, callId: 'c1' },
        metadata: {},
        prevHash: ce1.hash,
      };
      const ce2 = toChainEvent(event2);

      const event3: HashableEvent = {
        id: '01HXY0003',
        timestamp: '2026-02-07T10:00:02Z',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'tool_response',
        severity: 'info',
        payload: { callId: 'c1', toolName: 'search', result: {}, durationMs: 50 },
        metadata: {},
        prevHash: ce2.hash,
      };
      const ce3 = toChainEvent(event3);

      const result = verifyChain([ce1, ce2, ce3]);
      expect(result.valid).toBe(true);
    });

    it('should detect tampered event hash (payload modified after hashing)', () => {
      const event1: HashableEvent = {
        id: '01HXY0001',
        timestamp: '2026-02-07T10:00:00Z',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'session_started',
        severity: 'info',
        payload: { agentName: 'Test Agent' },
        metadata: {},
        prevHash: null,
      };
      const ce1 = toChainEvent(event1);

      const event2: HashableEvent = {
        id: '01HXY0002',
        timestamp: '2026-02-07T10:00:01Z',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        eventType: 'tool_call',
        severity: 'info',
        payload: { toolName: 'search', arguments: {}, callId: 'c1' },
        metadata: {},
        prevHash: ce1.hash,
      };
      const ce2 = toChainEvent(event2);

      // Tamper: change payload but keep the old hash
      const tampered: ChainEvent = {
        ...ce2,
        payload: { toolName: 'HACKED', arguments: {}, callId: 'c1' },
      };

      const result = verifyChain([ce1, tampered]);
      expect(result.valid).toBe(false);
      expect(result.failedAtIndex).toBe(1);
      expect(result.reason).toContain('hash mismatch');
    });

    it('should detect tampered severity (severity modified after hashing)', () => {
      const ce1 = toChainEvent(baseEvent);

      // Tamper: change severity but keep old hash
      const tampered: ChainEvent = { ...ce1, severity: 'critical' };

      const result = verifyChain([tampered]);
      expect(result.valid).toBe(false);
      expect(result.failedAtIndex).toBe(0);
      expect(result.reason).toContain('hash mismatch');
    });

    it('should detect tampered metadata', () => {
      const ce1 = toChainEvent(baseEvent);

      // Tamper: change metadata but keep old hash
      const tampered: ChainEvent = { ...ce1, metadata: { injected: true } };

      const result = verifyChain([tampered]);
      expect(result.valid).toBe(false);
      expect(result.failedAtIndex).toBe(0);
      expect(result.reason).toContain('hash mismatch');
    });

    it('should return false when prevHash does not match previous hash', () => {
      const ce1 = toChainEvent(baseEvent);

      const event2: HashableEvent = {
        ...baseEvent,
        id: '01HXY0002',
        prevHash: 'wrong_hash',
      };
      const ce2: ChainEvent = {
        ...event2,
        hash: computeEventHash(event2),
      };

      const result = verifyChain([ce1, ce2]);
      expect(result.valid).toBe(false);
      expect(result.failedAtIndex).toBe(1);
      expect(result.reason).toContain('prevHash does not match');
    });

    it('should return false when first event has non-null prevHash', () => {
      const event: HashableEvent = { ...baseEvent, prevHash: 'should_be_null' };
      const ce: ChainEvent = { ...event, hash: computeEventHash(event) };

      const result = verifyChain([ce]);
      expect(result.valid).toBe(false);
      expect(result.failedAtIndex).toBe(0);
      expect(result.reason).toContain('First event must have prevHash = null');
    });

    it('should return valid for a long valid chain', () => {
      const chain: ChainEvent[] = [];
      let prevHash: string | null = null;

      for (let i = 0; i < 100; i++) {
        const event: HashableEvent = {
          id: `01HXY${String(i).padStart(4, '0')}`,
          timestamp: `2026-02-07T10:00:${String(i).padStart(2, '0')}Z`,
          sessionId: 'sess_1',
          agentId: 'agent_1',
          eventType: 'custom',
          severity: 'info',
          payload: { type: 'test', data: { index: i } },
          metadata: {},
          prevHash,
        };
        const hash = computeEventHash(event);
        chain.push({ ...event, hash });
        prevHash = hash;
      }

      const result = verifyChain(chain);
      expect(result.valid).toBe(true);
    });

    it('should detect tampering in the middle of a long chain', () => {
      const chain: ChainEvent[] = [];
      let prevHash: string | null = null;

      for (let i = 0; i < 10; i++) {
        const event: HashableEvent = {
          id: `01HXY${String(i).padStart(4, '0')}`,
          timestamp: `2026-02-07T10:00:${String(i).padStart(2, '0')}Z`,
          sessionId: 'sess_1',
          agentId: 'agent_1',
          eventType: 'custom',
          severity: 'info',
          payload: { type: 'test', data: { index: i } },
          metadata: {},
          prevHash,
        };
        const hash = computeEventHash(event);
        chain.push({ ...event, hash });
        prevHash = hash;
      }

      // Tamper event at index 5: change the hash (simulates payload modification)
      chain[5] = { ...chain[5], hash: 'tampered_hash' };

      const result = verifyChain(chain);
      expect(result.valid).toBe(false);
      expect(result.failedAtIndex).toBe(5);
    });

    it('should provide detailed failure info', () => {
      const ce1 = toChainEvent(baseEvent);

      // Event with wrong hash
      const event2: HashableEvent = {
        ...baseEvent,
        id: '01HXY0002',
        prevHash: ce1.hash,
      };
      const ce2: ChainEvent = {
        ...event2,
        hash: 'clearly_wrong_hash',
      };

      const result = verifyChain([ce1, ce2]);
      expect(result.valid).toBe(false);
      expect(result.failedAtIndex).toBe(1);
      expect(result.reason).toContain('Event 1');
      expect(result.reason).toContain('hash mismatch');
    });
  });
});
