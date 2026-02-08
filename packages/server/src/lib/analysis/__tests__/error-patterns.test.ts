/**
 * Tests for Error Pattern Analysis (Story 4.1)
 */

import { describe, it, expect } from 'vitest';
import { analyzeErrorPatterns, normalizeErrorMessage } from '../error-patterns.js';
import type { IEventStore, AgentLensEvent, EventQueryResult } from '@agentlensai/core';

// ─── Mock store factory ────────────────────────────────────────

function createMockStore(events: AgentLensEvent[]): IEventStore {
  return {
    queryEvents: async (query: any) => {
      let filtered = [...events];
      if (query.eventType) {
        const types = Array.isArray(query.eventType) ? query.eventType : [query.eventType];
        filtered = filtered.filter((e) => types.includes(e.eventType));
      }
      if (query.severity) {
        const severities = Array.isArray(query.severity) ? query.severity : [query.severity];
        filtered = filtered.filter((e) => severities.includes(e.severity));
      }
      if (query.agentId) {
        filtered = filtered.filter((e) => e.agentId === query.agentId);
      }
      if (query.from) {
        filtered = filtered.filter((e) => e.timestamp >= query.from!);
      }
      if (query.to) {
        filtered = filtered.filter((e) => e.timestamp <= query.to!);
      }
      filtered.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const limit = query.limit ?? 500;
      return {
        events: filtered.slice(0, limit),
        total: filtered.length,
        hasMore: filtered.length > limit,
      } as EventQueryResult;
    },
    getSessionTimeline: async (sessionId: string) => {
      return events
        .filter((e) => e.sessionId === sessionId)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    },
  } as unknown as IEventStore;
}

function makeEvent(overrides: Partial<AgentLensEvent>): AgentLensEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    sessionId: 'ses-1',
    agentId: 'agent-1',
    eventType: 'tool_call',
    severity: 'info',
    payload: {},
    metadata: {},
    prevHash: null,
    hash: 'abc',
    tenantId: 'default',
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('normalizeErrorMessage', () => {
  it('replaces UUIDs with <UUID>', () => {
    const msg = 'Failed for id 550e8400-e29b-41d4-a716-446655440000';
    expect(normalizeErrorMessage(msg)).toBe('Failed for id <UUID>');
  });

  it('replaces file paths with <PATH>', () => {
    const msg = 'Error at /home/user/project/src/index.ts';
    expect(normalizeErrorMessage(msg)).toBe('Error at <PATH>');
  });

  it('replaces numbers with <N>', () => {
    const msg = 'Request failed with status 404 after 3 retries';
    expect(normalizeErrorMessage(msg)).toBe('Request failed with status <N> after <N> retries');
  });

  it('handles combined patterns', () => {
    const msg = 'Error in /app/src/main.ts for user 550e8400-e29b-41d4-a716-446655440000: timeout after 5000ms';
    const normalized = normalizeErrorMessage(msg);
    expect(normalized).toContain('<PATH>');
    expect(normalized).toContain('<UUID>');
    expect(normalized).toContain('<N>');
  });
});

