import { describe, it, expect } from 'vitest';
import type {
  ReplayStep,
  ReplayContext,
  ReplayState,
  ReplaySummary,
  AgentLensEvent,
  Session,
} from '../types.js';

describe('Replay Types (Story 1.1)', () => {
  it('ReplayContext interface has all required fields', () => {
    const context: ReplayContext = {
      eventIndex: 5,
      totalEvents: 20,
      cumulativeCostUsd: 0.05,
      elapsedMs: 12000,
      eventCounts: { tool_call: 3, llm_call: 2 },
      llmHistory: [
        {
          callId: 'llm-1',
          provider: 'anthropic',
          model: 'claude-opus-4-6',
          messages: [{ role: 'user', content: 'hello' }],
          response: 'Hi there!',
          toolCalls: [{ id: 'tc-1', name: 'search', arguments: { q: 'test' } }],
          costUsd: 0.02,
          latencyMs: 1500,
        },
      ],
      toolResults: [
        {
          callId: 'tc-1',
          toolName: 'search',
          arguments: { q: 'test' },
          result: { hits: 3 },
          durationMs: 200,
          completed: true,
        },
      ],
      pendingApprovals: [
        { requestId: 'req-1', action: 'delete-file', status: 'pending' },
      ],
      errorCount: 0,
      warnings: [],
    };

    expect(context.eventIndex).toBe(5);
    expect(context.totalEvents).toBe(20);
    expect(context.cumulativeCostUsd).toBe(0.05);
    expect(context.llmHistory).toHaveLength(1);
    expect(context.toolResults).toHaveLength(1);
    expect(context.pendingApprovals).toHaveLength(1);
    expect(context.errorCount).toBe(0);
    expect(context.warnings).toEqual([]);
  });

  it('ReplayStep interface includes event and context', () => {
    const event: AgentLensEvent = {
      id: 'evt-1',
      timestamp: '2026-02-08T12:00:00Z',
      sessionId: 'sess-1',
      agentId: 'agent-1',
      eventType: 'tool_call',
      severity: 'info',
      payload: { toolName: 'read', callId: 'c1', arguments: { path: '/tmp' } },
      metadata: {},
      prevHash: null,
      hash: 'abc123',
      tenantId: 'default',
    };

    const pairedEvent: AgentLensEvent = {
      ...event,
      id: 'evt-2',
      eventType: 'tool_response',
      payload: { callId: 'c1', toolName: 'read', result: 'ok', durationMs: 50 },
    };

    const step: ReplayStep = {
      index: 0,
      event,
      pairedEvent,
      pairDurationMs: 50,
      context: {
        eventIndex: 1,
        totalEvents: 10,
        cumulativeCostUsd: 0,
        elapsedMs: 0,
        eventCounts: { tool_call: 1 },
        llmHistory: [],
        toolResults: [],
        pendingApprovals: [],
        errorCount: 0,
        warnings: [],
      },
    };

    expect(step.index).toBe(0);
    expect(step.event.eventType).toBe('tool_call');
    expect(step.pairedEvent?.eventType).toBe('tool_response');
    expect(step.pairDurationMs).toBe(50);
  });

  it('ReplayStep allows optional pairedEvent and pairDurationMs', () => {
    const step: ReplayStep = {
      index: 2,
      event: {
        id: 'evt-3',
        timestamp: '2026-02-08T12:00:00Z',
        sessionId: 'sess-1',
        agentId: 'agent-1',
        eventType: 'session_started',
        severity: 'info',
        payload: { agentName: 'test' },
        metadata: {},
        prevHash: null,
        hash: 'def456',
        tenantId: 'default',
      },
      context: {
        eventIndex: 1,
        totalEvents: 5,
        cumulativeCostUsd: 0,
        elapsedMs: 0,
        eventCounts: { session_started: 1 },
        llmHistory: [],
        toolResults: [],
        pendingApprovals: [],
        errorCount: 0,
        warnings: [],
      },
    };

    expect(step.pairedEvent).toBeUndefined();
    expect(step.pairDurationMs).toBeUndefined();
  });

  it('ReplaySummary interface has all metric fields', () => {
    const summary: ReplaySummary = {
      totalCost: 0.15,
      totalDurationMs: 30000,
      totalLlmCalls: 5,
      totalToolCalls: 12,
      totalErrors: 1,
      models: ['claude-opus-4-6', 'gpt-4o'],
      tools: ['read', 'write', 'search'],
    };

    expect(summary.totalCost).toBe(0.15);
    expect(summary.models).toHaveLength(2);
    expect(summary.tools).toHaveLength(3);
  });

  it('ReplayState interface composes session, steps, and summary', () => {
    const session: Session = {
      id: 'sess-1',
      agentId: 'agent-1',
      agentName: 'TestAgent',
      startedAt: '2026-02-08T12:00:00Z',
      status: 'completed',
      eventCount: 10,
      toolCallCount: 3,
      errorCount: 0,
      totalCostUsd: 0.05,
      llmCallCount: 2,
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      tags: ['test'],
      tenantId: 'default',
    };

    const state: ReplayState = {
      session,
      chainValid: true,
      totalSteps: 10,
      steps: [],
      pagination: { offset: 0, limit: 50, hasMore: false },
      summary: {
        totalCost: 0.05,
        totalDurationMs: 15000,
        totalLlmCalls: 2,
        totalToolCalls: 3,
        totalErrors: 0,
        models: ['claude-opus-4-6'],
        tools: ['read'],
      },
    };

    expect(state.session.id).toBe('sess-1');
    expect(state.chainValid).toBe(true);
    expect(state.totalSteps).toBe(10);
    expect(state.pagination.hasMore).toBe(false);
    expect(state.summary.totalCost).toBe(0.05);
  });

  it('all replay types are exported from barrel', async () => {
    const core = await import('../index.js');
    // Verify type exports exist at runtime by checking they're importable
    // (TypeScript interfaces are erased at runtime, but we verify the module compiles)
    expect(core).toBeDefined();
  });
});
