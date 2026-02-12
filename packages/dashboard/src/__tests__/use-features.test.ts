import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFeatures, _resetFeaturesCache } from '../hooks/useFeatures';

describe('useFeatures', () => {
  beforeEach(() => {
    _resetFeaturesCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    _resetFeaturesCache();
  });

  it('returns lore=true when API returns { lore: true }', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ lore: true }), { status: 200 })
    );

    const { result } = renderHook(() => useFeatures());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lore).toBe(true);
  });

  it('returns lore=false when API returns { lore: false }', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ lore: false }), { status: 200 })
    );

    const { result } = renderHook(() => useFeatures());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lore).toBe(false);
  });

  it('returns lore=false on network error (fail-closed)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useFeatures());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lore).toBe(false);
  });

  it('returns lore=false on invalid JSON (fail-closed)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not json', { status: 200 })
    );

    const { result } = renderHook(() => useFeatures());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lore).toBe(false);
  });

  it('returns lore=false when response has invalid shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ something: 'else' }), { status: 200 })
    );

    const { result } = renderHook(() => useFeatures());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lore).toBe(false);
  });
});
