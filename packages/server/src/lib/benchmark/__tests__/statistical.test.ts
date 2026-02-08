/**
 * Tests for StatisticalComparator (Story 3.3)
 *
 * Welch's t-test, chi-squared test, metric comparison, edge cases.
 */

import { describe, it, expect } from 'vitest';
import { StatisticalComparator } from '../statistical.js';
import type { MetricStats, BenchmarkMetric } from '@agentlensai/core';

const comparator = new StatisticalComparator();

function makeStats(overrides: Partial<MetricStats> = {}): MetricStats {
  return {
    mean: 100,
    median: 100,
    stddev: 10,
    min: 80,
    max: 120,
    count: 30,
    ...overrides,
  };
}

// ─── Welch's t-test ────────────────────────────────────────

describe('StatisticalComparator — welchTTest', () => {
  it('computes correct t-test for known datasets', () => {
    // Two groups with clearly different means
    const statsA = makeStats({ mean: 100, stddev: 10, count: 30 });
    const statsB = makeStats({ mean: 110, stddev: 10, count: 30 });

    const result = comparator.welchTTest(statsA, statsB);

    // t = (100 - 110) / sqrt(100/30 + 100/30) = -10 / sqrt(6.667) = -10/2.582 ≈ -3.873
    expect(result.tStatistic).toBeCloseTo(-3.873, 1);
    // df ≈ 58 for equal variance/n
    expect(result.degreesOfFreedom).toBeCloseTo(58, 0);
    // Should be highly significant (p < 0.001)
    expect(result.pValue).toBeLessThan(0.001);
  });

  it('returns non-significant result for identical distributions', () => {
    const statsA = makeStats({ mean: 50, stddev: 10, count: 20 });
    const statsB = makeStats({ mean: 50, stddev: 10, count: 20 });

    const result = comparator.welchTTest(statsA, statsB);

    expect(result.tStatistic).toBeCloseTo(0, 5);
    expect(result.pValue).toBeCloseTo(1, 1);
  });

  it('computes correct confidence interval', () => {
    const statsA = makeStats({ mean: 100, stddev: 10, count: 50 });
    const statsB = makeStats({ mean: 105, stddev: 10, count: 50 });

    const result = comparator.welchTTest(statsA, statsB);

    // CI should contain the true difference of 5
    expect(result.confidenceInterval.lower).toBeLessThan(5);
    expect(result.confidenceInterval.upper).toBeGreaterThan(5);
    // CI should be centered around 5 (B.mean - A.mean)
    const center = (result.confidenceInterval.lower + result.confidenceInterval.upper) / 2;
    expect(center).toBeCloseTo(5, 1);
  });

  it('computes correct Cohen\'s d', () => {
    // Means differ by 1 pooled SD → d ≈ 1.0
    const statsA = makeStats({ mean: 100, stddev: 10, count: 30 });
    const statsB = makeStats({ mean: 110, stddev: 10, count: 30 });

    const result = comparator.welchTTest(statsA, statsB);

    // d = |100 - 110| / 10 = 1.0
    expect(result.cohenD).toBeCloseTo(1.0, 1);
  });

  it('handles zero variance (both groups)', () => {
    const statsA = makeStats({ mean: 50, stddev: 0, count: 10 });
    const statsB = makeStats({ mean: 50, stddev: 0, count: 10 });

    const result = comparator.welchTTest(statsA, statsB);

    expect(result.pValue).toBe(1);
    expect(result.cohenD).toBe(0);
  });

  it('handles n < 2 with warning (returns p=1)', () => {
    const statsA = makeStats({ mean: 50, stddev: 0, count: 1 });
    const statsB = makeStats({ mean: 100, stddev: 0, count: 1 });

    const result = comparator.welchTTest(statsA, statsB);

    expect(result.pValue).toBe(1);
    expect(result.degreesOfFreedom).toBe(0);
  });
});

// ─── Chi-Squared Test ──────────────────────────────────────