describe('analyzeErrorPatterns', () => {
  it('returns empty patterns when no errors exist', async () => {
    const store = createMockStore([
      makeEvent({ eventType: 'tool_call', severity: 'info' }),
    ]);

    const result = await analyzeErrorPatterns(store);
    expect(result.patterns).toEqual([]);
    expect(result.metadata.eventsAnalyzed).toBe(0);
  });

  it('groups similar errors into patterns', async () => {
    const events = [
      makeEvent({
        id: 'e1',
        timestamp: '2024-01-01T00:00:00Z',
        eventType: 'tool_error',
        severity: 'error',
        sessionId: 'ses-1',
        payload: { error: 'Connection timeout after 5000ms', callId: 'c1', toolName: 'http_get', durationMs: 5000 },
      }),
      makeEvent({
        id: 'e2',
        timestamp: '2024-01-02T00:00:00Z',
        eventType: 'tool_error',
        severity: 'error',
        sessionId: 'ses-2',
        payload: { error: 'Connection timeout after 3000ms', callId: 'c2', toolName: 'http_get', durationMs: 3000 },
      }),
      makeEvent({
        id: 'e3',
        timestamp: '2024-01-03T00:00:00Z',
        eventType: 'tool_error',
        severity: 'error',
        sessionId: 'ses-3',
        payload: { error: 'Permission denied for /etc/passwd', callId: 'c3', toolName: 'read_file', durationMs: 10 },
      }),
    ];

    const store = createMockStore(events);
    const result = await analyzeErrorPatterns(store);

    // "Connection timeout after <N>ms" should be grouped
    expect(result.patterns.length).toBe(2);
    expect(result.patterns[0]!.count).toBe(2); // timeout pattern
    expect(result.patterns[0]!.affectedSessions).toHaveLength(2);
    expect(result.patterns[1]!.count).toBe(1); // permission denied
  });

  it('identifies preceding tools', async () => {
    const events = [
      makeEvent({
        id: 'e1',
        timestamp: '2024-01-01T00:01:00Z',
        sessionId: 'ses-1',
        eventType: 'tool_call',
        payload: { toolName: 'search', callId: 'c1', arguments: {} },
      }),
      makeEvent({
        id: 'e2',
        timestamp: '2024-01-01T00:02:00Z',
        sessionId: 'ses-1',
        eventType: 'tool_call',
        payload: { toolName: 'fetch', callId: 'c2', arguments: {} },
      }),
      makeEvent({
        id: 'e3',
        timestamp: '2024-01-01T00:03:00Z',
        sessionId: 'ses-1',
        eventType: 'tool_error',
        severity: 'error',
        payload: { error: 'Parse error', callId: 'c3', toolName: 'parse', durationMs: 5 },
      }),
    ];

    const store = createMockStore(events);
    const result = await analyzeErrorPatterns(store);

    expect(result.patterns.length).toBe(1);
    expect(result.patterns[0]!.precedingTools[0]).toEqual(['search', 'fetch']);
  });

  it('sorts by frequency descending', async () => {
    const events = [
      makeEvent({ id: 'e1', timestamp: '2024-01-01T00:00:00Z', eventType: 'tool_error', severity: 'error', sessionId: 'ses-1', payload: { error: 'Error A', callId: 'c1', toolName: 'x', durationMs: 1 } }),
      makeEvent({ id: 'e2', timestamp: '2024-01-01T01:00:00Z', eventType: 'tool_error', severity: 'error', sessionId: 'ses-2', payload: { error: 'Error B', callId: 'c2', toolName: 'x', durationMs: 1 } }),
      makeEvent({ id: 'e3', timestamp: '2024-01-01T02:00:00Z', eventType: 'tool_error', severity: 'error', sessionId: 'ses-3', payload: { error: 'Error B', callId: 'c3', toolName: 'x', durationMs: 1 } }),
      makeEvent({ id: 'e4', timestamp: '2024-01-01T03:00:00Z', eventType: 'tool_error', severity: 'error', sessionId: 'ses-4', payload: { error: 'Error B', callId: 'c4', toolName: 'x', durationMs: 1 } }),
    ];

    const store = createMockStore(events);
    const result = await analyzeErrorPatterns(store);

    expect(result.patterns[0]!.pattern).toBe('Error B');
    expect(result.patterns[0]!.count).toBe(3);
    expect(result.patterns[1]!.pattern).toBe('Error A');
    expect(result.patterns[1]!.count).toBe(1);
  });

  it('respects limit parameter', async () => {
    // Use alphabetic suffixes to ensure different patterns after normalization
    const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'];
    const events = words.map((word, i) =>
      makeEvent({
        id: `e${i}`,
        timestamp: `2024-01-01T${String(i).padStart(2, '0')}:00:00Z`,
        eventType: 'tool_error',
        severity: 'error',
        sessionId: `ses-${i}`,
        payload: { error: `Error type ${word}`, callId: `c${i}`, toolName: 'x', durationMs: 1 },
      }),
    );

    const store = createMockStore(events);
    const result = await analyzeErrorPatterns(store, { limit: 5 });

    expect(result.patterns.length).toBe(5);
  });

  it('includes error/critical severity events (not just tool_error)', async () => {
    const events = [
      makeEvent({
        id: 'e1',
        timestamp: '2024-01-01T00:00:00Z',
        eventType: 'custom',
        severity: 'critical',
        sessionId: 'ses-1',
        payload: { type: 'crash', data: {}, error: 'Out of memory' },
      }),
    ];

    const store = createMockStore(events);
    const result = await analyzeErrorPatterns(store);

    expect(result.patterns.length).toBe(1);
    expect(result.patterns[0]!.pattern).toBe('Out of memory');
  });
});
