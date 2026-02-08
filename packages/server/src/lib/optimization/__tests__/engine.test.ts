/**
 * Tests for Recommendation Engine (Story 2.3)
 */

import { describe, it, expect } from 'vitest';
import { OptimizationEngine } from '../engine.js';
import type {
  IEventStore,
  AgentLensEvent,
  EventQueryResult,
  ModelCosts,
  LlmCallPayload,
  LlmResponsePayload,
} from '@agentlensai/core';

// ─── Test Helpers ──────────────────────────────────────────────────

let eventCounter = 0;

function makeCallEvent(overrides: {
  model: string;
  callId: string;
  agentId?: string;
  timestamp?: string;
  tools?: Array<{ name: string }>;
}): AgentLensEvent {
  eventCounter++;
  const payload: LlmCallPayload = {
    callId: overrides.callId,
    provider: 'test',
    model: overrides.model,
    messages: [],
    tools: overrides.tools?.map((t) => ({ name: t.name, description: '', parameters: {} })),
  };

  return {
    id: `evt-call-${eventCounter}`,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    sessionId: 'ses-1',
    agentId: overrides.agentId ?? 'agent-1',
    eventType: 'llm_call',
    severity: 'info',
    payload: payload as any,
    metadata: {},
    prevHash: null,
    hash: `hash-${eventCounter}`,
    tenantId: 'default',
  };
}

function makeResponseEvent(overrides: {
  callId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  agentId?: string;
  timestamp?: string;
  finishReason?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}): AgentLensEvent {
  eventCounter++;
  const payload: LlmResponsePayload = {
    callId: overrides.callId,
    provider: 'test',
    model: overrides.model,
    completion: 'response',
    finishReason: overrides.finishReason ?? 'stop',
    usage: {
      inputTokens: overrides.inputTokens,
      outputTokens: overrides.outputTokens,
      totalTokens: overrides.inputTokens + overrides.outputTokens,
    },
    costUsd: overrides.costUsd,
    latencyMs: 100,
    toolCalls: overrides.toolCalls,
  };

  return {
    id: `evt-resp-${eventCounter}`,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    sessionId: 'ses-1',
    agentId: overrides.agentId ?? 'agent-1',
    eventType: 'llm_response',
    severity: 'info',
    payload: payload as any,
    metadata: {},
    prevHash: null,
    hash: `hash-${eventCounter}`,
    tenantId: 'default',
  };
}

/**
 * Create a mock store from arrays of call and response events.
 */
function createMockStore(callEvents: AgentLensEvent[], responseEvents: AgentLensEvent[]): IEventStore {
  return {
    queryEvents: async (query: any) => {
      const eventType = query.eventType;
      let events: AgentLensEvent[];

      if (eventType === 'llm_call') {
        events = [...callEvents];
      } else if (eventType === 'llm_response') {
        events = [...responseEvents];
      } else {
        events = [];
      }

      // Apply agentId filter
      if (query.agentId) {
        events = events.filter((e) => e.agentId === query.agentId);
      }

      // Apply date filters
      if (query.from) {
        events = events.filter((e) => e.timestamp >= query.from);
      }
      if (query.to) {
        events = events.filter((e) => e.timestamp <= query.to);
      }

      return {
        events,
        total: events.length,
        hasMore: false,
      } as EventQueryResult;
    },
  } as unknown as IEventStore;
}

