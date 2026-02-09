import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RateLimiter } from '../rate-limiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new RateLimiter(3, 60_000);
  });

  afterEach(() => {
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
});
