/**
 * Tests for ModelDowngradeAnalyzer (Feature 17 — Story 17.2)
 */

import { describe, it, expect } from 'vitest';
import { ModelDowngradeAnalyzer } from '../model-downgrade.js';
import type {
  IEventStore,
  AgentLensEvent,
  EventQueryResult,
  ModelCosts,
  LlmCallPayload,
  LlmResponsePayload,
} from '@agentlensai/core';
import type { AnalyzerContext } from '../types.js';

let eventCounter = 0;

function makeCallEvent(opts: {
  model: string;
  callId: string;
  agentId?: string;
}): AgentLensEvent {
  eventCounter++;
  return {
    id: `evt-call-${eventCounter}`,
    timestamp: new Date().toISOString(),
    sessionId: 'ses-1',
    agentId: opts.agentId ?? 'agent-1',
    eventType: 'llm_call',
    severity: 'info',
    payload: { callId: opts.callId, provider: 'test', model: opts.model, messages: [] } as any,
    metadata: {},
    prevHash: null,
    hash: `hash-${eventCounter}`,
    tenantId: 'default',
  };
}

function makeResponseEvent(opts: {
  callId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  agentId?: string;
}): AgentLensEvent {
  eventCounter++;
  return {
    id: `evt-resp-${eventCounter}`,
    timestamp: new Date().toISOString(),
    sessionId: 'ses-1',
    agentId: opts.agentId ?? 'agent-1',
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
    hash: `hash-${eventCounter}`,
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

function buildContext(store: IEventStore, callEvents: AgentLensEvent[] = [], responseEvents: AgentLensEvent[] = []): AnalyzerContext {
  const responseMap = new Map<string, AgentLensEvent>();
  for (const evt of responseEvents) {
    const p = evt.payload as any;
    if (p.callId) responseMap.set(p.callId, evt);
  }
  return {
    store,
    agentId: 'agent-1',
    from: new Date(Date.now() - 14 * 86400000).toISOString(),
    to: new Date().toISOString(),
    period: 14,
    limit: 50,
    llmCallEvents: callEvents,
    llmResponseEvents: responseEvents,
    responseMap,
  };
}

describe('ModelDowngradeAnalyzer', () => {
  it('maps CostRecommendation to EnhancedRecommendation', async () => {
    const calls: AgentLensEvent[] = [];
    const responses: AgentLensEvent[] = [];

    // 25 gpt-4o calls (simple tier: <1000 input tokens, 0 tools)
    for (let i = 0; i < 25; i++) {
      const callId = `call-4o-${i}`;
      calls.push(makeCallEvent({ model: 'gpt-4o', callId }));
      responses.push(makeResponseEvent({ callId, model: 'gpt-4o', inputTokens: 500, outputTokens: 100, costUsd: 0.005 }));
    }
    // 25 gpt-4o-mini calls (simple tier)
    for (let i = 0; i < 25; i++) {
      const callId = `call-mini-${i}`;
      calls.push(makeCallEvent({ model: 'gpt-4o-mini', callId }));
      responses.push(makeResponseEvent({ callId, model: 'gpt-4o-mini', inputTokens: 500, outputTokens: 100, costUsd: 0.0005 }));
    }

    const store = createMockStore(calls, responses);
    const analyzer = new ModelDowngradeAnalyzer(TEST_COSTS);
    const ctx = buildContext(store, calls, responses);
    const recs = await analyzer.analyze(ctx);

    expect(recs.length).toBeGreaterThan(0);
    const rec = recs[0];
    expect(rec.category).toBe('model_downgrade');
    expect(rec.difficulty).toBe('config_change');
    expect(rec.modelDowngrade).toBeDefined();
    expect(rec.modelDowngrade!.currentModel).toBe('gpt-4o');
    expect(rec.modelDowngrade!.recommendedModel).toBe('gpt-4o-mini');
    expect(rec.estimatedMonthlySavings).toBeGreaterThan(0);
    expect(rec.actionableSteps).toHaveLength(2);
    expect(rec.id).toBeTruthy();
  });

  it('returns empty for insufficient data', async () => {
    const store = createMockStore([], []);
    const analyzer = new ModelDowngradeAnalyzer(TEST_COSTS);
    const ctx = buildContext(store);
    const recs = await analyzer.analyze(ctx);
    expect(recs).toHaveLength(0);
  });
});
