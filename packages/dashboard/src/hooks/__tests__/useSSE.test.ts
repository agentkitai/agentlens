// @vitest-environment jsdom
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSSE } from '../useSSE';

// --- Mock EventSource ---
type Listener = (e: MessageEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners: Record<string, Listener[]> = {};
  readyState = 0; // CONNECTING

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: Listener) {
    (this.listeners[type] ??= []).push(cb);
  }

  removeEventListener(type: string, cb: Listener) {
    const arr = this.listeners[type];
    if (arr) this.listeners[type] = arr.filter((f) => f !== cb);
  }

  close = vi.fn();

  // Test helpers
  simulateOpen() {
    this.readyState = 1;
    this.onopen?.();
  }

  simulateError() {
    this.readyState = 2;
    this.onerror?.();
  }

  simulateMessage(type: string, data: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const cb of this.listeners[type] ?? []) cb(event);
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function latestSource() {
  return MockEventSource.instances[MockEventSource.instances.length - 1];
}

describe('useSSE', () => {
  it('creates EventSource with correct URL', () => {
    renderHook(() => useSSE({ url: '/api/stream' }));
    expect(latestSource().url).toBe('/api/stream');
  });

  it('appends query params to URL', () => {
    renderHook(() =>
      useSSE({ url: '/api/stream', params: { session: '123', empty: undefined } }),
    );
    expect(latestSource().url).toBe('/api/stream?session=123');
  });

  it('sets connected=true on open', async () => {
    const { result } = renderHook(() => useSSE({ url: '/api/stream' }));
    expect(result.current.connected).toBe(false);
    act(() => latestSource().simulateOpen());
    expect(result.current.connected).toBe(true);
  });

  it('sets connected=false on error', async () => {
    const { result } = renderHook(() => useSSE({ url: '/api/stream' }));
    act(() => latestSource().simulateOpen());
    expect(result.current.connected).toBe(true);
    act(() => latestSource().simulateError());
    expect(result.current.connected).toBe(false);
  });

  it('dispatches event messages to onEvent', () => {
    const onEvent = vi.fn();
    renderHook(() => useSSE({ url: '/api/stream', onEvent }));
    act(() => {
      latestSource().simulateOpen();
      latestSource().simulateMessage('event', { id: 1 });
    });
    expect(onEvent).toHaveBeenCalledWith({ id: 1 });
  });

  it('dispatches session_update and alert messages', () => {
    const onSessionUpdate = vi.fn();
    const onAlert = vi.fn();
    renderHook(() => useSSE({ url: '/api/stream', onSessionUpdate, onAlert }));
    act(() => {
      latestSource().simulateOpen();
      latestSource().simulateMessage('session_update', { s: 1 });
      latestSource().simulateMessage('alert', { a: 2 });
    });
    expect(onSessionUpdate).toHaveBeenCalledWith({ s: 1 });
    expect(onAlert).toHaveBeenCalledWith({ a: 2 });
  });

  it('closes EventSource on unmount', () => {
    const { unmount } = renderHook(() => useSSE({ url: '/api/stream' }));
    const src = latestSource();
    unmount();
    expect(src.close).toHaveBeenCalled();
  });

  it('does not connect when enabled=false', () => {
    const count = MockEventSource.instances.length;
    renderHook(() => useSSE({ url: '/api/stream', enabled: false }));
    expect(MockEventSource.instances.length).toBe(count);
  });

  it('reconnects when URL changes', () => {
    const { rerender } = renderHook(
      ({ url }) => useSSE({ url }),
      { initialProps: { url: '/api/stream1' } },
    );
    const first = latestSource();
    rerender({ url: '/api/stream2' });
    expect(first.close).toHaveBeenCalled();
    expect(latestSource().url).toBe('/api/stream2');
  });

  it('heartbeat sets connected=true', () => {
    const { result } = renderHook(() => useSSE({ url: '/api/stream' }));
    // Simulate error first to set connected=false
    act(() => latestSource().simulateError());
    expect(result.current.connected).toBe(false);
    act(() => latestSource().simulateMessage('heartbeat', {}));
    expect(result.current.connected).toBe(true);
  });
});
