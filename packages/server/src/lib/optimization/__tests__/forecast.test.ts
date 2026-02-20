/**
 * Tests for CostForecaster (Feature 17 — Story 17.5)
 */

import { describe, it, expect } from 'vitest';
import { linearRegression, CostForecaster } from '../forecast.js';
import type { IEventStore, EventQueryResult } from '@agentlensai/core';

describe('linearRegression', () => {
  it('computes correct slope and intercept for known series', () => {
    // y = 2x + 1 => points (0,1), (1,3), (2,5), (3,7)
    const { slope, intercept } = linearRegression([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
      { x: 3, y: 7 },
    ]);
    expect(slope).toBeCloseTo(2, 5);
    expect(intercept).toBeCloseTo(1, 5);
  });

  it('handles constant series (slope=0)', () => {
    const { slope, intercept } = linearRegression([
      { x: 0, y: 5 },
      { x: 1, y: 5 },
      { x: 2, y: 5 },
    ]);
    expect(slope).toBeCloseTo(0, 5);
    expect(intercept).toBeCloseTo(5, 5);
  });

  it('handles empty input', () => {
    const { slope, intercept } = linearRegression([]);
    expect(slope).toBe(0);
    expect(intercept).toBe(0);
  });
});

describe('CostForecaster', () => {
  it('produces correct number of forecast buckets', async () => {
    // Mock store that returns sessions + llm_response events with costs
    const mockStore: IEventStore = {
      querySessions: async () => ({
        sessions: [],
        total: 0,
        hasMore: false,
      }),
      queryEvents: async () => ({
        events: [],
        total: 0,
        hasMore: false,
      } as EventQueryResult),
    } as unknown as IEventStore;

    const forecaster = new CostForecaster();
    const result = await forecaster.forecast({
      days: 7,
      store: mockStore,
    });

    expect(result.days).toBe(7);
    expect(result.daily).toHaveLength(7);
    expect(result.withOptimizations).toBeDefined();
    expect(result.withoutOptimizations).toBeDefined();
  });

  it('projects non-negative costs', async () => {
    const mockStore: IEventStore = {
      querySessions: async () => ({ sessions: [], total: 0, hasMore: false }),
      queryEvents: async () => ({ events: [], total: 0, hasMore: false } as EventQueryResult),
    } as unknown as IEventStore;

    const forecaster = new CostForecaster();
    const result = await forecaster.forecast({ days: 30, store: mockStore });

    for (const bucket of result.daily) {
      expect(bucket.projectedCost).toBeGreaterThanOrEqual(0);
      expect(bucket.projectedCostOptimized).toBeGreaterThanOrEqual(0);
    }
  });

  it('computes budget burn rate when budget store provided', async () => {
    const mockStore: IEventStore = {
      querySessions: async () => ({ sessions: [], total: 0, hasMore: false }),
      queryEvents: async () => ({ events: [], total: 0, hasMore: false } as EventQueryResult),
    } as unknown as IEventStore;

    const mockBudgetStore = {
      listBudgets: () => [{ id: 'b1', limitUsd: 100, currentSpend: 50 }],
    };

    const forecaster = new CostForecaster();
    const result = await forecaster.forecast({
      days: 30,
      store: mockStore,
      budgetStore: mockBudgetStore,
      tenantId: 'test',
    });

    // With no cost data, burn rate should be null (0 daily burn)
    expect(result.budgetBurnRate).toBeDefined();
    expect(result.budgetBurnRate!.budgetId).toBe('b1');
    expect(result.budgetBurnRate!.limitUsd).toBe(100);
    expect(result.budgetBurnRate!.daysUntilExhaustion).toBeNull();
  });
});
