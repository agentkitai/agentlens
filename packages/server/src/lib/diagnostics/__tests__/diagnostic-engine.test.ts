/**
 * Tests for DiagnosticEngine (Story 18.7)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiagnosticEngine } from '../index.js';
import { DiagnosticCache } from '../cache.js';
import type { LLMProvider, LLMCompletionResponse } from '../providers/types.js';
import type { IEventStore } from '@agentlensai/core';

// Mock store that returns minimal valid data
function createMockStore(): IEventStore {
  return {
    querySessions: vi.fn().mockResolvedValue({
      sessions: [
        {
          id: 's1',
          agentId: 'agent-1',
          startedAt: new Date(Date.now() - 3600000).toISOString(),
          endedAt: new Date().toISOString(),
          status: 'completed',
          eventCount: 10,
          toolCallCount: 5,
          errorCount: 1,
          totalCostUsd: 0.05,
          llmCallCount: 3,
          totalInputTokens: 500,
          totalOutputTokens: 200,
          tags: [],
          tenantId: 'default',
        },
      ],
      total: 1,
    }),
    queryEvents: vi.fn().mockResolvedValue({ events: [], total: 0 }),
    countEvents: vi.fn().mockResolvedValue(0),
    listAgents: vi.fn().mockResolvedValue([]),
    getSession: vi.fn().mockResolvedValue({
      id: 's1',
      agentId: 'agent-1',
      startedAt: new Date(Date.now() - 3600000).toISOString(),
      endedAt: new Date().toISOString(),
      status: 'failed',
      eventCount: 5,
      toolCallCount: 2,
      errorCount: 2,
      totalCostUsd: 0.03,
      llmCallCount: 1,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      tags: [],
      tenantId: 'default',
    }),
    getSessionTimeline: vi.fn().mockResolvedValue([]),
  } as unknown as IEventStore;
}

function createMockProvider(responseContent: string): LLMProvider {
  return {
    name: 'mock',
    complete: vi.fn().mockResolvedValue({
      content: responseContent,
      inputTokens: 500,
      outputTokens: 200,
      model: 'mock-model',
      latencyMs: 1000,
    } satisfies LLMCompletionResponse),
    estimateCost: vi.fn().mockReturnValue(0.01),
  };
}

const VALID_LLM_RESPONSE = JSON.stringify({
  severity: 'warning',
  summary: 'Agent has elevated error rates',
  rootCauses: [{
    description: 'Permission errors',
    confidence: 0.8,
    category: 'error_pattern',
    evidence: [{ type: 'error_pattern', summary: 'EACCES 23 times' }],
  }],
  recommendations: [{
    action: 'Fix permissions',
    priority: 'high',
    rationale: 'Most common error',
  }],
});

describe('DiagnosticEngine', () => {
  let store: IEventStore;
  let cache: DiagnosticCache;

  beforeEach(() => {
    store = createMockStore();
    cache = new DiagnosticCache(60000);
  });

  it('returns fallback when provider is null', async () => {
    const engine = new DiagnosticEngine(store, null, cache);
    const report = await engine.diagnoseAgent('agent-1', 7);
    expect(report.source).toBe('fallback');
    expect(report.summary).toContain('unavailable');
  });

  it('returns LLM report on success', async () => {
    const provider = createMockProvider(VALID_LLM_RESPONSE);
    const engine = new DiagnosticEngine(store, provider, cache);
    const report = await engine.diagnoseAgent('agent-1', 7);
    expect(report.source).toBe('llm');
    expect(report.severity).toBe('warning');
    expect(report.rootCauses).toHaveLength(1);
    expect(provider.complete).toHaveBeenCalledOnce();
  });

  it('returns cached result on second call', async () => {
    const provider = createMockProvider(VALID_LLM_RESPONSE);
    const engine = new DiagnosticEngine(store, provider, cache);
    await engine.diagnoseAgent('agent-1', 7);
    await engine.diagnoseAgent('agent-1', 7);
    // Only one LLM call
    expect(provider.complete).toHaveBeenCalledOnce();
  });

  it('refresh bypasses cache', async () => {
    const provider = createMockProvider(VALID_LLM_RESPONSE);
    const engine = new DiagnosticEngine(store, provider, cache);
    await engine.diagnoseAgent('agent-1', 7);
    await engine.diagnoseAgent('agent-1', 7, { refresh: true });
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it('retries on parse failure then returns fallback', async () => {
    const provider = createMockProvider('not valid json');
    const engine = new DiagnosticEngine(store, provider, cache);
    const report = await engine.diagnoseAgent('agent-1', 7);
    expect(report.source).toBe('fallback');
    expect(provider.complete).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it('retries once with correction on bad JSON, succeeds on second try', async () => {
    const provider: LLMProvider = {
      name: 'mock',
      complete: vi.fn()
        .mockResolvedValueOnce({
          content: 'bad json',
          inputTokens: 100,
          outputTokens: 50,
          model: 'mock',
          latencyMs: 500,
        })
        .mockResolvedValueOnce({
          content: VALID_LLM_RESPONSE,
          inputTokens: 100,
          outputTokens: 50,
          model: 'mock',
          latencyMs: 500,
        }),
      estimateCost: vi.fn().mockReturnValue(0.01),
    };
    const engine = new DiagnosticEngine(store, provider, cache);
    const report = await engine.diagnoseAgent('agent-1', 7);
    expect(report.source).toBe('llm');
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it('diagnoseSession returns fallback when no provider', async () => {
    const engine = new DiagnosticEngine(store, null, cache);
    const report = await engine.diagnoseSession('s1');
    expect(report.source).toBe('fallback');
    expect(report.type).toBe('session');
  });

  it('diagnoseSession returns 404 when session not found', async () => {
    (store.getSession as any).mockResolvedValue(null);
    const engine = new DiagnosticEngine(store, null, cache);
    await expect(engine.diagnoseSession('nonexistent')).rejects.toThrow('Session not found');
  });
});
