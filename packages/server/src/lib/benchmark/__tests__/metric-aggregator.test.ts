/**
 * Tests for MetricAggregator (Story 3.2)
 *
 * Descriptive statistics, metric extraction, edge cases.
 */

import { describe, it, expect, vi } from 'vitest';
import { MetricAggregator } from '../metric-aggregator.js';
import type { Session, IEventStore, BenchmarkVariant } from '@agentlensai/core';

const aggregator = new MetricAggregator();

// ─── Helper: create mock sessions ─────────────────────────

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: `session-${Math.random().toString(36).slice(2, 8)}`,
    agentId: 'agent-1',
    agentName: 'Test Agent',
    startedAt: '2026-01-01T00:00:00Z',
    endedAt: '2026-01-01T00:05:00Z', // 5 minutes
    status: 'completed',
    eventCount: 100,
    toolCallCount: 20,
    errorCount: 2,
    totalCostUsd: 0.05,
    llmCallCount: 10,
    totalInputTokens: 5000,
    totalOutputTokens: 3000,
    tags: ['variant-a'],
    tenantId: 'tenant-1',
    ...overrides,
  };
}

function makeVariant(overrides: Partial<BenchmarkVariant> = {}): BenchmarkVariant {
  return {
    id: 'var-1',
    benchmarkId: 'bench-1',
    tenantId: 'tenant-1',
    name: 'Variant A',
    tag: 'variant-a',
    sortOrder: 0,
    ...overrides,
  };
}

function makeMockStore(sessions: Session[]): IEventStore {
  return {
    querySessions: vi.fn().mockResolvedValue({ sessions, total: sessions.length }),
  } as unknown as IEventStore;
}

// ─── computeStats ──────────────────────────────────────────

