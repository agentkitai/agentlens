import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Generic hook that wraps an async API call with loading/error/data state.
 *
 * @param fetcher  — The async function to call (should return T).
 * @param deps     — Dependency array; refetch is triggered when deps change.
 */
export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): UseApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track latest call to avoid stale updates when deps change rapidly
  const callId = useRef(0);

  const execute = useCallback(() => {
    const id = ++callId.current;
    setLoading(true);
    setError(null);

    fetcher()
      .then((result) => {
        if (id === callId.current) {
          setData(result);
          setLoading(false);
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
    execute();
  }, [execute]);

  return { data, loading, error, refetch: execute };
}
