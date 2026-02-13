import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseApiOptions {
  /** How long (ms) data is considered fresh — skip refetch if within window. Default: 0 (always refetch). */
  staleTime?: number;
  /** How long (ms) to keep cached data after unmount. Default: 300_000 (5 min). */
  cacheTime?: number;
}

export interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/** Simple in-memory cache shared across useApi instances. */
const apiCache = new Map<string, { data: unknown; fetchedAt: number; timer?: ReturnType<typeof setTimeout> }>();

/** Build a stable cache key from the fetcher source + deps array. */
function depsKey(fetcher: Function, deps: unknown[]): string {
  return fetcher.toString().slice(0, 100) + '::' + JSON.stringify(deps);
}

/**
 * Generic hook that wraps an async API call with loading/error/data state.
 *
 * @param fetcher  — The async function to call (should return T).
 * @param deps     — Dependency array; refetch is triggered when deps change.
 * @param options  — Optional cache configuration (staleTime, cacheTime).
 */
export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
  options: UseApiOptions = {},
): UseApiState<T> {
  const { staleTime = 0, cacheTime = 300_000 } = options;
  const key = depsKey(fetcher, deps);

  const cached = apiCache.get(key);
  const [data, setData] = useState<T | null>(cached ? (cached.data as T) : null);
  const [loading, setLoading] = useState(cached ? false : true);
  const [error, setError] = useState<string | null>(null);

  // Track latest call to avoid stale updates when deps change rapidly
  const callId = useRef(0);

  const execute = useCallback(() => {
    // Check staleTime — if cached data is still fresh, skip the fetch
    if (staleTime > 0) {
      const entry = apiCache.get(key);
      if (entry && Date.now() - entry.fetchedAt < staleTime) {
        setData(entry.data as T);
        setLoading(false);
        setError(null);
        return;
      }
    }

    const id = ++callId.current;
    setLoading(true);
    setError(null);

    fetcher()
      .then((result) => {
        if (id === callId.current) {
          setData(result);
          setLoading(false);
          apiCache.set(key, { data: result, fetchedAt: Date.now() });
        }
      })
      .catch((err: unknown) => {
        if (id === callId.current) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    // Cancel any pending cache eviction for this key
    const entry = apiCache.get(key);
    if (entry?.timer) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }

    execute();

    return () => {
      // Schedule cache eviction on unmount
      const e = apiCache.get(key);
      if (e) {
        e.timer = setTimeout(() => apiCache.delete(key), cacheTime);
      }
    };
  }, [execute]);

  return { data, loading, error, refetch: execute };
}

// Expose for testing
export { apiCache as _apiCache };