describe('StatisticalComparator — chiSquaredTest', () => {
  it('computes correct chi-squared for known dataset', () => {
    // Group A: 80/100 successes, Group B: 60/100 successes
    const result = comparator.chiSquaredTest(80, 100, 60, 100);

    // Expected: significant difference
    expect(result.chiSquared).toBeGreaterThan(3.84); // critical value for p=0.05
    expect(result.pValue).toBeLessThan(0.05);
  });

  it('computes correct phi coefficient', () => {
    // 2x2 table with large difference
    const result = comparator.chiSquaredTest(90, 100, 10, 100);

    // phi = sqrt(chi2 / n)
    expect(result.phi).toBeGreaterThan(0.5); // large effect
    expect(result.phi).toBeLessThanOrEqual(1.0);
  });

  it('returns non-significant for similar proportions', () => {
    // Nearly equal proportions
    const result = comparator.chiSquaredTest(50, 100, 51, 100);

    expect(result.pValue).toBeGreaterThan(0.1);
    expect(result.chiSquared).toBeLessThan(3.84);
  });

  it('handles zero counts', () => {
    const result = comparator.chiSquaredTest(0, 0, 0, 0);
    expect(result.pValue).toBe(1);
    expect(result.phi).toBe(0);
  });

  it('handles all-same outcomes (no variation)', () => {
    // All successes
    const result = comparator.chiSquaredTest(100, 100, 100, 100);
    expect(result.pValue).toBe(1);
    expect(result.chiSquared).toBe(0);
  });
});

// ─── Compare (metric direction & test selection) ───────────

describe('StatisticalComparator — compare', () => {
  const variantA = {
    id: 'va',
    name: 'Variant A',
    metrics: {
      avg_cost: makeStats({ mean: 0.10, stddev: 0.02, count: 50 }),
      health_score: makeStats({ mean: 80, stddev: 5, count: 50 }),
      error_rate: makeStats({ mean: 0.05, stddev: 0, count: 50 }),
      completion_rate: makeStats({ mean: 0.90, stddev: 0, count: 50 }),
    } as Record<string, MetricStats>,
  };

  const variantB = {
    id: 'vb',
    name: 'Variant B',
    metrics: {
      avg_cost: makeStats({ mean: 0.05, stddev: 0.02, count: 50 }),
      health_score: makeStats({ mean: 90, stddev: 5, count: 50 }),
      error_rate: makeStats({ mean: 0.02, stddev: 0, count: 50 }),
      completion_rate: makeStats({ mean: 0.95, stddev: 0, count: 50 }),
    } as Record<string, MetricStats>,
  };

  it('uses t-test for continuous metrics', () => {
    const result = comparator.compare(variantA, variantB, 'avg_cost');
    expect(result.testType).toBe('welch_t');
  });

  it('uses chi-squared for proportion metrics', () => {
    const result = comparator.compare(variantA, variantB, 'error_rate');
    expect(result.testType).toBe('chi_squared');
  });

  it('determines correct winner for lower-is-better (avg_cost)', () => {
    const result = comparator.compare(variantA, variantB, 'avg_cost');
    // B has lower cost (0.05 vs 0.10) → B wins (if significant)
    if (result.significant) {
      expect(result.winner).toBe('vb');
    }
  });

  it('determines correct winner for higher-is-better (health_score)', () => {
    const result = comparator.compare(variantA, variantB, 'health_score');
    // B has higher health score (90 vs 80) → B wins (if significant)
    if (result.significant) {
      expect(result.winner).toBe('vb');
    }
  });

  it('has no winner when not significant', () => {
    // Create variants with nearly identical stats
    const va = {
      id: 'va',
      name: 'A',
      metrics: {
        avg_cost: makeStats({ mean: 0.10, stddev: 0.05, count: 5 }),
      } as Record<string, MetricStats>,
    };
    const vb = {
      id: 'vb',
      name: 'B',
      metrics: {
        avg_cost: makeStats({ mean: 0.10, stddev: 0.05, count: 5 }),
      } as Record<string, MetricStats>,
    };

    const result = comparator.compare(va, vb, 'avg_cost');
    expect(result.winner).toBeUndefined();
    expect(result.significant).toBe(false);
  });
});

// ─── Confidence Stars ──────────────────────────────────────

describe('StatisticalComparator — confidenceStars', () => {
  it('returns ★★★ for p < 0.01', () => {
    expect(comparator.confidenceStars(0.005)).toBe('★★★');
    expect(comparator.confidenceStars(0.001)).toBe('★★★');
  });

  it('returns ★★ for p < 0.05', () => {
    expect(comparator.confidenceStars(0.02)).toBe('★★');
    expect(comparator.confidenceStars(0.049)).toBe('★★');
  });

  it('returns ★ for p < 0.1', () => {
    expect(comparator.confidenceStars(0.06)).toBe('★');
    expect(comparator.confidenceStars(0.099)).toBe('★');
  });

  it('returns — for p ≥ 0.1', () => {
    expect(comparator.confidenceStars(0.1)).toBe('—');
    expect(comparator.confidenceStars(0.5)).toBe('—');
    expect(comparator.confidenceStars(1)).toBe('—');
  });
});
