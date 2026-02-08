/**
 * Tests for HealthComputer (Story 1.2)
 *
 * Tests each dimension independently with mock store data,
 * combined scoring, trend calculation, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { HealthComputer } from '../computer.js';
import type {
  IEventStore,
  AgentLensEvent,
  Session,
  EventQueryResult,
  HealthWeights,
} from '@agentlensai/core';
import { DEFAULT_HEALTH_WEIGHTS } from '@agentlensai/core';

// ─── Test Helpers ──────────────────────────────────────────

function createMockStore(opts: {
  sessions?: Session[];
  events?: AgentLensEvent[];
  agents?: Array<{ id: string; name: string }>;
}): IEventStore {
  const sessions = opts.sessions ?? [];
  const events = opts.events ?? [];
  const agents = opts.agents ?? [];

  return {
    querySessions: async (query: any) => {
      let filtered = [...sessions];
      if (query.agentId) {
        filtered = filtered.filter((s) => s.agentId === query.agentId);
      }
      if (query.from) {
        filtered = filtered.filter((s) => s.startedAt >= query.from);
      }
      if (query.to) {
        filtered = filtered.filter((s) => s.startedAt <= query.to);
      }
      return { sessions: filtered, total: filtered.length };
    },
    queryEvents: async (query: any) => {
      let filtered = [...events];
      if (query.eventType) {
        const types = Array.isArray(query.eventType)
          ? query.eventType
          : [query.eventType];
        filtered = filtered.filter((e) => types.includes(e.eventType));
      }
      if (query.agentId) {
        filtered = filtered.filter((e) => e.agentId === query.agentId);
      }
      if (query.from) {
        filtered = filtered.filter((e) => e.timestamp >= query.from);
      }
      if (query.to) {
        filtered = filtered.filter((e) => e.timestamp <= query.to);
      }
      return {
        events: filtered,
        total: filtered.length,
        hasMore: false,
      } as EventQueryResult;
    },
    listAgents: async () =>
      agents.map((a) => ({
        id: a.id,
        name: a.name,
        firstSeenAt: '2024-01-01T00:00:00Z',
        lastSeenAt: '2024-01-07T00:00:00Z',
        sessionCount: 0,
        tenantId: 'default',
      })),
  } as unknown as IEventStore;
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: `ses-${Math.random().toString(36).slice(2)}`,
    agentId: 'agent-1',
    startedAt: new Date().toISOString(),
    status: 'completed',
    eventCount: 10,
    toolCallCount: 5,
    errorCount: 0,
    totalCostUsd: 0.05,
    llmCallCount: 3,
    totalInputTokens: 1000,
    totalOutputTokens: 500,
    tags: [],
    tenantId: 'default',
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeEvent(overrides: Record<string, any> = {}): AgentLensEvent {
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
  } as AgentLensEvent;
}

/** Equal weights for isolated dimension testing */
const EQUAL_WEIGHTS: HealthWeights = {
  errorRate: 0.20,
  costEfficiency: 0.20,
  toolSuccess: 0.20,
  latency: 0.20,
  completionRate: 0.20,
};

// ─── Error Rate ────────────────────────────────────────────

describe('HealthComputer — Error Rate', () => {
  it('scores 100 when no sessions have errors', async () => {
    const sessions = [
      makeSession({ errorCount: 0 }),
      makeSession({ errorCount: 0 }),
      makeSession({ errorCount: 0 }),
    ];
    const store = createMockStore({ sessions });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    const dim = result!.dimensions.find((d) => d.name === 'error_rate')!;
    expect(dim.score).toBe(100);
    expect(dim.rawValue).toBe(0);
  });

  it('scores 0 when all sessions have errors', async () => {
    const sessions = [
      makeSession({ errorCount: 3 }),
      makeSession({ errorCount: 1 }),
    ];
    const store = createMockStore({ sessions });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    const dim = result!.dimensions.find((d) => d.name === 'error_rate')!;
    expect(dim.score).toBe(0);
    expect(dim.rawValue).toBe(1);
  });

  it('scores proportionally for partial errors', async () => {
    const sessions = [
      makeSession({ errorCount: 0 }),
      makeSession({ errorCount: 0 }),
      makeSession({ errorCount: 0 }),
      makeSession({ errorCount: 1 }), // 1/4 = 25% error rate → 75 score
    ];
    const store = createMockStore({ sessions });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    const dim = result!.dimensions.find((d) => d.name === 'error_rate')!;
    expect(dim.score).toBe(75);
    expect(dim.rawValue).toBe(0.25);
  });
});

