import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RateLimiter } from '../rate-limiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new RateLimiter(3, 60_000);
  });

  afterEach(() => {
    limiter.destroy();
    vi.useRealTimers();
  });

  it('allows requests within limit', () => {
    expect(limiter.isAllowed('key1')).toBe(true);
    expect(limiter.isAllowed('key1')).toBe(true);
    expect(limiter.isAllowed('key1')).toBe(true);
  });

  it('blocks requests exceeding limit', () => {
    limiter.isAllowed('key1');
    limiter.isAllowed('key1');
    limiter.isAllowed('key1');
    expect(limiter.isAllowed('key1')).toBe(false);
  });

  it('tracks different keys independently', () => {
    limiter.isAllowed('key1');
    limiter.isAllowed('key1');
    limiter.isAllowed('key1');
    expect(limiter.isAllowed('key1')).toBe(false);
    expect(limiter.isAllowed('key2')).toBe(true);
  });

  it('resets after window expires', () => {
    limiter.isAllowed('key1');
    limiter.isAllowed('key1');
    limiter.isAllowed('key1');
    expect(limiter.isAllowed('key1')).toBe(false);

    vi.advanceTimersByTime(60_001);
    expect(limiter.isAllowed('key1')).toBe(true);
  });

  it('reset clears all state', () => {
    limiter.isAllowed('key1');
    limiter.isAllowed('key1');
    limiter.isAllowed('key1');
    limiter.reset();
    expect(limiter.isAllowed('key1')).toBe(true);
  });

  it('exposes size getter', () => {
    expect(limiter.size).toBe(0);
    limiter.isAllowed('a');
    limiter.isAllowed('b');
    expect(limiter.size).toBe(2);
  });

  it('cleanup removes expired entries', () => {
    limiter.isAllowed('key1');
    limiter.isAllowed('key2');
    expect(limiter.size).toBe(2);

    // Advance past window expiry + cleanup interval
    vi.advanceTimersByTime(61_000);
    expect(limiter.size).toBe(0);
  });

  it('enforces max size cap of 100K entries', () => {
    // Insert 100K entries
    for (let i = 0; i < 100_000; i++) {
      limiter.isAllowed(`key-${i}`);
    }
    expect(limiter.size).toBe(100_000);

    // Adding one more should evict oldest
    limiter.isAllowed('overflow-key');
    expect(limiter.size).toBeLessThanOrEqual(100_000);
    expect(limiter.isAllowed('overflow-key')).toBe(true);
  });

  it('logs warning at 50K entries', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    for (let i = 0; i < 50_000; i++) {
      limiter.isAllowed(`key-${i}`);
    }

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('50000'),
    );
    warnSpy.mockRestore();
  });

  it('destroy clears interval and state', () => {
    limiter.isAllowed('key1');
    limiter.destroy();
    expect(limiter.size).toBe(0);

    // Advancing timers should not cause errors (interval cleared)
    vi.advanceTimersByTime(120_000);
  });
});
