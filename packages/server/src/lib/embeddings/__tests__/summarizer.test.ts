/**
 * Tests for Event & Session Summarizer (Story 2.3)
 */

import { describe, it, expect } from 'vitest';
import { summarizeEvent, summarizeSession } from '../summarizer.js';
import type { AgentLensEvent, Session } from '@agentlensai/core';

/** Create a minimal event for testing */
function makeEvent(overrides: Partial<AgentLensEvent>): AgentLensEvent {
  return {
    id: 'ev-1',
    timestamp: '2025-01-15T10:00:00.000Z',
    sessionId: 'ses-1',
    agentId: 'agent-1',
    eventType: 'custom',
    severity: 'info',
    payload: {},
    metadata: {},
    prevHash: null,
    hash: 'abc123',
    tenantId: 'default',
    ...overrides,
  } as AgentLensEvent;
}

/** Create a minimal session for testing */
function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'ses-1',
    agentId: 'agent-1',
    agentName: 'TestAgent',
    startedAt: '2025-01-15T10:00:00.000Z',
    endedAt: '2025-01-15T10:05:00.000Z',
    status: 'completed',
    eventCount: 10,
    toolCallCount: 5,
    errorCount: 0,
    totalCostUsd: 0.05,
    llmCallCount: 3,
    totalInputTokens: 1000,
    totalOutputTokens: 500,
    tags: ['test', 'dev'],
    tenantId: 'default',
    ...overrides,
  };
}

