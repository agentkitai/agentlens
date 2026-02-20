// @vitest-environment jsdom
import { renderHook, waitFor, act } from '@testing-library/react';
import { useApi, _apiCache } from '../useApi';

describe('useApi', () => {
  beforeEach(() => {
    _apiCache.clear();
  });

  it('starts in loading state with no data', () => {
    const fetcher = () => new Promise<string>(() => {}); // never resolves
    const { result } = renderHook(() => useApi(fetcher));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('returns data on successful fetch', async () => {
    const fetcher = () => Promise.resolve({ items: [1, 2] });
    const { result } = renderHook(() => useApi(fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ items: [1, 2] });
    expect(result.current.error).toBeNull();
  });

  it('sets error on fetch failure', async () => {
    const fetcher = () => Promise.reject(new Error('Network error'));
    const { result } = renderHook(() => useApi(fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Network error');
    expect(result.current.data).toBeNull();
  });

  it('handles non-Error rejection', async () => {
    const fetcher = () => Promise.reject('string error');
    const { result } = renderHook(() => useApi(fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('string error');
  });

  it('refetch re-executes the fetcher', async () => {
    let count = 0;
    const fetcher = () => Promise.resolve(++count);
    const { result } = renderHook(() => useApi(fetcher));
    await waitFor(() => expect(result.current.data).toBe(1));

    act(() => { result.current.refetch(); });
    await waitFor(() => expect(result.current.data).toBe(2));
  });

  it('sets loading=true during refetch', async () => {
    let resolve: (v: string) => void;
    const fetcher = () => new Promise<string>((r) => { resolve = r; });
    const { result } = renderHook(() => useApi(fetcher));

    // First call — resolve it
    act(() => { resolve!('first'); });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Trigger refetch — should go back to loading
    act(() => { result.current.refetch(); });
    expect(result.current.loading).toBe(true);
  });

  it('ignores stale responses when deps change', async () => {
    let resolve1: (v: string) => void;
    let resolve2: (v: string) => void;
    let call = 0;
    const fetcher = () =>
      new Promise<string>((r) => {
        call++;
        if (call === 1) resolve1 = r;
        else resolve2 = r;
      });

    const { result, rerender } = renderHook(
      ({ dep }) => useApi(fetcher, [dep]),
      { initialProps: { dep: 1 } },
    );

    // Change dep before first resolves
    rerender({ dep: 2 });

    // Resolve second (current) first, then stale first
    act(() => { resolve2!('second'); });
    await waitFor(() => expect(result.current.data).toBe('second'));

    act(() => { resolve1!('first'); });
    // Data should still be 'second'
    expect(result.current.data).toBe('second');
  });

  it('clears error on successful refetch', async () => {
    let shouldFail = true;
    const fetcher = () =>
      shouldFail ? Promise.reject(new Error('fail')) : Promise.resolve('ok');

    const { result } = renderHook(() => useApi(fetcher));
    await waitFor(() => expect(result.current.error).toBe('fail'));

    shouldFail = false;
    act(() => { result.current.refetch(); });
    await waitFor(() => expect(result.current.data).toBe('ok'));
    expect(result.current.error).toBeNull();
  });
});
