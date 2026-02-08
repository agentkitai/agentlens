/**
 * Tests for SDK LLM call tracking methods (Story 3.2 / 3.3)
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentLensClient } from '../client.js';
import type { LogLlmCallParams } from '../client.js';

// ─── Helpers ────────────────────────────────────────────────────────

function mockFetch(status: number, body: unknown): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as Response);
}

function createClient(fetchFn: typeof globalThis.fetch) {
  return new AgentLensClient({
    url: 'http://localhost:3400',
    apiKey: 'als_test123',
    fetch: fetchFn,
  });
}

const baseParams: LogLlmCallParams = {
  provider: 'anthropic',
  model: 'claude-opus-4-6',
  messages: [
    { role: 'user', content: 'What is 2+2?' },
  ],
  completion: 'The answer is 4.',
  finishReason: 'stop',
  usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
  costUsd: 0.003,
  latencyMs: 850,
};

// ─── logLlmCall Tests ───────────────────────────────────────────────

describe('AgentLensClient.logLlmCall', () => {
  it('returns a callId', async () => {
    const fn = mockFetch(200, { processed: 2 });
    const client = createClient(fn);

    const result = await client.logLlmCall('ses_abc', 'agent-1', baseParams);
    expect(result.callId).toBeTruthy();
    expect(typeof result.callId).toBe('string');
  });

  it('sends a single batch POST with two events', async () => {
    const fn = mockFetch(200, { processed: 2 });
    const client = createClient(fn);

    await client.logLlmCall('ses_abc', 'agent-1', baseParams);

    // Should make exactly one fetch call (batch)
    expect(fn).toHaveBeenCalledTimes(1);

    const [url, opts] = (fn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://localhost:3400/api/events');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body) as {
      events: Array<{ eventType: string; sessionId: string; agentId: string }>;
    };
    expect(body.events).toHaveLength(2);
    expect(body.events[0].eventType).toBe('llm_call');
    expect(body.events[1].eventType).toBe('llm_response');
    expect(body.events[0].sessionId).toBe('ses_abc');
    expect(body.events[1].sessionId).toBe('ses_abc');
    expect(body.events[0].agentId).toBe('agent-1');
    expect(body.events[1].agentId).toBe('agent-1');
  });

  it('both events share the same callId', async () => {
    const fn = mockFetch(200, { processed: 2 });
    const client = createClient(fn);

    const result = await client.logLlmCall('ses_abc', 'agent-1', baseParams);

    const body = JSON.parse((fn as ReturnType<typeof vi.fn>).mock.calls[0][1].body) as {
      events: Array<{ payload: { callId: string } }>;
    };
    expect(body.events[0].payload.callId).toBe(result.callId);
    expect(body.events[1].payload.callId).toBe(result.callId);
  });

  it('llm_call event contains request details', async () => {
    const fn = mockFetch(200, { processed: 2 });
    const client = createClient(fn);

    await client.logLlmCall('ses_abc', 'agent-1', {
      ...baseParams,
      systemPrompt: 'You are helpful.',
      parameters: { temperature: 0.5 },
      tools: [{ name: 'calc', description: 'Calculator' }],
    });

    const body = JSON.parse((fn as ReturnType<typeof vi.fn>).mock.calls[0][1].body) as {
      events: Array<{ payload: Record<string, unknown> }>;
    };
    const callPayload = body.events[0].payload;
    expect(callPayload.provider).toBe('anthropic');
    expect(callPayload.model).toBe('claude-opus-4-6');
    expect(callPayload.messages).toEqual([{ role: 'user', content: 'What is 2+2?' }]);
    expect(callPayload.systemPrompt).toBe('You are helpful.');
    expect(callPayload.parameters).toEqual({ temperature: 0.5 });
    expect(callPayload.tools).toEqual([{ name: 'calc', description: 'Calculator' }]);
  });

  it('llm_response event contains response details', async () => {
    const fn = mockFetch(200, { processed: 2 });
    const client = createClient(fn);

    await client.logLlmCall('ses_abc', 'agent-1', {
      ...baseParams,
      toolCalls: [{ id: 'tc1', name: 'calc', arguments: { expr: '2+2' } }],
    });

    const body = JSON.parse((fn as ReturnType<typeof vi.fn>).mock.calls[0][1].body) as {
      events: Array<{ payload: Record<string, unknown> }>;
    };
    const respPayload = body.events[1].payload;
    expect(respPayload.completion).toBe('The answer is 4.');
    expect(respPayload.finishReason).toBe('stop');
    expect(respPayload.usage).toEqual({ inputTokens: 10, outputTokens: 8, totalTokens: 18 });
    expect(respPayload.costUsd).toBe(0.003);
    expect(respPayload.latencyMs).toBe(850);
    expect(respPayload.toolCalls).toEqual([{ id: 'tc1', name: 'calc', arguments: { expr: '2+2' } }]);
  });

  it('handles null completion', async () => {
    const fn = mockFetch(200, { processed: 2 });
    const client = createClient(fn);

    await client.logLlmCall('ses_abc', 'agent-1', {
      ...baseParams,
      completion: null,
    });

    const body = JSON.parse((fn as ReturnType<typeof vi.fn>).mock.calls[0][1].body) as {
      events: Array<{ payload: { completion: string | null } }>;
    };
    expect(body.events[1].payload.completion).toBeNull();
  });

  it('sends Authorization header', async () => {
    const fn = mockFetch(200, { processed: 2 });
    const client = createClient(fn);

    await client.logLlmCall('ses_abc', 'agent-1', baseParams);

    const opts = (fn as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer als_test123');
  });
});

// ─── Redaction Tests ────────────────────────────────────────────────

describe('AgentLensClient.logLlmCall redaction', () => {
  it('strips message content when redact=true', async () => {
    const fn = mockFetch(200, { processed: 2 });
    const client = createClient(fn);

    await client.logLlmCall('ses_abc', 'agent-1', {
      ...baseParams,
      messages: [
        { role: 'user', content: 'Tell me a secret' },
        { role: 'assistant', content: 'Here is the secret...' },
      ],
      redact: true,
    });

    const body = JSON.parse((fn as ReturnType<typeof vi.fn>).mock.calls[0][1].body) as {
      events: Array<{ payload: Record<string, unknown> }>;
    };
    const callPayload = body.events[0].payload;
    const messages = callPayload.messages as Array<{ role: string; content: string }>;
    expect(messages[0].content).toBe('[REDACTED]');
    expect(messages[1].content).toBe('[REDACTED]');
    // Roles are preserved
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
  });

  it('strips completion content when redact=true', async () => {
    const fn = mockFetch(200, { processed: 2 });
    const client = createClient(fn);

    await client.logLlmCall('ses_abc', 'agent-1', {
      ...baseParams,
      redact: true,
    });

    const body = JSON.parse((fn as ReturnType<typeof vi.fn>).mock.calls[0][1].body) as {
      events: Array<{ payload: Record<string, unknown> }>;
    };
    expect(body.events[1].payload.completion).toBe('[REDACTED]');
  });

  it('strips systemPrompt when redact=true', async () => {
    const fn = mockFetch(200, { processed: 2 });
    const client = createClient(fn);

    await client.logLlmCall('ses_abc', 'agent-1', {
      ...baseParams,
      systemPrompt: 'You are a secret agent',
      redact: true,
    });

    const body = JSON.parse((fn as ReturnType<typeof vi.fn>).mock.calls[0][1].body) as {
      events: Array<{ payload: Record<string, unknown> }>;
    };
    expect(body.events[0].payload.systemPrompt).toBe('[REDACTED]');
  });

  it('sets redacted=true flag on both payloads when redact=true', async () => {
    const fn = mockFetch(200, { processed: 2 });
    const client = createClient(fn);

    await client.logLlmCall('ses_abc', 'agent-1', {
      ...baseParams,
      redact: true,
    });

    const body = JSON.parse((fn as ReturnType<typeof vi.fn>).mock.calls[0][1].body) as {
      events: Array<{ payload: Record<string, unknown> }>;
    };
    expect(body.events[0].payload.redacted).toBe(true);
    expect(body.events[1].payload.redacted).toBe(true);
  });

  it('preserves metadata (model, provider, usage, cost) when redacted', async () => {
    const fn = mockFetch(200, { processed: 2 });
    const client = createClient(fn);

    await client.logLlmCall('ses_abc', 'agent-1', {
      ...baseParams,
      redact: true,
    });

    const body = JSON.parse((fn as ReturnType<typeof vi.fn>).mock.calls[0][1].body) as {
      events: Array<{ payload: Record<string, unknown> }>;
    };
    // llm_call preserves model/provider
    expect(body.events[0].payload.provider).toBe('anthropic');
    expect(body.events[0].payload.model).toBe('claude-opus-4-6');

    // llm_response preserves usage, cost, latency
    expect(body.events[1].payload.usage).toEqual({ inputTokens: 10, outputTokens: 8, totalTokens: 18 });
    expect(body.events[1].payload.costUsd).toBe(0.003);
    expect(body.events[1].payload.latencyMs).toBe(850);
    expect(body.events[1].payload.provider).toBe('anthropic');
    expect(body.events[1].payload.model).toBe('claude-opus-4-6');
  });

  it('does NOT set redacted flag when redact=false (default)', async () => {
    const fn = mockFetch(200, { processed: 2 });
    const client = createClient(fn);

    await client.logLlmCall('ses_abc', 'agent-1', baseParams);

    const body = JSON.parse((fn as ReturnType<typeof vi.fn>).mock.calls[0][1].body) as {
      events: Array<{ payload: Record<string, unknown> }>;
    };
    expect(body.events[0].payload.redacted).toBeUndefined();
    expect(body.events[1].payload.redacted).toBeUndefined();
  });
});

// ─── getLlmAnalytics Tests ──────────────────────────────────────────

describe('AgentLensClient.getLlmAnalytics', () => {
  it('calls GET /api/analytics/llm', async () => {
    const analyticsResponse = {
      summary: {
        totalCalls: 10,
        totalCostUsd: 1.5,
        totalInputTokens: 5000,
        totalOutputTokens: 2000,
        avgLatencyMs: 900,
        avgCostPerCall: 0.15,
      },
      byModel: [],
      byTime: [],
    };
    const fn = mockFetch(200, analyticsResponse);
    const client = createClient(fn);

    const result = await client.getLlmAnalytics();

    expect(result).toEqual(analyticsResponse);
    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe('http://localhost:3400/api/analytics/llm');
  });

  it('passes query params', async () => {
    const fn = mockFetch(200, { summary: {}, byModel: [], byTime: [] });
    const client = createClient(fn);

    await client.getLlmAnalytics({
      from: '2026-01-01',
      to: '2026-02-01',
      agentId: 'agent-1',
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      granularity: 'day',
    });

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('from=2026-01-01');
    expect(url).toContain('to=2026-02-01');
    expect(url).toContain('agentId=agent-1');
    expect(url).toContain('model=claude-opus-4-6');
    expect(url).toContain('provider=anthropic');
    expect(url).toContain('granularity=day');
  });

  it('omits empty params', async () => {
    const fn = mockFetch(200, { summary: {}, byModel: [], byTime: [] });
    const client = createClient(fn);

    await client.getLlmAnalytics({ from: '2026-01-01' });

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('from=2026-01-01');
    expect(url).not.toContain('agentId');
    expect(url).not.toContain('model');
  });

  it('sends Authorization header', async () => {
    const fn = mockFetch(200, { summary: {}, byModel: [], byTime: [] });
    const client = createClient(fn);

    await client.getLlmAnalytics();

    const opts = (fn as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer als_test123');
  });
});
