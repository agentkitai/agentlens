import { useState, useEffect } from 'react';

interface Features {
  lore: boolean;
  loading: boolean;
}

let cachedFeatures: { lore: boolean } | null = null;
let fetchPromise: Promise<{ lore: boolean }> | null = null;

function fetchFeatures(): Promise<{ lore: boolean }> {
  if (!fetchPromise) {
    fetchPromise = fetch('/api/config/features')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (typeof data?.lore !== 'boolean') throw new Error('Invalid response');
        const result = { lore: data.lore };
        cachedFeatures = result;
        return result;
      })
      .catch(() => {
        const fallback = { lore: false };
        cachedFeatures = fallback;
        fetchPromise = null; // Allow retry on next mount
        return fallback;
      });
  }
  return fetchPromise;
}

export function useFeatures(): Features {
  const [features, setFeatures] = useState<Features>(
    cachedFeatures ? { ...cachedFeatures, loading: false } : { lore: false, loading: true }
  );

  useEffect(() => {
    if (cachedFeatures) {
      setFeatures({ ...cachedFeatures, loading: false });
      return;
    }
    let cancelled = false;
    fetchFeatures().then((result) => {
      if (!cancelled) setFeatures({ ...result, loading: false });
    });
    return () => { cancelled = true; };
  }, []);

  return features;
}

// For testing: reset the module-level cache
export function _resetFeaturesCache(): void {
  cachedFeatures = null;
  fetchPromise = null;
}
