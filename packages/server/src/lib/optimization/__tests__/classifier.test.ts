/**
 * Tests for Complexity Classifier (Story 2.2)
 */

import { describe, it, expect } from 'vitest';
import { classifyCallComplexity } from '../classifier.js';
import type { AgentLensEvent, LlmCallPayload, LlmResponsePayload } from '@agentlensai/core';

/** Helper: create a minimal llm_call event */
function makeCallEvent(overrides: {
  tools?: Array<{ name: string }>;
  usage?: { inputTokens: number };
} = {}): AgentLensEvent {
  const payload: Partial<LlmCallPayload> & Record<string, unknown> = {
    callId: `call-${Math.random().toString(36).slice(2)}`,
    provider: 'anthropic',
    model: 'claude-opus-4',
    messages: [],
  };

  if (overrides.tools) {
    payload.tools = overrides.tools.map((t) => ({ name: t.name, description: '', parameters: {} }));
  }
  if (overrides.usage) {
    payload.usage = overrides.usage;
  }

  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    sessionId: 'ses-1',
    agentId: 'agent-1',
    eventType: 'llm_call',
    severity: 'info',
    payload: payload as any,
    metadata: {},
    prevHash: null,
    hash: 'abc',
    tenantId: 'default',
  };
}

/** Helper: create a minimal llm_response event */
function makeResponseEvent(overrides: {
  inputTokens?: number;
  outputTokens?: number;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  finishReason?: string;
  costUsd?: number;
} = {}): AgentLensEvent {
  const payload: Partial<LlmResponsePayload> = {
    callId: 'call-1',
    provider: 'anthropic',
    model: 'claude-opus-4',
    completion: 'test',
    finishReason: overrides.finishReason ?? 'stop',
    usage: {
      inputTokens: overrides.inputTokens ?? 0,
      outputTokens: overrides.outputTokens ?? 0,
      totalTokens: (overrides.inputTokens ?? 0) + (overrides.outputTokens ?? 0),
    },
    costUsd: overrides.costUsd ?? 0.001,
    latencyMs: 100,
  };

  if (overrides.toolCalls) {
    payload.toolCalls = overrides.toolCalls;
  }

  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    sessionId: 'ses-1',
    agentId: 'agent-1',
    eventType: 'llm_response',
    severity: 'info',
    payload: payload as any,
    metadata: {},
    prevHash: null,
    hash: 'def',
    tenantId: 'default',
  };
}

