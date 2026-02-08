/**
 * Tests for Cost Analysis (Story 4.3)
 */

import { describe, it, expect } from 'vitest';
import { analyzeCosts } from '../cost-analysis.js';
import type { IEventStore, AgentLensEvent, Session, EventQueryResult } from '@agentlensai/core';

function createMockStore(opts: {
  sessions?: Session[];
  events?: AgentLensEvent[];
}): IEventStore {
  const sessions = opts.sessions ?? [];
  const events = opts.events ?? [];

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
    queryEvents: async (query: any) => {
      let filtered = [...events];
      if (query.eventType) {
        const types = Array.isArray(query.eventType) ? query.eventType : [query.eventType];
        filtered = filtered.filter((e) => types.includes(e.eventType));
      }
      if (query.agentId) {
        filtered = filtered.filter((e) => e.agentId === query.agentId);
      }
      filtered.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      return {
        events: filtered,
        total: filtered.length,
        hasMore: false,
      } as EventQueryResult;
    },
  } as unknown as IEventStore;
}

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: `ses-${Math.random().toString(36).slice(2)}`,
    agentId: 'agent-1',
    startedAt: '2024-01-01T00:00:00Z',
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

function makeEvent(overrides: Partial<AgentLensEvent>): AgentLensEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    sessionId: 'ses-1',
    agentId: 'agent-1',
    eventType: 'llm_response',
    severity: 'info',
    payload: {},
    metadata: {},
    prevHash: null,
    hash: 'abc',
    tenantId: 'default',
    ...overrides,
  };
}