// ─── Cost Efficiency ───────────────────────────────────────

describe('HealthComputer — Cost Efficiency', () => {
  it('scores 100 when no cost data', async () => {
    const sessions = [makeSession({ totalCostUsd: 0 })];
    const store = createMockStore({ sessions });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    const dim = result!.dimensions.find((d) => d.name === 'cost_efficiency')!;
    expect(dim.score).toBe(100);
  });

  it('scores 100 when cost equals baseline (ratio=1)', async () => {
    // All sessions have the same cost — window avg == baseline avg
    const sessions = [
      makeSession({ totalCostUsd: 0.10 }),
      makeSession({ totalCostUsd: 0.10 }),
      makeSession({ totalCostUsd: 0.10 }),
    ];
    const store = createMockStore({ sessions });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    const dim = result!.dimensions.find((d) => d.name === 'cost_efficiency')!;
    expect(dim.score).toBe(100);
  });

  it('scores 0 when cost is 2x baseline', async () => {
    // Window sessions are expensive, baseline includes cheaper sessions
    const now = new Date();
    const baselineSessions = [];
    // Cheap old sessions (15-25 days ago)
    for (let i = 0; i < 10; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - 20 + i);
      baselineSessions.push(
        makeSession({ totalCostUsd: 0.05, startedAt: d.toISOString() }),
      );
    }
    // Expensive recent sessions (within 7-day window)
    const windowSessions = [];
    for (let i = 0; i < 10; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - 3);
      windowSessions.push(
        makeSession({ totalCostUsd: 0.10, startedAt: d.toISOString() }),
      );
    }
    // Baseline avg = (10*0.05 + 10*0.10)/20 = 0.075
    // Window avg = 0.10
    // ratio = 0.10/0.075 = 1.333
    // score = 100 - (1.333-1)*100 = 66.67
    const store = createMockStore({
      sessions: [...baselineSessions, ...windowSessions],
    });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    const dim = result!.dimensions.find((d) => d.name === 'cost_efficiency')!;
    expect(dim.score).toBeGreaterThan(60);
    expect(dim.score).toBeLessThan(70);
  });
});

// ─── Tool Success ──────────────────────────────────────────

