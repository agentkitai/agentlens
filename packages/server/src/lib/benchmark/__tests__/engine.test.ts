/**
 * Tests for BenchmarkEngine (Story 3.4)
 *
 * End-to-end orchestration, summary formatting, caching, warnings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BenchmarkEngine } from '../engine.js';
import type {
  IEventStore,
  Session,
  BenchmarkMetric,
  MetricComparison,
  MetricStats,
  VariantMetrics,
  BenchmarkResults,
} from '@agentlensai/core';
import type { BenchmarkWithVariants, BenchmarkStore } from '../../../db/benchmark-store.js';

// ─── Helpers ───────────────────────────────────────────────

const engine = new BenchmarkEngine();

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: `session-${Math.random().toString(36).slice(2, 8)}`,
    agentId: 'agent-1',
    agentName: 'Test Agent',
    startedAt: '2026-01-01T00:00:00Z',
    endedAt: '2026-01-01T00:05:00Z',
    status: 'completed',
    eventCount: 100,
    toolCallCount: 20,
    errorCount: 2,
    totalCostUsd: 0.05,
    llmCallCount: 10,
    totalInputTokens: 5000,
    totalOutputTokens: 3000,
    tags: [],
    tenantId: 'tenant-1',
    ...overrides,
  };
}

function makeSessions(tag: string, count: number, costBase: number, errorRate: number): Session[] {
  return Array.from({ length: count }, (_, i) =>
    makeSession({
      id: `ses-${tag}-${i}`,
      tags: [tag],
      totalCostUsd: costBase + (Math.random() - 0.5) * costBase * 0.3,
      errorCount: Math.random() < errorRate ? 1 : 0,
      eventCount: 50,
      toolCallCount: 10,
      status: 'completed',
    }),
  );
}

function makeBenchmark(overrides: Partial<BenchmarkWithVariants> = {}): BenchmarkWithVariants {
  return {
    id: 'bench-1',
    tenantId: 'tenant-1',
    name: 'Test Benchmark',
    status: 'running',
    metrics: ['avg_cost', 'error_rate'] as BenchmarkMetric[],
    minSessionsPerVariant: 10,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    variants: [
      {
        id: 'var-a',
        benchmarkId: 'bench-1',
        tenantId: 'tenant-1',
        name: 'Variant A',
        tag: 'config:variant-a',
        sortOrder: 0,
      },
      {
        id: 'var-b',
        benchmarkId: 'bench-1',
        tenantId: 'tenant-1',
        name: 'Variant B',
        tag: 'config:variant-b',
        sortOrder: 1,
      },
    ],
    ...overrides,
  };
}

function makeMockStore(sessionsByTag: Record<string, Session[]>): IEventStore {
  return {
    querySessions: vi.fn().mockImplementation(async (opts: { tags?: string[] }) => {
      const tag = opts.tags?.[0] ?? '';
      const sessions = sessionsByTag[tag] ?? [];
      return { sessions, total: sessions.length };
    }),
  } as unknown as IEventStore;
}

function makeMockBenchmarkStore(cachedResults?: BenchmarkResults): BenchmarkStore {
  return {
    getResults: vi.fn().mockReturnValue(cachedResults ?? null),
    saveResults: vi.fn(),
  } as unknown as BenchmarkStore;
}

// ─── Tests ─────────────────────────────────────────────────

describe('BenchmarkEngine — computeResults', () => {
  it('produces results for 2-variant benchmark end-to-end', async () => {
    // Variant A: higher cost, Variant B: lower cost
    const sessionsA = makeSessions('config:variant-a', 40, 0.10, 0.10);
    const sessionsB = makeSessions('config:variant-b', 40, 0.05, 0.05);

    const store = makeMockStore({
      'config:variant-a': sessionsA,
      'config:variant-b': sessionsB,
    });

    const benchmark = makeBenchmark();
    const results = await engine.computeResults(benchmark, store);

    // Should have 2 variant metrics
    expect(results.variants).toHaveLength(2);
    expect(results.variants[0]!.variantId).toBe('var-a');
    expect(results.variants[1]!.variantId).toBe('var-b');

    // Session counts
    expect(results.variants[0]!.sessionCount).toBe(40);
    expect(results.variants[1]!.sessionCount).toBe(40);

    // Should have comparisons (2 metrics × 1 pair = 2 comparisons)
    expect(results.comparisons).toHaveLength(2);

    // Comparisons should have the correct metrics
    const compMetrics = results.comparisons.map((c) => c.metric).sort();
    expect(compMetrics).toEqual(['avg_cost', 'error_rate']);

    // Should have a summary
    expect(results.summary).toBeTruthy();
    expect(typeof results.summary).toBe('string');

    // computedAt should be set
    expect(results.computedAt).toBeTruthy();
    expect(results.benchmarkId).toBe('bench-1');
  });

  it('computes all pairwise comparisons for 3-variant benchmark', async () => {
    const sessionsA = makeSessions('config:a', 35, 0.10, 0.15);
    const sessionsB = makeSessions('config:b', 35, 0.06, 0.05);
    const sessionsC = makeSessions('config:c', 35, 0.08, 0.10);

    const store = makeMockStore({
      'config:a': sessionsA,
      'config:b': sessionsB,
      'config:c': sessionsC,
    });

    const benchmark = makeBenchmark({
      variants: [
        { id: 'var-a', benchmarkId: 'bench-1', tenantId: 'tenant-1', name: 'A', tag: 'config:a', sortOrder: 0 },
        { id: 'var-b', benchmarkId: 'bench-1', tenantId: 'tenant-1', name: 'B', tag: 'config:b', sortOrder: 1 },
        { id: 'var-c', benchmarkId: 'bench-1', tenantId: 'tenant-1', name: 'C', tag: 'config:c', sortOrder: 2 },
      ],
    });

    const results = await engine.computeResults(benchmark, store);

    // 3 variants → 3 pairs × 2 metrics = 6 comparisons
    expect(results.comparisons).toHaveLength(6);
    expect(results.variants).toHaveLength(3);

    // Verify all pairs are present
    const pairs = results.comparisons.map(
      (c) => `${c.variantA.id}-${c.variantB.id}`,
    );
    const uniquePairs = [...new Set(pairs)];
    expect(uniquePairs).toHaveLength(3); // A-B, A-C, B-C
  });

  it('returns cached results for completed benchmarks', async () => {
    const cachedResults: BenchmarkResults = {
      benchmarkId: 'bench-1',
      tenantId: 'tenant-1',
      variants: [],
      comparisons: [],
      summary: 'Cached summary',
      computedAt: '2026-01-01T00:00:00Z',
    };

    const store = makeMockStore({});
    const benchmarkStore = makeMockBenchmarkStore(cachedResults);

    const benchmark = makeBenchmark({ status: 'completed' });
    const results = await engine.computeResults(benchmark, store, benchmarkStore);

    expect(results.summary).toBe('Cached summary');
    expect(benchmarkStore.getResults).toHaveBeenCalledWith('tenant-1', 'bench-1');
    // Event store should NOT have been called because results were cached
    expect(store.querySessions).not.toHaveBeenCalled();
  });

  it('computes on-the-fly for running benchmarks (no caching)', async () => {
    const sessionsA = makeSessions('config:variant-a', 20, 0.05, 0.1);
    const sessionsB = makeSessions('config:variant-b', 20, 0.05, 0.1);

    const store = makeMockStore({
      'config:variant-a': sessionsA,
      'config:variant-b': sessionsB,
    });

    const benchmarkStore = makeMockBenchmarkStore();
    const benchmark = makeBenchmark({ status: 'running' });

    const results = await engine.computeResults(benchmark, store, benchmarkStore);

    // Should compute results
    expect(results.variants).toHaveLength(2);
    // Should NOT cache for running benchmarks
    expect(benchmarkStore.saveResults).not.toHaveBeenCalled();
  });

  it('caches results for completed benchmarks when not already cached', async () => {
    const sessionsA = makeSessions('config:variant-a', 35, 0.10, 0.1);
    const sessionsB = makeSessions('config:variant-b', 35, 0.05, 0.05);

    const store = makeMockStore({
      'config:variant-a': sessionsA,
      'config:variant-b': sessionsB,
    });

    const benchmarkStore = makeMockBenchmarkStore(null as any);
    // getResults returns null (no cache)
    (benchmarkStore.getResults as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const benchmark = makeBenchmark({ status: 'completed' });

    const results = await engine.computeResults(benchmark, store, benchmarkStore);

    expect(results.variants).toHaveLength(2);
    expect(benchmarkStore.saveResults).toHaveBeenCalledWith(
      'tenant-1',
      'bench-1',
      expect.objectContaining({
        benchmarkId: 'bench-1',
        tenantId: 'tenant-1',
      }),
    );
  });
});

// ─── formatSummary ─────────────────────────────────────────

describe('BenchmarkEngine — formatSummary', () => {
  const baseStats: MetricStats = {
    mean: 0.10,
    median: 0.09,
    stddev: 0.02,
    min: 0.05,
    max: 0.15,
    count: 40,
  };

  function makeComparison(overrides: Partial<MetricComparison> = {}): MetricComparison {
    return {
      metric: 'avg_cost',
      variantA: { id: 'var-a', name: 'Variant A', stats: baseStats },
      variantB: { id: 'var-b', name: 'Variant B', stats: { ...baseStats, mean: 0.07 } },
      absoluteDiff: -0.03,
      percentDiff: -30,
      testType: 'welch_t',
      testStatistic: 3.5,
      pValue: 0.001,
      confidenceInterval: { lower: -0.04, upper: -0.02 },
      effectSize: 1.2,
      significant: true,
      winner: 'var-b',
      confidence: '★★★',
      ...overrides,
    };
  }

  function makeVariantMetrics(overrides: Partial<VariantMetrics> = {}): VariantMetrics {
    return {
      variantId: 'var-a',
      variantName: 'Variant A',
      sessionCount: 40,
      metrics: { avg_cost: baseStats } as Record<BenchmarkMetric, MetricStats>,
      ...overrides,
    };
  }

  it('generates summary with significant differences', () => {
    const comparisons = [
      makeComparison({
        metric: 'avg_cost',
        percentDiff: -29,
        significant: true,
        winner: 'var-b',
        confidence: '★★★',
      }),
    ];
    const variants = [
      makeVariantMetrics({ variantId: 'var-a', variantName: 'Variant A', sessionCount: 40 }),
      makeVariantMetrics({ variantId: 'var-b', variantName: 'Variant B', sessionCount: 40 }),
    ];

    const summary = engine.formatSummary(comparisons, variants);

    expect(summary).toContain('Variant B');
    expect(summary).toContain('outperforms');
    expect(summary).toContain('Variant A');
    expect(summary).toContain('cost');
    expect(summary).toContain('★★★');
  });

  it('warns about insufficient data when variant has < 30 sessions', () => {
    const comparisons = [makeComparison()];
    const variants = [
      makeVariantMetrics({ variantId: 'var-a', variantName: 'Variant A', sessionCount: 15 }),
      makeVariantMetrics({ variantId: 'var-b', variantName: 'Variant B', sessionCount: 40 }),
    ];

    const summary = engine.formatSummary(comparisons, variants);

    expect(summary).toContain('Insufficient data');
    expect(summary).toContain('Variant A: 15 sessions');
  });

  it('reports no significant differences when none found', () => {
    const comparisons = [
      makeComparison({
        significant: false,
        winner: undefined,
        confidence: '—',
        pValue: 0.5,
      }),
    ];
    const variants = [
      makeVariantMetrics({ variantId: 'var-a', variantName: 'Variant A', sessionCount: 40 }),
      makeVariantMetrics({ variantId: 'var-b', variantName: 'Variant B', sessionCount: 40 }),
    ];

    const summary = engine.formatSummary(comparisons, variants);

    expect(summary).toContain('No significant difference');
  });

  it('handles multiple metrics in summary', () => {
    const comparisons = [
      makeComparison({
        metric: 'avg_cost',
        percentDiff: -29,
        significant: true,
        winner: 'var-b',
        confidence: '★★★',
      }),
      makeComparison({
        metric: 'error_rate',
        percentDiff: -25,
        significant: true,
        winner: 'var-b',
        confidence: '★★',
      }),
      makeComparison({
        metric: 'avg_latency',
        significant: false,
        winner: undefined,
        confidence: '—',
        pValue: 0.4,
      }),
    ];
    const variants = [
      makeVariantMetrics({ variantId: 'var-a', variantName: 'Variant A', sessionCount: 50 }),
      makeVariantMetrics({ variantId: 'var-b', variantName: 'Variant B', sessionCount: 50 }),
    ];

    const summary = engine.formatSummary(comparisons, variants);

    expect(summary).toContain('cost');
    expect(summary).toContain('error rate');
    expect(summary).toContain('No significant difference');
    expect(summary).toContain('latency');
  });
});