/** Standard model costs for tests */
const TEST_COSTS: ModelCosts = {
  'claude-opus-4': { input: 15.00, output: 75.00 },
  'claude-sonnet-4': { input: 3.00, output: 15.00 },
  'claude-haiku-3.5': { input: 0.80, output: 4.00 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
};

/**
 * Helper: generate N simple call+response pairs for a model.
 * Simple = 100 input tokens, 0 tool calls.
 */
function generateSimplePairs(
  model: string,
  count: number,
  costPerCall: number,
  opts?: { agentId?: string; failCount?: number },
): { calls: AgentLensEvent[]; responses: AgentLensEvent[] } {
  const calls: AgentLensEvent[] = [];
  const responses: AgentLensEvent[] = [];
  const failCount = opts?.failCount ?? 0;

  for (let i = 0; i < count; i++) {
    const callId = `${model}-simple-${i}-${Math.random().toString(36).slice(2)}`;
    calls.push(makeCallEvent({
      model,
      callId,
      agentId: opts?.agentId,
      tools: [],
    }));
    responses.push(makeResponseEvent({
      callId,
      model,
      inputTokens: 100,
      outputTokens: 50,
      costUsd: costPerCall,
      agentId: opts?.agentId,
      finishReason: i < failCount ? 'error' : 'stop',
    }));
  }

  return { calls, responses };
}

/**
 * Helper: generate N moderate call+response pairs for a model.
 * Moderate = 800 input tokens, 2 tool calls.
 */
function generateModeratePairs(
  model: string,
  count: number,
  costPerCall: number,
  opts?: { agentId?: string; failCount?: number },
): { calls: AgentLensEvent[]; responses: AgentLensEvent[] } {
  const calls: AgentLensEvent[] = [];
  const responses: AgentLensEvent[] = [];
  const failCount = opts?.failCount ?? 0;

  for (let i = 0; i < count; i++) {
    const callId = `${model}-moderate-${i}-${Math.random().toString(36).slice(2)}`;
    calls.push(makeCallEvent({
      model,
      callId,
      agentId: opts?.agentId,
    }));
    responses.push(makeResponseEvent({
      callId,
      model,
      inputTokens: 800,
      outputTokens: 200,
      costUsd: costPerCall,
      agentId: opts?.agentId,
      finishReason: i < failCount ? 'error' : 'stop',
      toolCalls: [
        { id: 't1', name: 'search', arguments: {} },
        { id: 't2', name: 'read', arguments: {} },
      ],
    }));
  }

  return { calls, responses };
}

/**
 * Helper: generate N complex call+response pairs for a model.
 * Complex = 5000 input tokens, 6 tool calls.
 */
function generateComplexPairs(
  model: string,
  count: number,
  costPerCall: number,
  opts?: { agentId?: string; failCount?: number },
): { calls: AgentLensEvent[]; responses: AgentLensEvent[] } {
  const calls: AgentLensEvent[] = [];
  const responses: AgentLensEvent[] = [];
  const failCount = opts?.failCount ?? 0;

  for (let i = 0; i < count; i++) {
    const callId = `${model}-complex-${i}-${Math.random().toString(36).slice(2)}`;
    calls.push(makeCallEvent({
      model,
      callId,
      agentId: opts?.agentId,
    }));
    responses.push(makeResponseEvent({
      callId,
      model,
      inputTokens: 5000,
      outputTokens: 2000,
      costUsd: costPerCall,
      agentId: opts?.agentId,
      finishReason: i < failCount ? 'error' : 'stop',
      toolCalls: Array.from({ length: 6 }, (_, j) => ({
        id: `t${j}`,
        name: `tool-${j}`,
        arguments: {},
      })),
    }));
  }

  return { calls, responses };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('OptimizationEngine', () => {
  it('recommends cheaper model for simple tasks (Opus → Haiku)', async () => {
    // Opus used for simple tasks, Haiku also used for simple tasks
    const opus = generateSimplePairs('claude-opus-4', 100, 0.05);
    const haiku = generateSimplePairs('claude-haiku-3.5', 100, 0.002);

    const store = createMockStore(
      [...opus.calls, ...haiku.calls],
      [...opus.responses, ...haiku.responses],
    );

    const engine = new OptimizationEngine(TEST_COSTS);
    const result = await engine.getRecommendations(store, { period: 7, limit: 10 });

    expect(result.recommendations.length).toBeGreaterThanOrEqual(1);
    const rec = result.recommendations.find(
      (r) => r.currentModel === 'claude-opus-4' && r.recommendedModel === 'claude-haiku-3.5',
    );
    expect(rec).toBeTruthy();
    expect(rec!.complexityTier).toBe('simple');
    expect(rec!.monthlySavings).toBeGreaterThan(0);
    expect(rec!.recommendedCostPerCall).toBeLessThan(rec!.currentCostPerCall);
  });

  it('returns no recommendations when only one model is used', async () => {
    const opus = generateSimplePairs('claude-opus-4', 100, 0.05);

    const store = createMockStore(opus.calls, opus.responses);
    const engine = new OptimizationEngine(TEST_COSTS);
    const result = await engine.getRecommendations(store, { period: 7, limit: 10 });

    expect(result.recommendations).toEqual([]);
    expect(result.totalPotentialSavings).toBe(0);
    expect(result.analyzedCalls).toBe(100);
  });

  it('returns empty results when no calls exist', async () => {
    const store = createMockStore([], []);
    const engine = new OptimizationEngine(TEST_COSTS);
    const result = await engine.getRecommendations(store, { period: 7, limit: 10 });

    expect(result.recommendations).toEqual([]);
    expect(result.totalPotentialSavings).toBe(0);
    expect(result.analyzedCalls).toBe(0);
    expect(result.period).toBe(7);
  });

  it('assigns low confidence for callVolume < 50', async () => {
    const opus = generateSimplePairs('claude-opus-4', 20, 0.05);
    const haiku = generateSimplePairs('claude-haiku-3.5', 20, 0.002);

    const store = createMockStore(
      [...opus.calls, ...haiku.calls],
      [...opus.responses, ...haiku.responses],
    );

    const engine = new OptimizationEngine(TEST_COSTS);
    const result = await engine.getRecommendations(store, { period: 7, limit: 10 });

    const rec = result.recommendations.find((r) => r.currentModel === 'claude-opus-4');
    expect(rec).toBeTruthy();
    expect(rec!.confidence).toBe('low');
  });

  it('assigns medium confidence for callVolume 50-200', async () => {
    const opus = generateSimplePairs('claude-opus-4', 100, 0.05);
    const haiku = generateSimplePairs('claude-haiku-3.5', 100, 0.002);

    const store = createMockStore(
      [...opus.calls, ...haiku.calls],
      [...opus.responses, ...haiku.responses],
    );

    const engine = new OptimizationEngine(TEST_COSTS);
    const result = await engine.getRecommendations(store, { period: 7, limit: 10 });

    const rec = result.recommendations.find((r) => r.currentModel === 'claude-opus-4');
    expect(rec).toBeTruthy();
    expect(rec!.confidence).toBe('medium');
  });

  it('assigns high confidence for callVolume > 200', async () => {
    const opus = generateSimplePairs('claude-opus-4', 250, 0.05);
    const haiku = generateSimplePairs('claude-haiku-3.5', 250, 0.002);

    const store = createMockStore(
      [...opus.calls, ...haiku.calls],
      [...opus.responses, ...haiku.responses],
    );

    const engine = new OptimizationEngine(TEST_COSTS);
    const result = await engine.getRecommendations(store, { period: 7, limit: 10 });

    const rec = result.recommendations.find((r) => r.currentModel === 'claude-opus-4');
    expect(rec).toBeTruthy();
    expect(rec!.confidence).toBe('high');
  });

  it('calculates monthly savings correctly', async () => {
    // 100 calls over 7 days: Opus at $0.05/call, Haiku at $0.002/call
    const opus = generateSimplePairs('claude-opus-4', 100, 0.05);
    const haiku = generateSimplePairs('claude-haiku-3.5', 100, 0.002);

    const store = createMockStore(
      [...opus.calls, ...haiku.calls],
      [...opus.responses, ...haiku.responses],
    );

    const engine = new OptimizationEngine(TEST_COSTS);
    const result = await engine.getRecommendations(store, { period: 7, limit: 10 });

    const rec = result.recommendations.find(
      (r) => r.currentModel === 'claude-opus-4' && r.recommendedModel === 'claude-haiku-3.5',
    );
    expect(rec).toBeTruthy();

    // Expected: (0.05 - 0.002) * 100 * (30/7) = 0.048 * 100 * 4.2857 ≈ 20.571
    const expectedSavings = (0.05 - 0.002) * 100 * (30 / 7);
    expect(rec!.monthlySavings).toBeCloseTo(expectedSavings, 2);
  });

  it('sorts recommendations by monthly savings descending', async () => {
    // Create two expensive models with different savings potential
    const opus = generateSimplePairs('claude-opus-4', 100, 0.10);         // most expensive
    const sonnet = generateSimplePairs('claude-sonnet-4', 100, 0.02);     // mid-range
    const haiku = generateSimplePairs('claude-haiku-3.5', 100, 0.002);    // cheapest

    const store = createMockStore(
      [...opus.calls, ...sonnet.calls, ...haiku.calls],
      [...opus.responses, ...sonnet.responses, ...haiku.responses],
    );

    const engine = new OptimizationEngine(TEST_COSTS);
    const result = await engine.getRecommendations(store, { period: 7, limit: 10 });

    expect(result.recommendations.length).toBeGreaterThanOrEqual(2);

    // Verify sorted by savings desc
    for (let i = 1; i < result.recommendations.length; i++) {
      expect(result.recommendations[i - 1]!.monthlySavings)
        .toBeGreaterThanOrEqual(result.recommendations[i]!.monthlySavings);
    }
  });

  it('respects the limit parameter', async () => {
    const opus = generateSimplePairs('claude-opus-4', 100, 0.10);
    const sonnet = generateSimplePairs('claude-sonnet-4', 100, 0.02);
    const haiku = generateSimplePairs('claude-haiku-3.5', 100, 0.002);

    const store = createMockStore(
      [...opus.calls, ...sonnet.calls, ...haiku.calls],
      [...opus.responses, ...sonnet.responses, ...haiku.responses],
    );

    const engine = new OptimizationEngine(TEST_COSTS);
    const result = await engine.getRecommendations(store, { period: 7, limit: 1 });

    expect(result.recommendations.length).toBe(1);
    // Should be the highest savings recommendation
    expect(result.recommendations[0]!.monthlySavings).toBeGreaterThan(0);
  });

  it('does not recommend model with <95% success rate', async () => {
    // Opus: 100% success, Haiku: 90% success (10 failures out of 100)
    const opus = generateSimplePairs('claude-opus-4', 100, 0.05);
    const haiku = generateSimplePairs('claude-haiku-3.5', 100, 0.002, { failCount: 10 });

    const store = createMockStore(
      [...opus.calls, ...haiku.calls],
      [...opus.responses, ...haiku.responses],
    );

    const engine = new OptimizationEngine(TEST_COSTS);
    const result = await engine.getRecommendations(store, { period: 7, limit: 10 });

    // Haiku has 90% success rate < 95%, should NOT be recommended
    const rec = result.recommendations.find(
      (r) => r.recommendedModel === 'claude-haiku-3.5',
    );
    expect(rec).toBeUndefined();
  });

  it('recommends model with exactly 95% success rate', async () => {
    // Opus: 100% success, Haiku: 95% success (5 failures out of 100)
    const opus = generateSimplePairs('claude-opus-4', 100, 0.05);
    const haiku = generateSimplePairs('claude-haiku-3.5', 100, 0.002, { failCount: 5 });

    const store = createMockStore(
      [...opus.calls, ...haiku.calls],
      [...opus.responses, ...haiku.responses],
    );

    const engine = new OptimizationEngine(TEST_COSTS);
    const result = await engine.getRecommendations(store, { period: 7, limit: 10 });

    const rec = result.recommendations.find(
      (r) => r.currentModel === 'claude-opus-4' && r.recommendedModel === 'claude-haiku-3.5',
    );
    expect(rec).toBeTruthy();
  });

  it('does not recommend more expensive model', async () => {
    // Haiku used, Opus also used — should NOT recommend Opus for Haiku tasks
    const haiku = generateSimplePairs('claude-haiku-3.5', 100, 0.002);
    const opus = generateSimplePairs('claude-opus-4', 100, 0.05);

    const store = createMockStore(
      [...haiku.calls, ...opus.calls],
      [...haiku.responses, ...opus.responses],
    );

    const engine = new OptimizationEngine(TEST_COSTS);
    const result = await engine.getRecommendations(store, { period: 7, limit: 10 });

    const rec = result.recommendations.find(
      (r) => r.currentModel === 'claude-haiku-3.5' && r.recommendedModel === 'claude-opus-4',
    );
    expect(rec).toBeUndefined();
  });

  it('reports totalPotentialSavings as sum of recommendation savings', async () => {
    const opus = generateSimplePairs('claude-opus-4', 100, 0.05);
    const haiku = generateSimplePairs('claude-haiku-3.5', 100, 0.002);

    const store = createMockStore(
      [...opus.calls, ...haiku.calls],
      [...opus.responses, ...haiku.responses],
    );

    const engine = new OptimizationEngine(TEST_COSTS);
    const result = await engine.getRecommendations(store, { period: 7, limit: 100 });

    const expectedTotal = result.recommendations.reduce((s, r) => s + r.monthlySavings, 0);
    expect(result.totalPotentialSavings).toBeCloseTo(expectedTotal, 4);
  });

  it('returns correct period in result', async () => {
    const store = createMockStore([], []);
    const engine = new OptimizationEngine(TEST_COSTS);
    const result = await engine.getRecommendations(store, { period: 14, limit: 10 });

    expect(result.period).toBe(14);
  });

  it('handles model not in cost table by using event payload cost', async () => {
    // "custom-model" is NOT in TEST_COSTS, but has event cost data
    // "claude-haiku-3.5" IS in TEST_COSTS
    const custom = generateSimplePairs('custom-model', 100, 0.08);
    const haiku = generateSimplePairs('claude-haiku-3.5', 100, 0.002);

    const store = createMockStore(
      [...custom.calls, ...haiku.calls],
      [...custom.responses, ...haiku.responses],
    );

    const engine = new OptimizationEngine(TEST_COSTS);
    const result = await engine.getRecommendations(store, { period: 7, limit: 10 });

    // custom-model should be analyzable via its event data
    const rec = result.recommendations.find(
      (r) => r.currentModel === 'custom-model' && r.recommendedModel === 'claude-haiku-3.5',
    );
    expect(rec).toBeTruthy();
    expect(rec!.monthlySavings).toBeGreaterThan(0);
  });

  it('does not recommend across different complexity tiers', async () => {
    // Opus used for complex tasks, Haiku used for simple tasks
    const opus = generateComplexPairs('claude-opus-4', 100, 0.20);
    const haiku = generateSimplePairs('claude-haiku-3.5', 100, 0.002);

    const store = createMockStore(
      [...opus.calls, ...haiku.calls],
      [...opus.responses, ...haiku.responses],
    );

    const engine = new OptimizationEngine(TEST_COSTS);
    const result = await engine.getRecommendations(store, { period: 7, limit: 10 });

    // Haiku has no data for 'complex' tier, so no recommendation for Opus complex
    const rec = result.recommendations.find(
      (r) => r.currentModel === 'claude-opus-4' && r.complexityTier === 'complex',
    );
    expect(rec).toBeUndefined();
  });

  it('returns analyzedCalls reflecting total call count', async () => {
    const opus = generateSimplePairs('claude-opus-4', 50, 0.05);
    const haiku = generateSimplePairs('claude-haiku-3.5', 30, 0.002);

    const store = createMockStore(
      [...opus.calls, ...haiku.calls],
      [...opus.responses, ...haiku.responses],
    );

    const engine = new OptimizationEngine(TEST_COSTS);
    const result = await engine.getRecommendations(store, { period: 7, limit: 10 });

    expect(result.analyzedCalls).toBe(80);
  });

  it('handles all models at same price — no savings possible', async () => {
    const sameCosts: ModelCosts = {
      'model-a': { input: 5.00, output: 15.00 },
      'model-b': { input: 5.00, output: 15.00 },
    };

    const a = generateSimplePairs('model-a', 100, 0.01);
    const b = generateSimplePairs('model-b', 100, 0.01);

    const store = createMockStore(
      [...a.calls, ...b.calls],
      [...a.responses, ...b.responses],
    );

    const engine = new OptimizationEngine(sameCosts);
    const result = await engine.getRecommendations(store, { period: 7, limit: 10 });

    // Since both have same cost rate and same per-call cost, no savings
    expect(result.totalPotentialSavings).toBe(0);
  });

  it('works with moderate complexity tier recommendations', async () => {
    const opus = generateModeratePairs('claude-opus-4', 100, 0.08);
    const sonnet = generateModeratePairs('claude-sonnet-4', 100, 0.015);

    const store = createMockStore(
      [...opus.calls, ...sonnet.calls],
      [...opus.responses, ...sonnet.responses],
    );

    const engine = new OptimizationEngine(TEST_COSTS);
    const result = await engine.getRecommendations(store, { period: 7, limit: 10 });

    const rec = result.recommendations.find(
      (r) => r.currentModel === 'claude-opus-4' && r.recommendedModel === 'claude-sonnet-4',
    );
    expect(rec).toBeTruthy();
    expect(rec!.complexityTier).toBe('moderate');
    expect(rec!.monthlySavings).toBeGreaterThan(0);
  });
});