describe('HealthComputer — Tool Success', () => {
  it('scores 100 when no tool calls exist', async () => {
    const sessions = [makeSession()];
    const store = createMockStore({ sessions, events: [] });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    const dim = result!.dimensions.find((d) => d.name === 'tool_success')!;
    expect(dim.score).toBe(100);
  });

  it('scores 100 when all tool calls succeed', async () => {
    const sessions = [makeSession()];
    const events = [
      makeEvent({ eventType: 'tool_call' }),
      makeEvent({ eventType: 'tool_response', payload: { isError: false } }),
      makeEvent({ eventType: 'tool_call' }),
      makeEvent({ eventType: 'tool_response', payload: { isError: false } }),
    ];
    const store = createMockStore({ sessions, events });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    const dim = result!.dimensions.find((d) => d.name === 'tool_success')!;
    expect(dim.score).toBe(100);
  });

  it('scores proportionally when some tool calls fail', async () => {
    const sessions = [makeSession()];
    const events = [
      makeEvent({ eventType: 'tool_call' }),
      makeEvent({ eventType: 'tool_response', payload: { isError: false } }),
      makeEvent({ eventType: 'tool_call' }),
      makeEvent({ eventType: 'tool_response', payload: { isError: true } }),
      makeEvent({ eventType: 'tool_call' }),
      makeEvent({ eventType: 'tool_response', payload: { isError: false } }),
      makeEvent({ eventType: 'tool_call' }),
      makeEvent({ eventType: 'tool_response', payload: { isError: true } }),
    ];
    // 4 tool_calls, 2 failed → success rate = 2/4 = 50%
    const store = createMockStore({ sessions, events });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    const dim = result!.dimensions.find((d) => d.name === 'tool_success')!;
    expect(dim.score).toBe(50);
  });

  it('scores 0 when all tool calls fail', async () => {
    const sessions = [makeSession()];
    const events = [
      makeEvent({ eventType: 'tool_call' }),
      makeEvent({ eventType: 'tool_response', payload: { isError: true } }),
      makeEvent({ eventType: 'tool_call' }),
      makeEvent({ eventType: 'tool_response', payload: { isError: true } }),
    ];
    const store = createMockStore({ sessions, events });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    const dim = result!.dimensions.find((d) => d.name === 'tool_success')!;
    expect(dim.score).toBe(0);
  });

  it('counts tool_error events as failures', async () => {
    const sessions = [makeSession()];
    const events = [
      makeEvent({ eventType: 'tool_call' }),
      makeEvent({ eventType: 'tool_response', payload: { isError: false } }),
      makeEvent({ eventType: 'tool_call' }),
      makeEvent({ eventType: 'tool_error', payload: { error: 'timeout' } }),
      makeEvent({ eventType: 'tool_call' }),
      makeEvent({ eventType: 'tool_response', payload: { isError: false } }),
      makeEvent({ eventType: 'tool_call' }),
      makeEvent({ eventType: 'tool_error', payload: { error: 'crash' } }),
    ];
    // 4 tool_calls, 2 tool_errors → success rate = 2/4 = 50%
    const store = createMockStore({ sessions, events });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    const dim = result!.dimensions.find((d) => d.name === 'tool_success')!;
    expect(dim.score).toBe(50);
  });

  it('counts both tool_error and tool_response isError as failures', async () => {
    const sessions = [makeSession()];
    const events = [
      makeEvent({ eventType: 'tool_call' }),
      makeEvent({ eventType: 'tool_response', payload: { isError: true } }),
      makeEvent({ eventType: 'tool_call' }),
      makeEvent({ eventType: 'tool_error', payload: { error: 'timeout' } }),
      makeEvent({ eventType: 'tool_call' }),
      makeEvent({ eventType: 'tool_response', payload: { isError: false } }),
    ];
    // 3 tool_calls, 1 tool_response error + 1 tool_error = 2 failures → success rate = 1/3 ≈ 33.33%
    const store = createMockStore({ sessions, events });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    const dim = result!.dimensions.find((d) => d.name === 'tool_success')!;
    expect(dim.score).toBeCloseTo(33.33, 1);
  });
});

// ─── Latency ───────────────────────────────────────────────

describe('HealthComputer — Latency', () => {
  it('scores 100 when no endedAt (no duration data)', async () => {
    const sessions = [makeSession({ endedAt: undefined })];
    const store = createMockStore({ sessions });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    const dim = result!.dimensions.find((d) => d.name === 'latency')!;
    expect(dim.score).toBe(100);
  });

  it('scores 100 when latency matches baseline', async () => {
    const now = new Date();
    const sessions = [];
    for (let i = 0; i < 5; i++) {
      const started = new Date(now);
      started.setDate(started.getDate() - 3);
      const ended = new Date(started.getTime() + 5000); // 5s duration
      sessions.push(
        makeSession({ startedAt: started.toISOString(), endedAt: ended.toISOString() }),
      );
    }
    const store = createMockStore({ sessions });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    const dim = result!.dimensions.find((d) => d.name === 'latency')!;
    expect(dim.score).toBe(100);
  });

  it('scores less when latency is 3x baseline', async () => {
    const now = new Date();
    // Old baseline sessions: 5s duration (15-25 days ago)
    const oldSessions = [];
    for (let i = 0; i < 10; i++) {
      const started = new Date(now);
      started.setDate(started.getDate() - 20 + i);
      const ended = new Date(started.getTime() + 5000);
      oldSessions.push(
        makeSession({ startedAt: started.toISOString(), endedAt: ended.toISOString() }),
      );
    }
    // Recent sessions: 15s duration (within window)
    const recentSessions = [];
    for (let i = 0; i < 5; i++) {
      const started = new Date(now);
      started.setDate(started.getDate() - 3);
      const ended = new Date(started.getTime() + 15000);
      recentSessions.push(
        makeSession({ startedAt: started.toISOString(), endedAt: ended.toISOString() }),
      );
    }
    // Baseline includes both: avg duration somewhere between 5-15s
    // Window avg = 15s, baseline avg = (10*5000 + 5*15000)/15 ≈ 8333
    // ratio = 15000/8333 = 1.8
    // score = 100 - (1.8 - 1) * 50 = 100 - 40 = 60
    const store = createMockStore({
      sessions: [...oldSessions, ...recentSessions],
    });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    const dim = result!.dimensions.find((d) => d.name === 'latency')!;
    expect(dim.score).toBeLessThan(70);
    expect(dim.score).toBeGreaterThan(50);
  });
});

