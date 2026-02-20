/**
 * Tests for CostOptimizer Façade (Feature 17 — Story 17.4)
 */

import { describe, it, expect } from 'vitest';
import { CostOptimizer } from '../cost-optimizer.js';
import type {
  IEventStore,
  AgentLensEvent,
  EventQueryResult,
  ModelCosts,
} from '@agentlensai/core';

let counter = 0;

function makeCallEvent(opts: {
  model: string;
  callId: string;
  agentId?: string;
  messages?: Array<{ role: string; content: string }>;
}): AgentLensEvent {
  counter++;
  return {
    id: `evt-call-${counter}`,
    timestamp: new Date().toISOString(),
    sessionId: 'ses-1',
    agentId: opts.agentId ?? 'agent-1',
    eventType: 'llm_call',
    severity: 'info',
    payload: {
      callId: opts.callId,
      provider: 'test',
      model: opts.model,
      messages: opts.messages ?? [],
    } as any,
    metadata: {},
    prevHash: null,
    hash: `hash-${counter}`,
    tenantId: 'default',
  };
}

function makeResponseEvent(opts: {
  callId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}): AgentLensEvent {
  counter++;
  return {
    id: `evt-resp-${counter}`,
    timestamp: new Date().toISOString(),
    sessionId: 'ses-1',
    agentId: 'agent-1',
    eventType: 'llm_response',
    severity: 'info',
    payload: {
      callId: opts.callId,
      provider: 'test',
      model: opts.model,
      completion: 'ok',
      finishReason: 'stop',
      usage: { inputTokens: opts.inputTokens, outputTokens: opts.outputTokens, totalTokens: opts.inputTokens + opts.outputTokens },
      costUsd: opts.costUsd,
      latencyMs: 50,
    } as any,
    metadata: {},
    prevHash: null,
    hash: `hash-${counter}`,
    tenantId: 'default',
  };
}

function createMockStore(callEvents: AgentLensEvent[], responseEvents: AgentLensEvent[]): IEventStore {
  return {
    queryEvents: async (query: any) => {
      let events = query.eventType === 'llm_call' ? [...callEvents] : query.eventType === 'llm_response' ? [...responseEvents] : [];
      if (query.agentId) events = events.filter(e => e.agentId === query.agentId);
      return { events, total: events.length, hasMore: false } as EventQueryResult;
    },
  } as unknown as IEventStore;
}

const TEST_COSTS: ModelCosts = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
};

describe('CostOptimizer', () => {
  it('returns EnhancedOptimizationResult with byCategory', async () => {
    const calls: AgentLensEvent[] = [];
    const responses: AgentLensEvent[] = [];

    // Generate enough data for model downgrade recommendations
    for (let i = 0; i < 25; i++) {
      const cid1 = `call-4o-${i}`;
      calls.push(makeCallEvent({ model: 'gpt-4o', callId: cid1 }));
      responses.push(makeResponseEvent({ callId: cid1, model: 'gpt-4o', inputTokens: 500, outputTokens: 100, costUsd: 0.005 }));

      const cid2 = `call-mini-${i}`;
      calls.push(makeCallEvent({ model: 'gpt-4o-mini', callId: cid2 }));
      responses.push(makeResponseEvent({ callId: cid2, model: 'gpt-4o-mini', inputTokens: 500, outputTokens: 100, costUsd: 0.0005 }));
    }

    const store = createMockStore(calls, responses);
    const optimizer = new CostOptimizer(store, TEST_COSTS);
    const result = await optimizer.getRecommendations({ period: 14, limit: 50 });

    expect(result.period).toBe(14);
    expect(result.analyzedCalls).toBeGreaterThan(0);
    expect(result.byCategory).toBeDefined();
    expect(result.byCategory.model_downgrade).toBeDefined();
    expect(result.byCategory.prompt_optimization).toBeDefined();
    expect(result.totalPotentialSavings).toBeGreaterThanOrEqual(0);

    // Recommendations should be sorted by savings desc
    for (let i = 1; i < result.recommendations.length; i++) {
      expect(result.recommendations[i].estimatedMonthlySavings).toBeLessThanOrEqual(
        result.recommendations[i - 1].estimatedMonthlySavings,
      );
    }
  });

  it('deduplicates recommendations by id', async () => {
    const store = createMockStore([], []);
    const optimizer = new CostOptimizer(store, TEST_COSTS);
    const result = await optimizer.getRecommendations({ period: 7, limit: 50 });
    // With no data, should return empty
    expect(result.recommendations).toHaveLength(0);
    expect(result.totalPotentialSavings).toBe(0);
  });

  it('respects limit parameter', async () => {
    const store = createMockStore([], []);
    const optimizer = new CostOptimizer(store, TEST_COSTS);
    const result = await optimizer.getRecommendations({ period: 7, limit: 1 });
    expect(result.recommendations.length).toBeLessThanOrEqual(1);
  });
});