describe('analyzeCosts', () => {
  it('returns zeros when no sessions exist', async () => {
    const store = createMockStore({ sessions: [], events: [] });
    const result = await analyzeCosts(store);

    expect(result.summary.totalCost).toBe(0);
    expect(result.summary.totalSessions).toBe(0);
    expect(result.summary.avgPerSession).toBe(0);
    expect(result.byModel).toEqual([]);
    expect(result.byAgent).toEqual([]);
  });

  it('calculates total cost and averages from sessions', async () => {
    const sessions = [
      makeSession({ id: 'ses-1', totalCostUsd: 0.05, startedAt: '2024-01-01T00:00:00Z' }),
      makeSession({ id: 'ses-2', totalCostUsd: 0.10, startedAt: '2024-01-02T00:00:00Z' }),
      makeSession({ id: 'ses-3', totalCostUsd: 0.15, startedAt: '2024-01-03T00:00:00Z' }),
    ];

    const store = createMockStore({ sessions, events: [] });
    const result = await analyzeCosts(store);

    expect(result.summary.totalCost).toBeCloseTo(0.30, 4);
    expect(result.summary.totalSessions).toBe(3);
    expect(result.summary.avgPerSession).toBeCloseTo(0.10, 4);
  });

  it('breaks down cost by model', async () => {
    const events = [
      makeEvent({
        payload: { callId: 'c1', provider: 'anthropic', model: 'claude-3-opus', completion: '', finishReason: 'stop', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, costUsd: 0.05, latencyMs: 100 },
      }),
      makeEvent({
        payload: { callId: 'c2', provider: 'openai', model: 'gpt-4o', completion: '', finishReason: 'stop', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, costUsd: 0.03, latencyMs: 80 },
      }),
      makeEvent({
        payload: { callId: 'c3', provider: 'anthropic', model: 'claude-3-opus', completion: '', finishReason: 'stop', usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 }, costUsd: 0.10, latencyMs: 200 },
      }),
    ];

    const store = createMockStore({ sessions: [], events });
    const result = await analyzeCosts(store);

    expect(result.byModel.length).toBe(2);
    const claude = result.byModel.find((m) => m.model === 'claude-3-opus');
    expect(claude).toBeTruthy();
    expect(claude!.callCount).toBe(2);
    expect(claude!.totalCost).toBeCloseTo(0.15, 4);

    const gpt = result.byModel.find((m) => m.model === 'gpt-4o');
    expect(gpt).toBeTruthy();
    expect(gpt!.callCount).toBe(1);
    expect(gpt!.totalCost).toBeCloseTo(0.03, 4);
  });

  it('breaks down cost by agent', async () => {
    const sessions = [
      makeSession({ id: 'ses-1', agentId: 'agent-a', totalCostUsd: 0.10 }),
      makeSession({ id: 'ses-2', agentId: 'agent-a', totalCostUsd: 0.20 }),
      makeSession({ id: 'ses-3', agentId: 'agent-b', totalCostUsd: 0.05 }),
    ];

    const store = createMockStore({ sessions, events: [] });
    const result = await analyzeCosts(store);

    expect(result.byAgent.length).toBe(2);
    const agentA = result.byAgent.find((a) => a.agentId === 'agent-a');
    expect(agentA!.totalCost).toBeCloseTo(0.30, 4);
    expect(agentA!.sessionCount).toBe(2);
  });

  it('detects increasing cost trend', async () => {
    const sessions: Session[] = [];
    // Previous 7 days: low cost
    for (let d = 1; d <= 7; d++) {
      sessions.push(
        makeSession({
          id: `ses-old-${d}`,
          startedAt: `2024-01-${String(d).padStart(2, '0')}T00:00:00Z`,
          totalCostUsd: 0.01,
        }),
      );
    }
    // Recent 7 days: high cost
    for (let d = 8; d <= 14; d++) {
      sessions.push(
        makeSession({
          id: `ses-new-${d}`,
          startedAt: `2024-01-${String(d).padStart(2, '0')}T00:00:00Z`,
          totalCostUsd: 0.10,
        }),
      );
    }

    const store = createMockStore({ sessions, events: [] });
    const result = await analyzeCosts(store);

    expect(result.trend.direction).toBe('increasing');
  });

  it('detects decreasing cost trend', async () => {
    const sessions: Session[] = [];
    // Previous 7 days: high cost
    for (let d = 1; d <= 7; d++) {
      sessions.push(
        makeSession({
          id: `ses-old-${d}`,
          startedAt: `2024-01-${String(d).padStart(2, '0')}T00:00:00Z`,
          totalCostUsd: 0.10,
        }),
      );
    }
    // Recent 7 days: low cost
    for (let d = 8; d <= 14; d++) {
      sessions.push(
        makeSession({
          id: `ses-new-${d}`,
          startedAt: `2024-01-${String(d).padStart(2, '0')}T00:00:00Z`,
          totalCostUsd: 0.01,
        }),
      );
    }

    const store = createMockStore({ sessions, events: [] });
    const result = await analyzeCosts(store);

    expect(result.trend.direction).toBe('decreasing');
  });

  it('returns top sessions sorted by cost desc', async () => {
    const sessions = [
      makeSession({ id: 'ses-cheap', totalCostUsd: 0.01, startedAt: '2024-01-01T00:00:00Z' }),
      makeSession({ id: 'ses-expensive', totalCostUsd: 1.00, startedAt: '2024-01-02T00:00:00Z' }),
      makeSession({ id: 'ses-mid', totalCostUsd: 0.50, startedAt: '2024-01-03T00:00:00Z' }),
    ];

    const store = createMockStore({ sessions, events: [] });
    const result = await analyzeCosts(store);

    expect(result.topSessions[0]!.sessionId).toBe('ses-expensive');
    expect(result.topSessions[1]!.sessionId).toBe('ses-mid');
    expect(result.topSessions[2]!.sessionId).toBe('ses-cheap');
  });

  it('filters by model when specified', async () => {
    const events = [
      makeEvent({
        payload: { callId: 'c1', provider: 'anthropic', model: 'claude-3-opus', completion: '', finishReason: 'stop', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, costUsd: 0.05, latencyMs: 100 },
      }),
      makeEvent({
        payload: { callId: 'c2', provider: 'openai', model: 'gpt-4o', completion: '', finishReason: 'stop', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, costUsd: 0.03, latencyMs: 80 },
      }),
    ];

    const store = createMockStore({ sessions: [], events });
    const result = await analyzeCosts(store, { model: 'gpt-4o' });

    expect(result.byModel.length).toBe(1);
    expect(result.byModel[0]!.model).toBe('gpt-4o');
  });
});