describe('summarizeEvent', () => {
  describe('tool_error', () => {
    it('returns formatted error text', () => {
      const event = makeEvent({
        eventType: 'tool_error',
        payload: {
          callId: 'c1',
          toolName: 'readFile',
          error: 'File not found: /tmp/missing.txt',
          durationMs: 5,
        },
      });

      const result = summarizeEvent(event);
      expect(result).toBe('tool_error: readFile - File not found: /tmp/missing.txt');
    });

    it('truncates long error messages', () => {
      const event = makeEvent({
        eventType: 'tool_error',
        payload: {
          callId: 'c1',
          toolName: 'exec',
          error: 'x'.repeat(500),
          durationMs: 5,
        },
      });

      const result = summarizeEvent(event);
      expect(result).toBeTruthy();
      expect(result!.length).toBeLessThan(400);
      expect(result).toContain('…');
    });
  });

  describe('tool_call', () => {
    it('returns formatted tool call text', () => {
      const event = makeEvent({
        eventType: 'tool_call',
        payload: {
          callId: 'c1',
          toolName: 'writeFile',
          arguments: { path: '/tmp/test.txt', content: 'hello' },
        },
      });

      const result = summarizeEvent(event);
      expect(result).toContain('tool_call: writeFile(');
      expect(result).toContain('/tmp/test.txt');
    });

    it('truncates long arguments', () => {
      const event = makeEvent({
        eventType: 'tool_call',
        payload: {
          callId: 'c1',
          toolName: 'writeFile',
          arguments: { content: 'x'.repeat(500) },
        },
      });

      const result = summarizeEvent(event);
      expect(result).toBeTruthy();
      expect(result!.length).toBeLessThan(300);
    });
  });

  describe('llm_call', () => {
    it('returns formatted llm call text with first user message', () => {
      const event = makeEvent({
        eventType: 'llm_call',
        payload: {
          callId: 'c1',
          provider: 'anthropic',
          model: 'claude-opus-4-6',
          messages: [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'What is the meaning of life?' },
          ],
        },
      });

      const result = summarizeEvent(event);
      expect(result).toBe('llm_call: claude-opus-4-6 - What is the meaning of life?');
    });

    it('handles array content in messages', () => {
      const event = makeEvent({
        eventType: 'llm_call',
        payload: {
          callId: 'c1',
          provider: 'anthropic',
          model: 'claude-opus-4-6',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Analyze this image' },
                { type: 'image', data: 'base64...' },
              ],
            },
          ],
        },
      });

      const result = summarizeEvent(event);
      expect(result).toContain('Analyze this image');
    });

    it('truncates long user messages', () => {
      const event = makeEvent({
        eventType: 'llm_call',
        payload: {
          callId: 'c1',
          provider: 'openai',
          model: 'gpt-4o',
          messages: [
            { role: 'user', content: 'x'.repeat(500) },
          ],
        },
      });

      const result = summarizeEvent(event);
      expect(result).toBeTruthy();
      expect(result).toContain('…');
    });

    it('handles empty messages array', () => {
      const event = makeEvent({
        eventType: 'llm_call',
        payload: {
          callId: 'c1',
          provider: 'openai',
          model: 'gpt-4o',
          messages: [],
        },
      });

      const result = summarizeEvent(event);
      expect(result).toBe('llm_call: gpt-4o - ');
    });
  });

  describe('llm_response', () => {
    it('returns formatted llm response text', () => {
      const event = makeEvent({
        eventType: 'llm_response',
        payload: {
          callId: 'c1',
          provider: 'anthropic',
          model: 'claude-opus-4-6',
          completion: 'The answer is 42.',
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          costUsd: 0.001,
          latencyMs: 500,
        },
      });

      const result = summarizeEvent(event);
      expect(result).toBe('llm_response: claude-opus-4-6 - The answer is 42.');
    });

    it('handles null completion', () => {
      const event = makeEvent({
        eventType: 'llm_response',
        payload: {
          callId: 'c1',
          provider: 'anthropic',
          model: 'claude-opus-4-6',
          completion: null,
          finishReason: 'tool_use',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          costUsd: 0.001,
          latencyMs: 500,
        },
      });

      const result = summarizeEvent(event);
      expect(result).toBe('llm_response: claude-opus-4-6 - ');
    });
  });

  describe('error/critical severity', () => {
    it('embeds non-standard events with error severity', () => {
      const event = makeEvent({
        eventType: 'custom',
        severity: 'error',
        payload: { type: 'crash', data: { message: 'out of memory' } },
      });

      const result = summarizeEvent(event);
      expect(result).toContain('custom:');
      expect(result).toContain('out of memory');
    });

    it('embeds events with critical severity', () => {
      const event = makeEvent({
        eventType: 'alert_triggered',
        severity: 'critical',
        payload: {
          alertRuleId: 'r1',
          alertName: 'High Error Rate',
          condition: 'error_rate_exceeds',
          currentValue: 80,
          threshold: 50,
          message: 'Error rate is 80%',
        },
      });

      const result = summarizeEvent(event);
      expect(result).toBeTruthy();
      expect(result).toContain('alert_triggered');
    });
  });

  describe('skipped events', () => {
    it('returns null for session_started events', () => {
      const event = makeEvent({
        eventType: 'session_started',
        payload: { agentName: 'TestAgent' },
      });
      expect(summarizeEvent(event)).toBeNull();
    });

    it('returns null for session_ended with info severity', () => {
      const event = makeEvent({
        eventType: 'session_ended',
        payload: { reason: 'completed' },
      });
      expect(summarizeEvent(event)).toBeNull();
    });

    it('returns null for cost_tracked events', () => {
      const event = makeEvent({
        eventType: 'cost_tracked',
        payload: { provider: 'anthropic', model: 'claude', costUsd: 0.01 } as unknown as AgentLensEvent['payload'],
      });
      expect(summarizeEvent(event)).toBeNull();
    });

    it('returns null for tool_response with info severity', () => {
      const event = makeEvent({
        eventType: 'tool_response',
        payload: { callId: 'c1', toolName: 'read', result: 'ok', durationMs: 5 },
      });
      expect(summarizeEvent(event)).toBeNull();
    });
  });
});

