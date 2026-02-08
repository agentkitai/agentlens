/**
 * Tests for Tool Sequence Analysis (Story 4.2)
 */

import { describe, it, expect } from 'vitest';
import { analyzeToolSequences } from '../tool-sequences.js';
import type { IEventStore, AgentLensEvent, EventQueryResult } from '@agentlensai/core';

function createMockStore(events: AgentLensEvent[]): IEventStore {
  return {
    queryEvents: async (query: any) => {
      let filtered = [...events];
      if (query.eventType) {
        const types = Array.isArray(query.eventType) ? query.eventType : [query.eventType];
        filtered = filtered.filter((e) => types.includes(e.eventType));
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
    payload: { toolName: 'unknown', callId: 'c1', arguments: {} },
    metadata: {},
    prevHash: null,
    hash: 'abc',
    tenantId: 'default',
    ...overrides,
  };
}

describe('analyzeToolSequences', () => {
  it('returns empty when no tool calls exist', async () => {
    const store = createMockStore([]);
    const result = await analyzeToolSequences(store);

    expect(result.sequences).toEqual([]);
    expect(result.stats.totalCalls).toBe(0);
    expect(result.stats.uniqueTools).toBe(0);
  });

  it('extracts 2-grams from tool sequences', async () => {
    const events = [
      makeEvent({ id: 'e1', timestamp: '2024-01-01T00:01:00Z', sessionId: 'ses-1', payload: { toolName: 'search', callId: 'c1', arguments: {} } }),
      makeEvent({ id: 'e2', timestamp: '2024-01-01T00:02:00Z', sessionId: 'ses-1', payload: { toolName: 'fetch', callId: 'c2', arguments: {} } }),
      makeEvent({ id: 'e3', timestamp: '2024-01-01T00:03:00Z', sessionId: 'ses-1', payload: { toolName: 'parse', callId: 'c3', arguments: {} } }),
    ];

    const store = createMockStore(events);
    const result = await analyzeToolSequences(store);

    const twoGrams = result.sequences.filter((s) => s.tools.length === 2);
    expect(twoGrams.length).toBeGreaterThanOrEqual(2);

    const searchFetch = twoGrams.find(
      (s) => s.tools[0] === 'search' && s.tools[1] === 'fetch',
    );
    expect(searchFetch).toBeTruthy();
    expect(searchFetch!.frequency).toBe(1);
  });

  it('extracts 3-grams from tool sequences', async () => {
    const events = [
      makeEvent({ id: 'e1', timestamp: '2024-01-01T00:01:00Z', sessionId: 'ses-1', payload: { toolName: 'search', callId: 'c1', arguments: {} } }),
      makeEvent({ id: 'e2', timestamp: '2024-01-01T00:02:00Z', sessionId: 'ses-1', payload: { toolName: 'fetch', callId: 'c2', arguments: {} } }),
      makeEvent({ id: 'e3', timestamp: '2024-01-01T00:03:00Z', sessionId: 'ses-1', payload: { toolName: 'parse', callId: 'c3', arguments: {} } }),
    ];

    const store = createMockStore(events);
    const result = await analyzeToolSequences(store);

    const threeGrams = result.sequences.filter((s) => s.tools.length === 3);
    expect(threeGrams.length).toBe(1);
    expect(threeGrams[0]!.tools).toEqual(['search', 'fetch', 'parse']);
  });

  it('counts frequency across sessions', async () => {
    const events = [
      // Session 1: search → fetch
      makeEvent({ id: 'e1', timestamp: '2024-01-01T00:01:00Z', sessionId: 'ses-1', payload: { toolName: 'search', callId: 'c1', arguments: {} } }),
      makeEvent({ id: 'e2', timestamp: '2024-01-01T00:02:00Z', sessionId: 'ses-1', payload: { toolName: 'fetch', callId: 'c2', arguments: {} } }),
      // Session 2: search → fetch
      makeEvent({ id: 'e3', timestamp: '2024-01-02T00:01:00Z', sessionId: 'ses-2', payload: { toolName: 'search', callId: 'c3', arguments: {} } }),
      makeEvent({ id: 'e4', timestamp: '2024-01-02T00:02:00Z', sessionId: 'ses-2', payload: { toolName: 'fetch', callId: 'c4', arguments: {} } }),
      // Session 3: different sequence
      makeEvent({ id: 'e5', timestamp: '2024-01-03T00:01:00Z', sessionId: 'ses-3', payload: { toolName: 'read', callId: 'c5', arguments: {} } }),
      makeEvent({ id: 'e6', timestamp: '2024-01-03T00:02:00Z', sessionId: 'ses-3', payload: { toolName: 'write', callId: 'c6', arguments: {} } }),
    ];

    const store = createMockStore(events);
    const result = await analyzeToolSequences(store);

    const searchFetch = result.sequences.find(
      (s) => s.tools.length === 2 && s.tools[0] === 'search' && s.tools[1] === 'fetch',
    );
    expect(searchFetch).toBeTruthy();
    expect(searchFetch!.frequency).toBe(2);
    expect(searchFetch!.sessions).toBe(2);
  });

  it('identifies error-prone sequences', async () => {
    const events = [
      // Session 1: search → fetch → ERROR
      makeEvent({ id: 'e1', timestamp: '2024-01-01T00:01:00Z', sessionId: 'ses-1', eventType: 'tool_call', payload: { toolName: 'search', callId: 'c1', arguments: {} } }),
      makeEvent({ id: 'e2', timestamp: '2024-01-01T00:02:00Z', sessionId: 'ses-1', eventType: 'tool_call', payload: { toolName: 'fetch', callId: 'c2', arguments: {} } }),
      makeEvent({ id: 'e3', timestamp: '2024-01-01T00:03:00Z', sessionId: 'ses-1', eventType: 'tool_error', severity: 'error', payload: { error: 'timeout', callId: 'c3', toolName: 'fetch', durationMs: 5000 } }),
    ];

    const store = createMockStore(events);
    const result = await analyzeToolSequences(store);

    const searchFetch = result.sequences.find(
      (s) => s.tools.length === 2 && s.tools[0] === 'search' && s.tools[1] === 'fetch',
    );
    expect(searchFetch).toBeTruthy();
    expect(searchFetch!.errorRate).toBeGreaterThan(0);
  });

  it('computes stats correctly', async () => {
    const events = [
      makeEvent({ id: 'e1', timestamp: '2024-01-01T00:01:00Z', sessionId: 'ses-1', payload: { toolName: 'search', callId: 'c1', arguments: {} } }),
      makeEvent({ id: 'e2', timestamp: '2024-01-01T00:02:00Z', sessionId: 'ses-1', payload: { toolName: 'fetch', callId: 'c2', arguments: {} } }),
      makeEvent({ id: 'e3', timestamp: '2024-01-01T00:03:00Z', sessionId: 'ses-1', payload: { toolName: 'parse', callId: 'c3', arguments: {} } }),
      makeEvent({ id: 'e4', timestamp: '2024-01-02T00:01:00Z', sessionId: 'ses-2', payload: { toolName: 'search', callId: 'c4', arguments: {} } }),
    ];

    const store = createMockStore(events);
    const result = await analyzeToolSequences(store);

    expect(result.stats.uniqueTools).toBe(3); // search, fetch, parse
    expect(result.stats.totalCalls).toBe(4);
    expect(result.stats.avgSequenceLength).toBe(2); // (3 + 1) / 2
  });

  it('respects limit parameter', async () => {
    // Create events with many unique sequences
    const events: AgentLensEvent[] = [];
    for (let i = 0; i < 30; i++) {
      events.push(
        makeEvent({
          id: `e${i}a`,
          timestamp: `2024-01-${String(i + 1).padStart(2, '0')}T00:01:00Z`,
          sessionId: `ses-${i}`,
          payload: { toolName: `tool_a_${i}`, callId: `c${i}a`, arguments: {} },
        }),
        makeEvent({
          id: `e${i}b`,
          timestamp: `2024-01-${String(i + 1).padStart(2, '0')}T00:02:00Z`,
          sessionId: `ses-${i}`,
          payload: { toolName: `tool_b_${i}`, callId: `c${i}b`, arguments: {} },
        }),
      );
    }

    const store = createMockStore(events);
    const result = await analyzeToolSequences(store, { limit: 5 });

    expect(result.sequences.length).toBe(5);
  });
});