describe('classifyCallComplexity', () => {
  // ── Simple tier ──────────────────────────────────────────────

  it('classifies <500 input tokens with 0 tools as simple', () => {
    const call = makeCallEvent({ tools: [] });
    const response = makeResponseEvent({ inputTokens: 100, outputTokens: 50 });

    const result = classifyCallComplexity(call, response);

    expect(result.tier).toBe('simple');
    expect(result.signals.inputTokens).toBe(100);
    expect(result.signals.outputTokens).toBe(50);
    expect(result.signals.toolCallCount).toBe(0);
  });

  it('classifies 0 input tokens with 0 tools as simple', () => {
    const call = makeCallEvent({ tools: [] });
    const response = makeResponseEvent({ inputTokens: 0, outputTokens: 0 });

    const result = classifyCallComplexity(call, response);
    expect(result.tier).toBe('simple');
  });

  it('classifies 499 tokens with 0 tools as simple', () => {
    const call = makeCallEvent({ tools: [] });
    const response = makeResponseEvent({ inputTokens: 499, outputTokens: 100 });

    const result = classifyCallComplexity(call, response);
    expect(result.tier).toBe('simple');
  });

  // ── Moderate tier ────────────────────────────────────────────

  it('classifies 800 tokens with 2 tools as moderate', () => {
    const call = makeCallEvent();
    const response = makeResponseEvent({
      inputTokens: 800,
      outputTokens: 200,
      toolCalls: [
        { id: 't1', name: 'search', arguments: {} },
        { id: 't2', name: 'read', arguments: {} },
      ],
    });

    const result = classifyCallComplexity(call, response);

    expect(result.tier).toBe('moderate');
    expect(result.signals.inputTokens).toBe(800);
    expect(result.signals.toolCallCount).toBe(2);
  });

  it('classifies exactly 500 tokens with 0 tools as moderate (boundary)', () => {
    const call = makeCallEvent({ tools: [] });
    const response = makeResponseEvent({ inputTokens: 500, outputTokens: 100 });

    const result = classifyCallComplexity(call, response);
    expect(result.tier).toBe('moderate');
  });

  it('classifies exactly 2000 tokens as moderate (boundary)', () => {
    const call = makeCallEvent({ tools: [] });
    const response = makeResponseEvent({ inputTokens: 2000, outputTokens: 500 });

    const result = classifyCallComplexity(call, response);
    expect(result.tier).toBe('moderate');
  });

  it('classifies 1500 tokens with 3 tools as moderate', () => {
    const call = makeCallEvent();
    const response = makeResponseEvent({
      inputTokens: 1500,
      outputTokens: 300,
      toolCalls: [
        { id: 't1', name: 'a', arguments: {} },
        { id: 't2', name: 'b', arguments: {} },
        { id: 't3', name: 'c', arguments: {} },
      ],
    });

    const result = classifyCallComplexity(call, response);
    expect(result.tier).toBe('moderate');
  });

  it('classifies 300 tokens with 1 tool as moderate', () => {
    const call = makeCallEvent();
    const response = makeResponseEvent({
      inputTokens: 300,
      outputTokens: 100,
      toolCalls: [{ id: 't1', name: 'search', arguments: {} }],
    });

    const result = classifyCallComplexity(call, response);
    expect(result.tier).toBe('moderate');
    expect(result.signals.toolCallCount).toBe(1);
  });

  // ── Complex tier ─────────────────────────────────────────────

  it('classifies 5000 tokens with 6 tools as complex', () => {
    const call = makeCallEvent();
    const response = makeResponseEvent({
      inputTokens: 5000,
      outputTokens: 2000,
      toolCalls: Array.from({ length: 6 }, (_, i) => ({
        id: `t${i}`,
        name: `tool-${i}`,
        arguments: {},
      })),
    });

    const result = classifyCallComplexity(call, response);

    expect(result.tier).toBe('complex');
    expect(result.signals.inputTokens).toBe(5000);
    expect(result.signals.outputTokens).toBe(2000);
    expect(result.signals.toolCallCount).toBe(6);
  });

  it('classifies 2001 tokens as complex (boundary)', () => {
    const call = makeCallEvent({ tools: [] });
    const response = makeResponseEvent({ inputTokens: 2001, outputTokens: 100 });

    const result = classifyCallComplexity(call, response);
    expect(result.tier).toBe('complex');
  });

  it('classifies 0 tokens with 4 tools as complex', () => {
    const call = makeCallEvent();
    const response = makeResponseEvent({
      inputTokens: 0,
      outputTokens: 50,
      toolCalls: Array.from({ length: 4 }, (_, i) => ({
        id: `t${i}`,
        name: `tool-${i}`,
        arguments: {},
      })),
    });

    const result = classifyCallComplexity(call, response);
    expect(result.tier).toBe('complex');
  });

  it('classifies 100 tokens with 5 tools as complex (tools override simple tokens)', () => {
    const call = makeCallEvent();
    const response = makeResponseEvent({
      inputTokens: 100,
      outputTokens: 50,
      toolCalls: Array.from({ length: 5 }, (_, i) => ({
        id: `t${i}`,
        name: `tool-${i}`,
        arguments: {},
      })),
    });

    const result = classifyCallComplexity(call, response);
    expect(result.tier).toBe('complex');
  });

  // ── Edge cases: missing data ─────────────────────────────────

  it('defaults to moderate when token data is missing (tools known)', () => {
    // No usage on response, no tools
    const call = makeCallEvent({ tools: [] });
    const response: AgentLensEvent = {
      ...makeResponseEvent(),
      payload: {
        callId: 'call-1',
        provider: 'anthropic',
        model: 'claude-opus-4',
        completion: 'test',
        finishReason: 'stop',
        costUsd: 0.001,
        latencyMs: 100,
        // No usage field at all
      } as any,
    };

    const result = classifyCallComplexity(call, response);
    expect(result.tier).toBe('moderate');
  });

  it('defaults to moderate when everything is missing', () => {
    const call: AgentLensEvent = {
      id: 'evt-bare',
      timestamp: new Date().toISOString(),
      sessionId: 'ses-1',
      agentId: 'agent-1',
      eventType: 'llm_call',
      severity: 'info',
      payload: { callId: 'c1', provider: 'x', model: 'y', messages: [] } as any,
      metadata: {},
      prevHash: null,
      hash: 'abc',
      tenantId: 'default',
    };

    const result = classifyCallComplexity(call);
    expect(result.tier).toBe('moderate');
    expect(result.signals.inputTokens).toBe(0);
    expect(result.signals.outputTokens).toBe(0);
    expect(result.signals.toolCallCount).toBe(0);
  });

  it('defaults to moderate when no response event provided and call has no tools/usage', () => {
    const call = makeCallEvent();
    const result = classifyCallComplexity(call, null);
    expect(result.tier).toBe('moderate');
  });

  // ── Signal extraction ────────────────────────────────────────

  it('defaults tool count to 0 when response has no toolCalls (ignores tool definitions)', () => {
    const call = makeCallEvent({
      tools: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
    });
    const response = makeResponseEvent({ inputTokens: 600, outputTokens: 100 });
    // response has no toolCalls field (only usage)
    // Should default to 0 (no actual invocations), not 3 (available definitions)

    const result = classifyCallComplexity(call, response);
    expect(result.signals.toolCallCount).toBe(0);
    expect(result.tier).toBe('moderate');
  });

  it('prefers response usage over call usage for input tokens', () => {
    const call = makeCallEvent({ tools: [], usage: { inputTokens: 3000 } });
    const response = makeResponseEvent({ inputTokens: 400, outputTokens: 100 });

    const result = classifyCallComplexity(call, response);
    // Should use response's 400, not call's 3000
    expect(result.signals.inputTokens).toBe(400);
    expect(result.tier).toBe('simple');
  });

  it('falls back to call usage when response has no usage', () => {
    const call = makeCallEvent({ tools: [], usage: { inputTokens: 5000 } });
    const response: AgentLensEvent = {
      ...makeResponseEvent(),
      payload: {
        callId: 'call-1',
        provider: 'anthropic',
        model: 'claude-opus-4',
        completion: 'test',
        finishReason: 'stop',
        costUsd: 0.001,
        latencyMs: 100,
      } as any,
    };

    const result = classifyCallComplexity(call, response);
    expect(result.signals.inputTokens).toBe(5000);
    expect(result.tier).toBe('complex');
  });
});