describe('MetricAggregator — computeStats', () => {
  it('computes correct mean', () => {
    const stats = aggregator.computeStats([10, 20, 30, 40, 50]);
    expect(stats.mean).toBe(30);
  });

  it('computes correct median for odd count', () => {
    const stats = aggregator.computeStats([10, 20, 30, 40, 50]);
    expect(stats.median).toBe(30);
  });

  it('computes correct median for even count', () => {
    const stats = aggregator.computeStats([10, 20, 30, 40]);
    expect(stats.median).toBe(25);
  });

  it('computes correct standard deviation (sample)', () => {
    // Values: [2, 4, 4, 4, 5, 5, 7, 9]
    // Mean = 5, Variance = 4 (sample), StdDev = 2
    const stats = aggregator.computeStats([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(stats.mean).toBe(5);
    expect(stats.stddev).toBeCloseTo(2.138, 2); // sample stddev
  });

  it('computes correct min and max', () => {
    const stats = aggregator.computeStats([5, 1, 9, 3, 7]);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(9);
  });

  it('returns count', () => {
    const stats = aggregator.computeStats([1, 2, 3]);
    expect(stats.count).toBe(3);
  });

  it('handles single value (stddev = 0)', () => {
    const stats = aggregator.computeStats([42]);
    expect(stats.mean).toBe(42);
    expect(stats.median).toBe(42);
    expect(stats.stddev).toBe(0);
    expect(stats.min).toBe(42);
    expect(stats.max).toBe(42);
    expect(stats.count).toBe(1);
  });

  it('handles empty array', () => {
    const stats = aggregator.computeStats([]);
    expect(stats.mean).toBe(0);
    expect(stats.median).toBe(0);
    expect(stats.stddev).toBe(0);
    expect(stats.count).toBe(0);
  });
});

// ─── Metric Extraction ────────────────────────────────────

describe('MetricAggregator — extractMetricValues', () => {
  const sessions = [
    makeSession({ totalCostUsd: 0.05 }),
    makeSession({ totalCostUsd: 0.10 }),
    makeSession({ totalCostUsd: 0.15 }),
  ];

  it('extracts avg_cost from totalCostUsd', () => {
    const values = aggregator.extractMetricValues(sessions, 'avg_cost');
    expect(values).toEqual([0.05, 0.10, 0.15]);
  });

  it('extracts error_rate as errorCount / eventCount', () => {
    const s = [
      makeSession({ errorCount: 2, eventCount: 100 }),
      makeSession({ errorCount: 5, eventCount: 50 }),
    ];
    const values = aggregator.extractMetricValues(s, 'error_rate');
    expect(values[0]).toBeCloseTo(0.02);
    expect(values[1]).toBeCloseTo(0.1);
  });

  it('extracts completion_rate as binary 0/1', () => {
    const s = [
      makeSession({ status: 'completed' }),
      makeSession({ status: 'error' }),
      makeSession({ status: 'completed' }),
    ];
    const values = aggregator.extractMetricValues(s, 'completion_rate');
    expect(values).toEqual([1, 0, 1]);
  });

  it('extracts tool_success_rate', () => {
    const s = [
      makeSession({ toolCallCount: 20, errorCount: 2 }),
    ];
    const values = aggregator.extractMetricValues(s, 'tool_success_rate');
    expect(values[0]).toBeCloseTo(0.9);
  });

  it('extracts avg_tokens as totalInputTokens + totalOutputTokens', () => {
    const s = [makeSession({ totalInputTokens: 5000, totalOutputTokens: 3000 })];
    const values = aggregator.extractMetricValues(s, 'avg_tokens');
    expect(values).toEqual([8000]);
  });

  it('extracts avg_duration from startedAt/endedAt in ms', () => {
    const s = [
      makeSession({
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T00:05:00Z', // 5 min = 300000ms
      }),
    ];
    const values = aggregator.extractMetricValues(s, 'avg_duration');
    expect(values).toEqual([300000]);
  });

  it('skips sessions with zero eventCount for error_rate', () => {
    const s = [makeSession({ errorCount: 0, eventCount: 0 })];
    const values = aggregator.extractMetricValues(s, 'error_rate');
    expect(values).toEqual([]); // null filtered out
  });

  it('skips sessions without endedAt for avg_duration', () => {
    const s = [makeSession({ endedAt: undefined })];
    const values = aggregator.extractMetricValues(s, 'avg_duration');
    expect(values).toEqual([]);
  });
});

// ─── Aggregate (integration with mock store) ───────────────

describe('MetricAggregator — aggregate', () => {
  it('aggregates metrics from queried sessions', async () => {
    const sessions = [
      makeSession({ totalCostUsd: 0.05 }),
      makeSession({ totalCostUsd: 0.10 }),
      makeSession({ totalCostUsd: 0.15 }),
    ];
    const store = makeMockStore(sessions);
    const variant = makeVariant();

    const result = await aggregator.aggregate(store, variant, ['avg_cost']);

    expect(result.sessionCount).toBe(3);
    expect(result.metrics.avg_cost.mean).toBeCloseTo(0.1);
    expect(result.metrics.avg_cost.count).toBe(3);
  });

  it('handles empty sessions', async () => {
    const store = makeMockStore([]);
    const variant = makeVariant();

    const result = await aggregator.aggregate(store, variant, ['avg_cost', 'error_rate']);

    expect(result.sessionCount).toBe(0);
    expect(result.metrics.avg_cost.count).toBe(0);
    expect(result.metrics.avg_cost.mean).toBe(0);
  });

  it('passes correct query parameters to store', async () => {
    const store = makeMockStore([]);
    const variant = makeVariant({ agentId: 'agent-x', tag: 'v1' });
    const timeRange = { from: '2026-01-01T00:00:00Z', to: '2026-01-31T23:59:59Z' };

    await aggregator.aggregate(store, variant, ['avg_cost'], timeRange);

    expect(store.querySessions).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      agentId: 'agent-x',
      tags: ['v1'],
      from: timeRange.from,
      to: timeRange.to,
      limit: 10000,
    });
  });
});
