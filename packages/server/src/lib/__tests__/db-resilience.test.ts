import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry } from '../db-resilience.js';

function pgError(code: string, message = 'pg error'): Error {
  const err = new Error(message);
  (err as any).code = code;
  return err;
}

describe('withRetry', () => {
  beforeEach(() => {
    // Use real timers but with tiny delays
  });

  it('succeeds on first try without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(pgError('40001'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('propagates non-retryable error immediately', async () => {
    const fn = vi.fn().mockRejectedValue(pgError('23505', 'unique_violation'));
    await expect(withRetry(fn)).rejects.toThrow('unique_violation');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws last error after exhausting retries', async () => {
    const fn = vi.fn().mockRejectedValue(pgError('08000', 'connection lost'));
    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow('connection lost');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('uses exponential backoff timing', async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: any, ms?: number) => {
      delays.push(ms ?? 0);
      return originalSetTimeout(fn, 0); // execute immediately for speed
    });

    const fnMock = vi.fn()
      .mockRejectedValueOnce(pgError('40P01'))
      .mockRejectedValueOnce(pgError('40P01'))
      .mockResolvedValue('done');

    const result = await withRetry(fnMock, { maxRetries: 3, baseDelayMs: 100 });
    expect(result).toBe('done');
    expect(fnMock).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([100, 200]); // 100 * 2^0, 100 * 2^1

    vi.restoreAllMocks();
  });

  it('retries all retryable PG error codes', async () => {
    for (const code of ['08000', '08003', '08006', '40001', '40P01', '57P01']) {
      const fn = vi.fn()
        .mockRejectedValueOnce(pgError(code))
        .mockResolvedValue('ok');
      const result = await withRetry(fn, { maxRetries: 1, baseDelayMs: 1 });
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    }
  });

  it('does not retry plain errors without code', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('random'));
    await expect(withRetry(fn)).rejects.toThrow('random');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
