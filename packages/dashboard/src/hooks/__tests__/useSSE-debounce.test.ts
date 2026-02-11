import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDebouncedHandler } from '../useSSE';

describe('SSE debouncing (createDebouncedHandler)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls callback immediately when debounceMs=0', () => {
    const cb = vi.fn();
    const ref = { current: cb };
    const handler = createDebouncedHandler(0, ref);

    handler('a');
    handler('b');

    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenNthCalledWith(1, 'a');
    expect(cb).toHaveBeenNthCalledWith(2, 'b');
  });

  it('debounces rapid calls within the window', () => {
    const cb = vi.fn();
    const ref = { current: cb };
    const handler = createDebouncedHandler(2500, ref);

    handler('a');
    handler('b');
    handler('c');

    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2500);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('c'); // only last value
  });

  it('resets the debounce window on each new call', () => {
    const cb = vi.fn();
    const ref = { current: cb };
    const handler = createDebouncedHandler(2500, ref);

    handler('a');
    vi.advanceTimersByTime(2000);
    // Still within window, fire again — should reset
    handler('b');
    vi.advanceTimersByTime(2000);
    // 2000ms after 'b', not yet 2500
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('b');
  });

  it('fires separately for calls after the debounce window completes', () => {
    const cb = vi.fn();
    const ref = { current: cb };
    const handler = createDebouncedHandler(2500, ref);

    handler('first');
    vi.advanceTimersByTime(2500);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('first');

    handler('second');
    vi.advanceTimersByTime(2500);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenCalledWith('second');
  });
});
