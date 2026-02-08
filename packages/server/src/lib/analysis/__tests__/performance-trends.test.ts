/**
 * Tests for Performance Trends Analysis (Story 4.4)
 */

import { describe, it, expect } from 'vitest';
import { analyzePerformance } from '../performance-trends.js';
import type { IEventStore, Session } from '@agentlensai/core';

function createMockStore(sessions: Session[]): IEventStore {
  return {
    querySessions: async (query: any) => {
      let filtered = [...sessions];
      if (query.agentId) {
        filtered = filtered.filter((s) => s.agentId === query.agentId);
      }
      if (query.from) {
        filtered = filtered.filter((s) => s.startedAt >= query.from!);
      }
      if (query.to) {
        filtered = filtered.filter((s) => s.startedAt <= query.to!);
      }
      return { sessions: filtered, total: filtered.length };
    },
    countEvents: async () => {
      return sessions.reduce((sum, s) => sum + s.eventCount, 0);
    },
  } as unknown as IEventStore;
}

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: `ses-${Math.random().toString(36).slice(2)}`,
    agentId: 'agent-1',
    startedAt: '2024-01-01T00:00:00Z',
    endedAt: '2024-01-01T01:00:00Z',
    status: 'completed',
    eventCount: 10,
    toolCallCount: 5,
    errorCount: 0,
    totalCostUsd: 0,
    llmCallCount: 3,
    totalInputTokens: 1000,
    totalOutputTokens: 500,
    tags: [],
    tenantId: 'default',
    ...overrides,
  };
}

