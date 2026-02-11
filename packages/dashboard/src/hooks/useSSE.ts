/**
 * useSSE — React hook for SSE connections (Story 14.2, Arch §8.3)
 *
 * Connects to the SSE endpoint with optional filters.
 * Handles connection state, auto-cleanup, and reconnection (via EventSource built-in).
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

export interface SSEEventData {
  /** SSE event type (e.g., 'event', 'session_update', 'alert', 'heartbeat') */
  type: string;
  /** Parsed JSON data from the SSE message */
  data: unknown;
}

export interface UseSSEOptions {
  /** SSE endpoint URL (e.g., '/api/stream') */
  url: string;
  /** Query parameters for filtering */
  params?: Record<string, string | undefined>;
  /** Called for each incoming 'event' message (new AgentLens event) */
  onEvent?: (data: unknown) => void;
  /** Called for each 'session_update' message */
  onSessionUpdate?: (data: unknown) => void;
  /** Called for each 'alert' message */
  onAlert?: (data: unknown) => void;
  /** Whether the SSE connection should be active (default: true) */
  enabled?: boolean;
  /** Debounce window in ms for batching rapid SSE callbacks. Default: 0 (no debounce). */
  debounceMs?: number;
}

export interface UseSSEResult {
  /** Whether the SSE connection is currently open */
  connected: boolean;
}

/**
 * Serialize params to a stable URL query string.
 * Filters out undefined values.
 */
function buildUrl(base: string, params?: Record<string, string | undefined>): string {
  if (!params) return base;
  const sp = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== '') {
      sp.set(key, val);
    }
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Creates a debounced version of a callback. When called multiple times within
 * the debounce window, only the last invocation's data is passed through.
 */
export function createDebouncedHandler(
  debounceMs: number,
  callbackRef: React.RefObject<((data: unknown) => void) | undefined>,
): (data: unknown) => void {
  if (debounceMs <= 0) {
    return (data: unknown) => callbackRef.current?.(data);
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latestData: unknown;
  return (data: unknown) => {
    latestData = data;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      callbackRef.current?.(latestData);
    }, debounceMs);
  };
}

export function useSSE({
  url,
  params,
  onEvent,
  onSessionUpdate,
  onAlert,
  enabled = true,
  debounceMs = 0,
}: UseSSEOptions): UseSSEResult {
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  // Store callbacks in refs to avoid reconnecting when they change
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onSessionUpdateRef = useRef(onSessionUpdate);
  onSessionUpdateRef.current = onSessionUpdate;
  const onAlertRef = useRef(onAlert);
  onAlertRef.current = onAlert;

  // Create debounced handlers (stable across renders for same debounceMs)
  const debouncedEvent = useMemo(() => createDebouncedHandler(debounceMs, onEventRef), [debounceMs]);
  const debouncedSessionUpdate = useMemo(() => createDebouncedHandler(debounceMs, onSessionUpdateRef), [debounceMs]);
  const debouncedAlert = useMemo(() => createDebouncedHandler(debounceMs, onAlertRef), [debounceMs]);

  // Stable serialized params for dependency
  const paramsKey = JSON.stringify(params ?? {});

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }

    const fullUrl = buildUrl(url, params);
    const source = new EventSource(fullUrl);
    sourceRef.current = source;

    source.onopen = () => {
      setConnected(true);
    };

    source.onerror = () => {
      setConnected(false);
      // EventSource auto-reconnects, onopen will set connected=true again
    };

    // Listen for specific SSE event types (debounced when configured)
    source.addEventListener('event', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        debouncedEvent(data);
      } catch {
        // Ignore malformed JSON
      }
    });

    source.addEventListener('session_update', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        debouncedSessionUpdate(data);
      } catch {
        // Ignore malformed JSON
      }
    });

    source.addEventListener('alert', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        debouncedAlert(data);
      } catch {
        // Ignore malformed JSON
      }
    });

    // Heartbeat just keeps the connection alive, no action needed
    source.addEventListener('heartbeat', () => {
      // Connection is alive; ensure connected state is true
      setConnected(true);
    });

    return () => {
      source.close();
      sourceRef.current = null;
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, paramsKey, enabled, debouncedEvent, debouncedSessionUpdate, debouncedAlert]);

  return { connected };
}
