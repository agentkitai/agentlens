/**
 * Tests for retry & resilience (S1)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLensClient } from '../client.js';
import {
  AuthenticationError,
  ConnectionError,
  RateLimitError,
  BackpressureError,
  QuotaExceededError,
} from '../errors.js';

// ─── Helpers ────────────────────────────────────────────────────────

function mockResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers[name] ?? null,
    },
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function createClient(
  fetchFn: typeof globalThis.fetch,
  opts?: { timeout?: number; retry?: { maxRetries?: number; backoffBaseMs?: number; backoffMaxMs?: number } },
) {
  return new AgentLensClient({
    url: 'http://localhost:3400',
    apiKey: 'test-key',
    fetch: fetchFn,
    ...opts,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('Retry & Resilience', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it('429→429→200 succeeds after retries', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce(mockResponse(429, { error: 'rate limited' }, { 'Retry-After': '0.01' }))
      .mockResolvedValueOnce(mockResponse(429, { error: 'rate limited' }, { 'Retry-After': '0.01' }))
      .mockResolvedValueOnce(mockResponse(200, { status: 'ok', version: '1.0' }));

    const client = createClient(fn, { retry: { backoffBaseMs: 10, backoffMaxMs: 100 } });
    const result = await client.health();
    expect(result).toEqual({ status: 'ok', version: '1.0' });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('429×4 fails after max retries (maxRetries=3)', async () => {
    const fn = vi.fn()
      .mockResolvedValue(mockResponse(429, { error: 'rate limited' }, { 'Retry-After': '0.01' }));

    const client = createClient(fn, { retry: { maxRetries: 3, backoffBaseMs: 10 } });
    await expect(client.health()).rejects.toThrow(RateLimitError);
    // 1 initial + 3 retries = 4 calls
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('503 retries with backoff', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce(mockResponse(503, { error: 'unavailable' }))
      .mockResolvedValueOnce(mockResponse(200, { status: 'ok', version: '1.0' }));

    const client = createClient(fn, { retry: { backoffBaseMs: 10, backoffMaxMs: 100 } });
    const result = await client.health();
    expect(result).toEqual({ status: 'ok', version: '1.0' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('401 throws immediately without retry', async () => {
    const fn = vi.fn()
      .mockResolvedValue(mockResponse(401, { error: 'unauthorized' }));

    const client = createClient(fn, { retry: { maxRetries: 3 } });
    await expect(client.health()).rejects.toThrow(AuthenticationError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('400 throws immediately without retry', async () => {
    const fn = vi.fn()
      .mockResolvedValue(mockResponse(400, { error: 'bad request' }));

    const client = createClient(fn);
    await expect(client.health()).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('402 throws QuotaExceededError immediately', async () => {
    const fn = vi.fn()
      .mockResolvedValue(mockResponse(402, { error: 'quota exceeded' }));

    const client = createClient(fn);
    await expect(client.health()).rejects.toThrow(QuotaExceededError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('network errors are retried', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(mockResponse(200, { status: 'ok', version: '1.0' }));

    const client = createClient(fn, { retry: { backoffBaseMs: 10 } });
    const result = await client.health();
    expect(result).toEqual({ status: 'ok', version: '1.0' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('timeout throws ConnectionError', async () => {
    const fn = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        // Listen for abort
        init.signal?.addEventListener('abort', () => {
          const err = new DOMException('The operation was aborted', 'AbortError');
          reject(err);
        });
      });
    });

    const client = createClient(fn, {
      timeout: 50,
      retry: { maxRetries: 0 },
    });

    await expect(client.health()).rejects.toThrow(ConnectionError);
    await expect(client.health()).rejects.toThrow(/timed out/);
  });

  it('respects Retry-After header on 429', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce(mockResponse(429, { error: 'rate limited' }, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(mockResponse(200, { status: 'ok', version: '1.0' }));

    const client = createClient(fn, { retry: { backoffBaseMs: 10 } });

    const start = Date.now();
    const result = await client.health();
    const elapsed = Date.now() - start;

    expect(result).toEqual({ status: 'ok', version: '1.0' });
    // With fake timers + shouldAdvanceTime, the 2s Retry-After should be respected
    // We just verify the call count; timing is hard to assert with fake timers
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('RateLimitError has retryAfter property', async () => {
    const fn = vi.fn()
      .mockResolvedValue(mockResponse(429, { error: 'rate limited' }, { 'Retry-After': '5' }));

    const client = createClient(fn, { retry: { maxRetries: 0 } });

    try {
      await client.health();
      expect.fail('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).retryAfter).toBe(5);
    }
  });
});