describe('analyzePerformance', () => {
  it('returns zeros when no sessions exist', async () => {
    const store = createMockStore([]);
    const result = await analyzePerformance(store);

    expect(result.current.successRate).toBe(0);
    expect(result.current.avgDuration).toBe(0);
    expect(result.current.avgToolCalls).toBe(0);
    expect(result.current.avgErrors).toBe(0);
    expect(result.trends).toEqual([]);
    expect(result.assessment).toBe('stable');
  });

  it('calculates success rate correctly', async () => {
    const sessions = [
      makeSession({ id: 'ses-1', errorCount: 0 }),
      makeSession({ id: 'ses-2', errorCount: 0 }),
      makeSession({ id: 'ses-3', errorCount: 2 }),
      makeSession({ id: 'ses-4', errorCount: 0 }),
    ];

    const store = createMockStore(sessions);
    const result = await analyzePerformance(store);

    expect(result.current.successRate).toBe(0.75); // 3/4
  });

  it('calculates average duration', async () => {
    const sessions = [
      makeSession({
        id: 'ses-1',
        startedAt: '2024-01-01T00:00:00Z',
        endedAt: '2024-01-01T00:10:00Z', // 10 min = 600000 ms
      }),
      makeSession({
        id: 'ses-2',
        startedAt: '2024-01-01T01:00:00Z',
        endedAt: '2024-01-01T01:20:00Z', // 20 min = 1200000 ms
      }),
    ];

    const store = createMockStore(sessions);
    const result = await analyzePerformance(store);

    expect(result.current.avgDuration).toBe(900000); // avg of 600000 and 1200000
  });

  it('calculates average tool calls and errors', async () => {
    const sessions = [
      makeSession({ id: 'ses-1', toolCallCount: 10, errorCount: 2 }),
      makeSession({ id: 'ses-2', toolCallCount: 20, errorCount: 0 }),
    ];

    const store = createMockStore(sessions);
    const result = await analyzePerformance(store);

    expect(result.current.avgToolCalls).toBe(15);
    expect(result.current.avgErrors).toBe(1);
  });

  it('buckets by day for trend lines', async () => {
    const sessions = [
      makeSession({ id: 'ses-1', startedAt: '2024-01-01T10:00:00Z', endedAt: '2024-01-01T11:00:00Z', errorCount: 0, toolCallCount: 5 }),
      makeSession({ id: 'ses-2', startedAt: '2024-01-01T14:00:00Z', endedAt: '2024-01-01T15:00:00Z', errorCount: 1, toolCallCount: 8 }),
      makeSession({ id: 'ses-3', startedAt: '2024-01-02T10:00:00Z', endedAt: '2024-01-02T11:00:00Z', errorCount: 0, toolCallCount: 3 }),
    ];

    const store = createMockStore(sessions);
    const result = await analyzePerformance(store);

    expect(result.trends.length).toBe(2);
    expect(result.trends[0]!.date).toBe('2024-01-01');
    expect(result.trends[0]!.successRate).toBe(0.5); // 1/2 sessions had 0 errors
    expect(result.trends[1]!.date).toBe('2024-01-02');
    expect(result.trends[1]!.successRate).toBe(1); // 1/1 session had 0 errors
  });

  it('detects improving performance', async () => {
    const sessions: Session[] = [];

    // Historical: lots of errors
    for (let d = 1; d <= 5; d++) {
      sessions.push(
        makeSession({
          id: `ses-old-${d}`,
          startedAt: `2024-01-${String(d).padStart(2, '0')}T00:00:00Z`,
          endedAt: `2024-01-${String(d).padStart(2, '0')}T01:00:00Z`,
          errorCount: 3,
        }),
      );
    }

    // Recent: no errors
    for (let d = 6; d <= 10; d++) {
      sessions.push(
        makeSession({
          id: `ses-new-${d}`,
          startedAt: `2024-01-${String(d).padStart(2, '0')}T00:00:00Z`,
          endedAt: `2024-01-${String(d).padStart(2, '0')}T01:00:00Z`,
          errorCount: 0,
        }),
      );
    }

    const store = createMockStore(sessions);
    const result = await analyzePerformance(store);

    expect(result.assessment).toBe('improving');
  });

  it('detects degrading performance', async () => {
    const sessions: Session[] = [];

    // Historical: no errors
    for (let d = 1; d <= 5; d++) {
      sessions.push(
        makeSession({
          id: `ses-old-${d}`,
          startedAt: `2024-01-${String(d).padStart(2, '0')}T00:00:00Z`,
          endedAt: `2024-01-${String(d).padStart(2, '0')}T01:00:00Z`,
          errorCount: 0,
        }),
      );
    }

    // Recent: lots of errors
    for (let d = 6; d <= 10; d++) {
      sessions.push(
        makeSession({
          id: `ses-new-${d}`,
          startedAt: `2024-01-${String(d).padStart(2, '0')}T00:00:00Z`,
          endedAt: `2024-01-${String(d).padStart(2, '0')}T01:00:00Z`,
          errorCount: 5,
        }),
      );
    }

    const store = createMockStore(sessions);
    const result = await analyzePerformance(store);

    expect(result.assessment).toBe('degrading');
  });

  it('respects limit on trend buckets', async () => {
    const sessions: Session[] = [];
    for (let d = 1; d <= 30; d++) {
      sessions.push(
        makeSession({
          id: `ses-${d}`,
          startedAt: `2024-01-${String(d).padStart(2, '0')}T00:00:00Z`,
          endedAt: `2024-01-${String(d).padStart(2, '0')}T01:00:00Z`,
        }),
      );
    }

    const store = createMockStore(sessions);
    const result = await analyzePerformance(store, { limit: 7 });

    expect(result.trends.length).toBe(7);
  });

  it('includes metadata', async () => {
    const sessions = [
      makeSession({ id: 'ses-1', eventCount: 20, startedAt: '2024-01-01T00:00:00Z' }),
      makeSession({ id: 'ses-2', eventCount: 30, startedAt: '2024-01-02T00:00:00Z' }),
    ];

    const store = createMockStore(sessions);
    const result = await analyzePerformance(store);

    expect(result.metadata.sessionsAnalyzed).toBe(2);
    expect(result.metadata.eventsAnalyzed).toBe(50);
  });
});
