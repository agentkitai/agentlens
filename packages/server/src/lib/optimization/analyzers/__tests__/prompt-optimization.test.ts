/**
 * Tests for PromptOptimizationAnalyzer (Feature 17 — Story 17.3)
 */

import { describe, it, expect } from 'vitest';
import { PromptOptimizationAnalyzer } from '../prompt-optimization.js';
import type { AgentLensEvent, IEventStore, ModelCosts, LlmCallPayload } from '@agentlensai/core';
import type { AnalyzerContext } from '../types.js';

let counter = 0;

function makeCallEvent(opts: {
  model: string;
  messages: Array<{ role: string; content: string }>;
  agentId?: string;
  sessionId?: string;
}): AgentLensEvent {
  counter++;
  return {
    id: `evt-${counter}`,
    timestamp: new Date().toISOString(),
    sessionId: opts.sessionId ?? 'ses-1',
    agentId: opts.agentId ?? 'agent-1',
    eventType: 'llm_call',
    severity: 'info',
    payload: {
      callId: `call-${counter}`,
      provider: 'test',
      model: opts.model,
      messages: opts.messages,
    } as any,
    metadata: {},
    prevHash: null,
    hash: `hash-${counter}`,
    tenantId: 'default',
  };
}

const TEST_COSTS: ModelCosts = {
  'gpt-4o': { input: 2.50, output: 10.00 },
};

function buildContext(events: AgentLensEvent[], agentId?: string): AnalyzerContext {
  return {
    store: {} as IEventStore,
    agentId,
    from: new Date(Date.now() - 14 * 86400000).toISOString(),
    to: new Date().toISOString(),
    period: 14,
    limit: 50,
    llmCallEvents: events,
    llmResponseEvents: [],
    responseMap: new Map(),
  };
}

describe('PromptOptimizationAnalyzer', () => {
  it('detects large system prompts (>4000 tokens)', async () => {
    const largeSystem = 'x'.repeat(20000); // ~5000 tokens at /4
    const events: AgentLensEvent[] = [];
    for (let i = 0; i < 25; i++) {
      events.push(makeCallEvent({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: largeSystem },
          { role: 'user', content: 'hello' },
        ],
      }));
    }

    const analyzer = new PromptOptimizationAnalyzer(TEST_COSTS);
    const recs = await analyzer.analyze(buildContext(events));

    expect(recs.length).toBeGreaterThan(0);
    const rec = recs.find(r => r.promptOptimization?.targetType === 'system_prompt_size');
    expect(rec).toBeDefined();
    expect(rec!.category).toBe('prompt_optimization');
    expect(rec!.difficulty).toBe('code_change');
    expect(rec!.promptOptimization!.currentTokens).toBeGreaterThan(4000);
  });

  it('detects repeated context patterns in a session', async () => {
    const events: AgentLensEvent[] = [];
    const sharedPrefix = 'This is the same context that repeats in every call';
    // 10 calls with same prefix in one session — 100% ratio > 30%
    for (let i = 0; i < 10; i++) {
      events.push(makeCallEvent({
        model: 'gpt-4o',
        sessionId: 'ses-repeated',
        messages: [
          { role: 'user', content: sharedPrefix },
          { role: 'assistant', content: 'ok' },
        ],
      }));
    }

    const analyzer = new PromptOptimizationAnalyzer(TEST_COSTS);
    const recs = await analyzer.analyze(buildContext(events));

    const rec = recs.find(r => r.promptOptimization?.targetType === 'repeated_context');
    expect(rec).toBeDefined();
    expect(rec!.category).toBe('prompt_optimization');
  });

  it('produces no recommendations for small prompts', async () => {
    const events: AgentLensEvent[] = [];
    for (let i = 0; i < 25; i++) {
      events.push(makeCallEvent({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'Be helpful.' },
          { role: 'user', content: 'hi' },
        ],
      }));
    }

    const analyzer = new PromptOptimizationAnalyzer(TEST_COSTS);
    const recs = await analyzer.analyze(buildContext(events));
    const sysRec = recs.find(r => r.promptOptimization?.targetType === 'system_prompt_size');
    expect(sysRec).toBeUndefined();
  });
});
