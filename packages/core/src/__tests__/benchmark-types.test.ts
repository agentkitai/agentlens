import { describe, it, expect } from 'vitest';
import {
  BenchmarkSchema,
  BenchmarkVariantSchema,
  BenchmarkStatusSchema,
  BenchmarkMetricSchema,
} from '../schemas.js';
import type {
  Benchmark,
  BenchmarkVariant,
  BenchmarkStatus,
  BenchmarkMetric,
  MetricStats,
  MetricComparison,
  VariantMetrics,
  BenchmarkResults,
} from '../types.js';
import { BENCHMARK_METRICS } from '../types.js';

describe('Benchmark Types (Story 1.2)', () => {
  describe('BENCHMARK_METRICS const', () => {
    it('contains all 8 metric types', () => {
      expect(BENCHMARK_METRICS).toHaveLength(8);
      expect(BENCHMARK_METRICS).toContain('health_score');
      expect(BENCHMARK_METRICS).toContain('error_rate');
      expect(BENCHMARK_METRICS).toContain('avg_cost');
      expect(BENCHMARK_METRICS).toContain('avg_latency');
      expect(BENCHMARK_METRICS).toContain('tool_success_rate');
      expect(BENCHMARK_METRICS).toContain('completion_rate');
      expect(BENCHMARK_METRICS).toContain('avg_tokens');
      expect(BENCHMARK_METRICS).toContain('avg_duration');
    });

    it('is readonly at the type level', () => {
      // `as const` provides readonly at type level; verify the array is usable
      expect(Array.isArray(BENCHMARK_METRICS)).toBe(true);
      expect(BENCHMARK_METRICS.length).toBeGreaterThan(0);
    });
  });

  describe('BenchmarkStatus type', () => {
    it('accepts valid statuses via schema', () => {
      const statuses: BenchmarkStatus[] = ['draft', 'running', 'completed', 'cancelled'];
      for (const s of statuses) {
        expect(BenchmarkStatusSchema.parse(s)).toBe(s);
      }
    });

    it('rejects invalid status', () => {
      expect(() => BenchmarkStatusSchema.parse('paused')).toThrow();
    });
  });

  describe('BenchmarkMetric type', () => {
    it('accepts all valid metrics via schema', () => {
      for (const m of BENCHMARK_METRICS) {
        expect(BenchmarkMetricSchema.parse(m)).toBe(m);
      }
    });

    it('rejects invalid metric', () => {
      expect(() => BenchmarkMetricSchema.parse('invalid_metric')).toThrow();
    });
  });

  describe('Benchmark interface', () => {
    const validBenchmark: Benchmark = {
      id: 'bench-01',
      tenantId: 'tenant-1',
      name: 'Model Comparison',
      description: 'Compare claude vs gpt',
      status: 'draft',
      agentId: 'agent-1',
      metrics: ['avg_cost', 'avg_latency', 'error_rate'],
      minSessionsPerVariant: 20,
      timeRange: { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' },
      createdAt: '2026-02-08T12:00:00Z',
      updatedAt: '2026-02-08T12:00:00Z',
      completedAt: undefined,
    };

    it('accepts a valid benchmark via schema', () => {
      expect(BenchmarkSchema.parse(validBenchmark)).toMatchObject({
        id: 'bench-01',
        name: 'Model Comparison',
        status: 'draft',
      });
    });

    it('allows optional fields to be omitted', () => {
      const minimal: Benchmark = {
        id: 'bench-02',
        tenantId: 'tenant-1',
        name: 'Minimal',
        status: 'draft',
        metrics: ['health_score'],
        minSessionsPerVariant: 10,
        createdAt: '2026-02-08T12:00:00Z',
        updatedAt: '2026-02-08T12:00:00Z',
      };
      expect(BenchmarkSchema.parse(minimal)).toBeDefined();
    });

    it('rejects empty name', () => {
      expect(() =>
        BenchmarkSchema.parse({ ...validBenchmark, name: '' }),
      ).toThrow();
    });

    it('rejects empty metrics array', () => {
      expect(() =>
        BenchmarkSchema.parse({ ...validBenchmark, metrics: [] }),
      ).toThrow();
    });

    it('rejects minSessionsPerVariant < 1', () => {
      expect(() =>
        BenchmarkSchema.parse({ ...validBenchmark, minSessionsPerVariant: 0 }),
      ).toThrow();
    });
  });

  describe('BenchmarkVariant interface', () => {
    const validVariant: BenchmarkVariant = {
      id: 'var-01',
      benchmarkId: 'bench-01',
      tenantId: 'tenant-1',
      name: 'Claude Opus',
      description: 'Variant using Claude Opus',
      tag: 'model:claude-opus',
      agentId: 'agent-1',
      sortOrder: 0,
    };

    it('accepts a valid variant via schema', () => {
      expect(BenchmarkVariantSchema.parse(validVariant)).toMatchObject({
        id: 'var-01',
        tag: 'model:claude-opus',
      });
    });

    it('allows optional fields to be omitted', () => {
      const minimal: BenchmarkVariant = {
        id: 'var-02',
        benchmarkId: 'bench-01',
        tenantId: 'tenant-1',
        name: 'GPT-4o',
        tag: 'model:gpt-4o',
        sortOrder: 1,
      };
      expect(BenchmarkVariantSchema.parse(minimal)).toBeDefined();
    });

    it('rejects empty tag', () => {
      expect(() =>
        BenchmarkVariantSchema.parse({ ...validVariant, tag: '' }),
      ).toThrow();
    });
  });

  describe('MetricStats interface', () => {
    it('accepts valid stats', () => {
      const stats: MetricStats = {
        mean: 0.05,
        median: 0.04,
        stddev: 0.01,
        min: 0.01,
        max: 0.12,
        count: 50,
        values: [0.01, 0.04, 0.05, 0.12],
      };
      expect(stats.mean).toBe(0.05);
      expect(stats.values).toHaveLength(4);
    });

    it('allows values to be omitted', () => {
      const stats: MetricStats = {
        mean: 10,
        median: 9,
        stddev: 2,
        min: 5,
        max: 15,
        count: 100,
      };
      expect(stats.values).toBeUndefined();
    });
  });

  describe('MetricComparison interface', () => {
    it('accepts valid comparison', () => {
      const comparison: MetricComparison = {
        metric: 'avg_cost',
        variantA: { id: 'v1', name: 'Claude', stats: { mean: 0.05, median: 0.04, stddev: 0.01, min: 0.01, max: 0.12, count: 50 } },
        variantB: { id: 'v2', name: 'GPT', stats: { mean: 0.08, median: 0.07, stddev: 0.02, min: 0.02, max: 0.15, count: 48 } },
        absoluteDiff: 0.03,
        percentDiff: 60,
        testType: 'welch_t',
        testStatistic: 2.45,
        pValue: 0.018,
        confidenceInterval: { lower: 0.005, upper: 0.055 },
        effectSize: 0.7,
        significant: true,
        winner: 'v1',
        confidence: '★★',
      };
      expect(comparison.significant).toBe(true);
      expect(comparison.winner).toBe('v1');
    });

    it('allows winner to be undefined (no significant difference)', () => {
      const comparison: MetricComparison = {
        metric: 'health_score',
        variantA: { id: 'v1', name: 'A', stats: { mean: 80, median: 80, stddev: 5, min: 70, max: 90, count: 30 } },
        variantB: { id: 'v2', name: 'B', stats: { mean: 81, median: 81, stddev: 5, min: 71, max: 91, count: 30 } },
        absoluteDiff: 1,
        percentDiff: 1.25,
        testType: 'welch_t',
        testStatistic: 0.5,
        pValue: 0.62,
        confidenceInterval: { lower: -3, upper: 5 },
        effectSize: 0.1,
        significant: false,
        confidence: '—',
      };
      expect(comparison.winner).toBeUndefined();
      expect(comparison.significant).toBe(false);
    });
  });

  describe('VariantMetrics interface', () => {
    it('uses Record<BenchmarkMetric, MetricStats> for metrics', () => {
      const baseStats: MetricStats = { mean: 0, median: 0, stddev: 0, min: 0, max: 0, count: 0 };
      const vm: VariantMetrics = {
        variantId: 'v1',
        variantName: 'Claude',
        sessionCount: 50,
        metrics: {
          health_score: { ...baseStats, mean: 85 },
          error_rate: { ...baseStats, mean: 0.02 },
          avg_cost: { ...baseStats, mean: 0.05 },
          avg_latency: { ...baseStats, mean: 200 },
          tool_success_rate: { ...baseStats, mean: 0.95 },
          completion_rate: { ...baseStats, mean: 0.9 },
          avg_tokens: { ...baseStats, mean: 1500 },
          avg_duration: { ...baseStats, mean: 30000 },
        },
      };
      expect(Object.keys(vm.metrics)).toHaveLength(8);
    });
  });

  describe('BenchmarkResults interface', () => {
    it('composes variants, comparisons, and summary', () => {
      const results: BenchmarkResults = {
        benchmarkId: 'bench-01',
        tenantId: 'tenant-1',
        variants: [],
        comparisons: [],
        summary: 'No significant differences found.',
        computedAt: '2026-02-08T15:00:00Z',
      };
      expect(results.benchmarkId).toBe('bench-01');
      expect(results.summary).toContain('No significant');
    });
  });

  it('all benchmark types are exported from barrel', async () => {
    const core = await import('../index.js');
    // Verify runtime exports
    expect(core.BENCHMARK_METRICS).toBeDefined();
    expect(core.BenchmarkSchema).toBeDefined();
    expect(core.BenchmarkVariantSchema).toBeDefined();
    expect(core.BenchmarkStatusSchema).toBeDefined();
    expect(core.BenchmarkMetricSchema).toBeDefined();
  });
});