describe('summarizeSession', () => {
  it('produces a complete summary', () => {
    const session = makeSession();
    const events = [
      makeEvent({
        eventType: 'tool_call',
        payload: { callId: 'c1', toolName: 'readFile', arguments: {} },
      }),
      makeEvent({
        eventType: 'tool_response',
        payload: { callId: 'c1', toolName: 'readFile', result: 'ok', durationMs: 5 },
      }),
      makeEvent({
        eventType: 'tool_call',
        payload: { callId: 'c2', toolName: 'writeFile', arguments: {} },
      }),
    ];

    const result = summarizeSession(session, events);

    expect(result.summary).toContain('Agent TestAgent ran for');
    expect(result.summary).toContain('readFile, writeFile');
    expect(result.summary).toContain('0 errors');
    expect(result.summary).toContain('$0.0500');
    expect(result.toolSequence).toEqual(['readFile', 'writeFile']);
    expect(result.topics).toContain('readFile');
    expect(result.topics).toContain('writeFile');
    expect(result.errorSummary).toBe('');
    expect(result.outcome).toBe('success');
  });

  it('detects partial outcome with some errors', () => {
    const session = makeSession({ errorCount: 2 });
    const events = [
      makeEvent({ eventType: 'tool_call', payload: { callId: 'c1', toolName: 'exec', arguments: {} } }),
      makeEvent({ eventType: 'tool_response', payload: { callId: 'c1', toolName: 'exec', result: 'ok', durationMs: 5 } }),
      makeEvent({
        eventType: 'tool_error',
        severity: 'error',
        payload: { callId: 'c2', toolName: 'exec', error: 'timeout', durationMs: 30000 },
      }),
      makeEvent({ eventType: 'tool_call', payload: { callId: 'c3', toolName: 'exec', arguments: {} } }),
      makeEvent({ eventType: 'tool_response', payload: { callId: 'c3', toolName: 'exec', result: 'ok', durationMs: 5 } }),
    ];

    const result = summarizeSession(session, events);
    expect(result.outcome).toBe('partial');
    expect(result.errorSummary).toContain('timeout');
  });

  it('detects failure when error rate > 50%', () => {
    const session = makeSession({ errorCount: 3 });
    const events = [
      makeEvent({
        eventType: 'tool_error',
        severity: 'error',
        payload: { callId: 'c1', toolName: 'exec', error: 'fail 1', durationMs: 5 },
      }),
      makeEvent({
        eventType: 'tool_error',
        severity: 'error',
        payload: { callId: 'c2', toolName: 'exec', error: 'fail 2', durationMs: 5 },
      }),
      makeEvent({
        eventType: 'tool_error',
        severity: 'error',
        payload: { callId: 'c3', toolName: 'exec', error: 'fail 3', durationMs: 5 },
      }),
    ];

    const result = summarizeSession(session, events);
    expect(result.outcome).toBe('failure');
  });

  it('detects failure when session ended with error', () => {
    const session = makeSession({ errorCount: 1 });
    const events = [
      makeEvent({ eventType: 'tool_call', payload: { callId: 'c1', toolName: 'exec', arguments: {} } }),
      makeEvent({ eventType: 'tool_response', payload: { callId: 'c1', toolName: 'exec', result: 'ok', durationMs: 5 } }),
      makeEvent({ eventType: 'tool_call', payload: { callId: 'c2', toolName: 'exec', arguments: {} } }),
      makeEvent({
        eventType: 'session_ended',
        severity: 'error',
        payload: { reason: 'error', summary: 'Failed to complete' },
      }),
    ];

    const result = summarizeSession(session, events);
    expect(result.outcome).toBe('failure');
  });

  it('includes tags in topics', () => {
    const session = makeSession({ tags: ['production', 'customer-facing'] });
    const events: AgentLensEvent[] = [];

    const result = summarizeSession(session, events);
    expect(result.topics).toContain('production');
    expect(result.topics).toContain('customer-facing');
  });

  it('handles empty events', () => {
    const session = makeSession({ totalCostUsd: 0 });
    const events: AgentLensEvent[] = [];

    const result = summarizeSession(session, events);
    expect(result.summary).toContain('Used tools: none');
    expect(result.toolSequence).toEqual([]);
    expect(result.outcome).toBe('success');
  });

  it('handles missing agentName', () => {
    const session = makeSession({ agentName: undefined });
    const events: AgentLensEvent[] = [];

    const result = summarizeSession(session, events);
    expect(result.summary).toContain('Agent agent-1');
  });

  it('calculates duration correctly', () => {
    const session = makeSession({
      startedAt: '2025-01-15T10:00:00.000Z',
      endedAt: '2025-01-15T10:00:30.000Z',
    });

    const result = summarizeSession(session, []);
    expect(result.summary).toContain('30s');
  });
});