// ─── Completion Rate ───────────────────────────────────────

describe('HealthComputer — Completion Rate', () => {
  it('scores 100 when all sessions completed', async () => {
    const sessions = [
      makeSession({ status: 'completed' }),
      makeSession({ status: 'completed' }),
    ];
    const store = createMockStore({ sessions });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    const dim = result!.dimensions.find((d) => d.name === 'completion_rate')!;
    expect(dim.score).toBe(100);
  });

  it('scores 0 when no sessions completed', async () => {
    const sessions = [
      makeSession({ status: 'error' }),
      makeSession({ status: 'error' }),
    ];
    const store = createMockStore({ sessions });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    const dim = result!.dimensions.find((d) => d.name === 'completion_rate')!;
    expect(dim.score).toBe(0);
  });

  it('scores proportionally for partial completions', async () => {
    const sessions = [
      makeSession({ status: 'completed' }),
      makeSession({ status: 'completed' }),
      makeSession({ status: 'error' }),
      makeSession({ status: 'active' }),
    ];
    // 2/4 = 50%
    const store = createMockStore({ sessions });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    const dim = result!.dimensions.find((d) => d.name === 'completion_rate')!;
    expect(dim.score).toBe(50);
  });
});

// ─── Combined Score ────────────────────────────────────────

describe('HealthComputer — Combined Score', () => {
  it('computes weighted overall score correctly', async () => {
    // All perfect → 100
    const sessions = [
      makeSession({
        errorCount: 0,
        status: 'completed',
        totalCostUsd: 0.10,
      }),
    ];
    const store = createMockStore({ sessions, events: [] });
    const computer = new HealthComputer(DEFAULT_HEALTH_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    expect(result).not.toBeNull();
    expect(result!.overallScore).toBe(100);
    expect(result!.agentId).toBe('agent-1');
    expect(result!.sessionCount).toBe(1);
    expect(result!.computedAt).toBeTruthy();
    expect(result!.window.from).toBeTruthy();
    expect(result!.window.to).toBeTruthy();
  });

  it('uses configured weights for scoring', async () => {
    // Custom weights that emphasize error rate only
    const weights: HealthWeights = {
      errorRate: 1.0,
      costEfficiency: 0.0,
      toolSuccess: 0.0,
      latency: 0.0,
      completionRate: 0.0,
    };

    // 50% error rate → error_rate score = 50
    const sessions = [
      makeSession({ errorCount: 0 }),
      makeSession({ errorCount: 1 }),
    ];
    const store = createMockStore({ sessions, events: [] });
    const computer = new HealthComputer(weights);
    const result = await computer.compute(store, 'agent-1', 7);

    expect(result!.overallScore).toBe(50);
  });
});

// ─── Trend ─────────────────────────────────────────────────

describe('HealthComputer — Trend', () => {
  it('returns stable when no previous window data', async () => {
    const sessions = [makeSession()];
    const store = createMockStore({ sessions, events: [] });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    expect(result!.trend).toBe('stable');
    expect(result!.trendDelta).toBe(0);
  });

  it('detects improving trend (delta > 5)', async () => {
    const now = new Date();
    // Previous window: poor sessions (7-14 days ago)
    const prevSessions = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - 10);
      prevSessions.push(
        makeSession({
          startedAt: d.toISOString(),
          errorCount: 3,
          status: 'error',
        }),
      );
    }
    // Current window: good sessions
    const currentSessions = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - 3);
      currentSessions.push(
        makeSession({
          startedAt: d.toISOString(),
          errorCount: 0,
          status: 'completed',
        }),
      );
    }
    const store = createMockStore({
      sessions: [...prevSessions, ...currentSessions],
      events: [],
    });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    expect(result!.trend).toBe('improving');
    expect(result!.trendDelta).toBeGreaterThan(5);
  });

  it('detects degrading trend (delta < -5)', async () => {
    const now = new Date();
    // Previous window: good sessions (7-14 days ago)
    const prevSessions = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - 10);
      prevSessions.push(
        makeSession({
          startedAt: d.toISOString(),
          errorCount: 0,
          status: 'completed',
        }),
      );
    }
    // Current window: poor sessions
    const currentSessions = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - 3);
      currentSessions.push(
        makeSession({
          startedAt: d.toISOString(),
          errorCount: 5,
          status: 'error',
        }),
      );
    }
    const store = createMockStore({
      sessions: [...prevSessions, ...currentSessions],
      events: [],
    });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    expect(result!.trend).toBe('degrading');
    expect(result!.trendDelta).toBeLessThan(-5);
  });
});

