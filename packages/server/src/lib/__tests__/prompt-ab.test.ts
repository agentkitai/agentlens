/**
 * Prompt A/B variant selection (#150): sticky weighted picking + validation.
 */
import { describe, it, expect } from 'vitest';
import { pickVariant, normalizeVariants, type AbVariant } from '../prompt-ab.js';

const AB: AbVariant[] = [
  { versionId: 'vA', label: 'A', weight: 90 },
  { versionId: 'vB', label: 'B', weight: 10 },
];

describe('pickVariant', () => {
  it('is sticky: the same key always resolves to the same variant', () => {
    const first = pickVariant(AB, 'user-123');
    for (let i = 0; i < 20; i++) expect(pickVariant(AB, 'user-123')?.versionId).toBe(first?.versionId);
  });

  it('splits traffic roughly by weight across many keys', () => {
    let a = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) if (pickVariant(AB, `key-${i}`)?.versionId === 'vA') a++;
    const share = a / N;
    expect(share).toBeGreaterThan(0.82); // ~0.90, allow hash variance
    expect(share).toBeLessThan(0.96);
  });

  it('never picks a zero-weight variant', () => {
    const v = [{ versionId: 'vA', label: 'A', weight: 0 }, { versionId: 'vB', label: 'B', weight: 5 }];
    for (let i = 0; i < 50; i++) expect(pickVariant(v, `k${i}`)?.versionId).toBe('vB');
  });

  it('returns undefined when no variant has positive weight', () => {
    expect(pickVariant([{ versionId: 'vA', label: 'A', weight: 0 }], 'k')).toBeUndefined();
    expect(pickVariant([], 'k')).toBeUndefined();
  });
});

describe('normalizeVariants', () => {
  it('accepts valid variants and defaults the label to the versionId', () => {
    expect(normalizeVariants([{ versionId: 'v1', weight: 3 }])).toEqual([{ versionId: 'v1', label: 'v1', weight: 3 }]);
  });

  it('rejects invalid input', () => {
    expect(normalizeVariants([])).toBeNull();
    expect(normalizeVariants([{ versionId: 'v1', weight: 0 }])).toBeNull(); // no positive weight
    expect(normalizeVariants([{ weight: 5 }])).toBeNull(); // missing versionId
    expect(normalizeVariants('nope')).toBeNull();
  });
});
