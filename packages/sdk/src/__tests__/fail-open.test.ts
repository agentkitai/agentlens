/**
 * Tests for graceful degradation / fail-open mode (S5)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLensClient } from '../client.js';

// ─── Helpers ────────────────────────────────────────────────────────

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function createClient(
  fetchFn: typeof globalThis.fetch,
  opts?: {
    failOpen?: boolean;
    onError?: (err: Error) => void;
    logger?: { warn: (msg: string) => void };
  },
) {
  return new AgentLensClient({
    url: 'http://localhost:3400',
    apiKey: 'test-key',
    fetch: fetchFn,
    retry: { maxRetries: 0 },
    ...opts,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('Fail-Open / Graceful Degradation', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it('failOpen=false (default) throws on server error', async () => {
    const fn = vi.fn().mockResolvedValue(mockResponse(500, { error: 'boom' }));
    const client = createClient(fn);
    await expect(client.health()).rejects.toThrow('boom');
  });

  it('failOpen=true catches server errors and returns undefined', async () => {
    const fn = vi.fn().mockResolvedValue(mockResponse(500, { error: 'boom' }));
    const client = createClient(fn, { failOpen: true });
    const result = await client.health();
    expect(result).toBeUndefined();
  });

  it('failOpen=true catches network errors and returns undefined', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const client = createClient(fn, { failOpen: true });
    const result = await client.getSessions();
    expect(result).toBeUndefined();
  });

  it('failOpen=true calls onError callback', async () => {
    const onError = vi.fn();
    const fn = vi.fn().mockResolvedValue(mockResponse(500, { error: 'server down' }));
    const client = createClient(fn, { failOpen: true, onError });
    await client.health();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toContain('server down');
  });

  it('failOpen=true default onError uses logger.warn', async () => {
    const warn = vi.fn();
    const fn = vi.fn().mockResolvedValue(mockResponse(500, { error: 'oops' }));
    const client = createClient(fn, { failOpen: true, logger: { warn } });
    await client.health();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('oops');
  });

  it('logLlmCall in failOpen mode does not throw (fire-and-forget)', async () => {
    const fn = vi.fn().mockResolvedValue(mockResponse(500, { error: 'fail' }));
    const onError = vi.fn();
    const client = createClient(fn, { failOpen: true, onError });

    const result = await client.logLlmCall('sess', 'agent', {
      provider: 'openai',
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      completion: 'hello',
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      costUsd: 0.001,
      latencyMs: 100,
    });

    // Should return callId without throwing
    expect(result).toHaveProperty('callId');
    expect(typeof result.callId).toBe('string');

    // Wait for fire-and-forget to settle
    await vi.advanceTimersByTimeAsync(100);
  });

  it('logLlmCall without failOpen throws on error', async () => {
    const fn = vi.fn().mockResolvedValue(mockResponse(500, { error: 'fail' }));
    const client = createClient(fn);

    await expect(
      client.logLlmCall('sess', 'agent', {
        provider: 'openai',
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
        completion: 'hello',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        costUsd: 0.001,
        latencyMs: 100,
      }),
    ).rejects.toThrow('fail');
  });

  it('logger option receives warnings via default onError', async () => {
    const warn = vi.fn();
    const fn = vi.fn().mockResolvedValue(mockResponse(500, { error: 'test warning' }));
    const client = createClient(fn, { failOpen: true, logger: { warn } });
    await client.queryEvents();
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain('[AgentLens failOpen]');
    expect(warn.mock.calls[0][0]).toContain('test warning');
  });

  it('failOpen=true still returns data on success', async () => {
    const fn = vi.fn().mockResolvedValue(
      mockResponse(200, { status: 'ok', version: '1.0' }),
    );
    const client = createClient(fn, { failOpen: true });
    const result = await client.health();
    expect(result).toEqual({ status: 'ok', version: '1.0' });
  });
});