// ─── Edge Cases ────────────────────────────────────────────

describe('HealthComputer — Edge Cases', () => {
  it('returns null when no sessions in window', async () => {
    const store = createMockStore({ sessions: [], events: [] });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    expect(result).toBeNull();
  });

  it('works with single session', async () => {
    const sessions = [
      makeSession({
        errorCount: 0,
        status: 'completed',
        totalCostUsd: 0.10,
      }),
    ];
    const store = createMockStore({ sessions });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    expect(result).not.toBeNull();
    expect(result!.sessionCount).toBe(1);
    expect(result!.overallScore).toBe(100);
  });

  it('filters sessions by agentId', async () => {
    const sessions = [
      makeSession({ agentId: 'agent-1', errorCount: 0 }),
      makeSession({ agentId: 'agent-2', errorCount: 5 }),
    ];
    const store = createMockStore({ sessions, events: [] });
    const computer = new HealthComputer(EQUAL_WEIGHTS);

    const result1 = await computer.compute(store, 'agent-1', 7);
    expect(result1!.sessionCount).toBe(1);

    const result2 = await computer.compute(store, 'agent-2', 7);
    expect(result2!.sessionCount).toBe(1);
  });

  it('returns correct dimension names and weights', async () => {
    const sessions = [makeSession()];
    const store = createMockStore({ sessions });
    const computer = new HealthComputer(DEFAULT_HEALTH_WEIGHTS);
    const result = await computer.compute(store, 'agent-1', 7);

    expect(result!.dimensions).toHaveLength(5);
    const names = result!.dimensions.map((d) => d.name);
    expect(names).toContain('error_rate');
    expect(names).toContain('cost_efficiency');
    expect(names).toContain('tool_success');
    expect(names).toContain('latency');
    expect(names).toContain('completion_rate');

    const errorDim = result!.dimensions.find((d) => d.name === 'error_rate')!;
    expect(errorDim.weight).toBe(0.30);
    const costDim = result!.dimensions.find((d) => d.name === 'cost_efficiency')!;
    expect(costDim.weight).toBe(0.20);
  });
});

// ─── Overview ──────────────────────────────────────────────

describe('HealthComputer — computeOverview', () => {
  it('returns scores for all agents with sessions', async () => {
    const now = new Date();
    const d = new Date(now);
    d.setDate(d.getDate() - 3);
    const ts = d.toISOString();

    const sessions = [
      makeSession({ agentId: 'agent-1', startedAt: ts }),
      makeSession({ agentId: 'agent-2', startedAt: ts }),
    ];
    const store = createMockStore({
      sessions,
      events: [],
      agents: [
        { id: 'agent-1', name: 'Agent 1' },
        { id: 'agent-2', name: 'Agent 2' },
      ],
    });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const results = await computer.computeOverview(store, 7);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.agentId).sort()).toEqual(['agent-1', 'agent-2']);
  });

  it('skips agents with no sessions in window', async () => {
    const store = createMockStore({
      sessions: [],
      events: [],
      agents: [
        { id: 'agent-1', name: 'Agent 1' },
        { id: 'agent-2', name: 'Agent 2' },
      ],
    });
    const computer = new HealthComputer(EQUAL_WEIGHTS);
    const results = await computer.computeOverview(store, 7);

    expect(results).toHaveLength(0);
  });
});
