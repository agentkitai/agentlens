import { describe, it, expect } from 'vitest';
import {
  HealthScoreSchema,
  HealthWeightsSchema,
  HealthSnapshotSchema,
  HealthDimensionSchema,
} from '../schemas.js';
import { DEFAULT_HEALTH_WEIGHTS } from '../constants.js';
import type { HealthScore, HealthDimension, HealthWeights } from '../types.js';

describe('HealthDimensionSchema', () => {
  it('accepts a valid dimension', () => {
    const dim: HealthDimension = {
      name: 'error_rate',
      score: 85,
      weight: 0.3,
      rawValue: 0.02,
      description: 'Low error rate',
    };
    expect(HealthDimensionSchema.parse(dim)).toEqual(dim);
  });

  it('rejects score > 100', () => {
    expect(() =>
      HealthDimensionSchema.parse({
        name: 'latency',
        score: 150,
        weight: 0.15,
        rawValue: 200,
        description: 'Too high',
      }),
    ).toThrow();
  });

  it('rejects invalid dimension name', () => {
    expect(() =>
      HealthDimensionSchema.parse({
        name: 'invalid_dim',
        score: 50,
        weight: 0.2,
        rawValue: 1,
        description: 'Bad name',
      }),
    ).toThrow();
  });
});

describe('HealthScoreSchema', () => {
  const validHealthScore: HealthScore = {
    agentId: 'agent-1',
    overallScore: 78,
    trend: 'improving',
    trendDelta: 3.5,
    dimensions: [
      { name: 'error_rate', score: 90, weight: 0.3, rawValue: 0.01, description: 'Very low errors' },
      { name: 'cost_efficiency', score: 70, weight: 0.2, rawValue: 0.05, description: 'Good cost' },
      { name: 'tool_success', score: 85, weight: 0.2, rawValue: 0.95, description: 'High tool success' },
      { name: 'latency', score: 60, weight: 0.15, rawValue: 350, description: 'Moderate latency' },
      { name: 'completion_rate', score: 75, weight: 0.15, rawValue: 0.88, description: 'Good completions' },
    ],
    window: { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' },
    sessionCount: 42,
    computedAt: '2026-02-08T17:00:00Z',
  };

  it('accepts a valid health score', () => {
    expect(HealthScoreSchema.parse(validHealthScore)).toEqual(validHealthScore);
  });

  it('rejects overallScore below 0', () => {
    expect(() =>
      HealthScoreSchema.parse({ ...validHealthScore, overallScore: -5 }),
    ).toThrow();
  });

  it('rejects empty agentId', () => {
    expect(() =>
      HealthScoreSchema.parse({ ...validHealthScore, agentId: '' }),
    ).toThrow();
  });

  it('rejects invalid trend value', () => {
    expect(() =>
      HealthScoreSchema.parse({ ...validHealthScore, trend: 'skyrocketing' }),
    ).toThrow();
  });
});

describe('HealthWeightsSchema', () => {
  it('accepts DEFAULT_HEALTH_WEIGHTS', () => {
    expect(HealthWeightsSchema.parse(DEFAULT_HEALTH_WEIGHTS)).toEqual(DEFAULT_HEALTH_WEIGHTS);
  });

  it('accepts weights summing to exactly 1.0', () => {
    const weights: HealthWeights = {
      errorRate: 0.20,
      costEfficiency: 0.20,
      toolSuccess: 0.20,
      latency: 0.20,
      completionRate: 0.20,
    };
    expect(HealthWeightsSchema.parse(weights)).toEqual(weights);
  });

  it('rejects weights summing to 0.5', () => {
    expect(() =>
      HealthWeightsSchema.parse({
        errorRate: 0.1,
        costEfficiency: 0.1,
        toolSuccess: 0.1,
        latency: 0.1,
        completionRate: 0.1,
      }),
    ).toThrow(/approximately 1\.0/);
  });

  it('rejects weights summing to 1.5', () => {
    expect(() =>
      HealthWeightsSchema.parse({
        errorRate: 0.3,
        costEfficiency: 0.3,
        toolSuccess: 0.3,
        latency: 0.3,
        completionRate: 0.3,
      }),
    ).toThrow(/approximately 1\.0/);
  });
});

describe('DEFAULT_HEALTH_WEIGHTS', () => {
  it('sums to 1.0', () => {
    const sum =
      DEFAULT_HEALTH_WEIGHTS.errorRate +
      DEFAULT_HEALTH_WEIGHTS.costEfficiency +
      DEFAULT_HEALTH_WEIGHTS.toolSuccess +
      DEFAULT_HEALTH_WEIGHTS.latency +
      DEFAULT_HEALTH_WEIGHTS.completionRate;
    expect(sum).toBeCloseTo(1.0, 10);
  });
});

describe('HealthSnapshotSchema', () => {
  it('accepts a valid snapshot', () => {
    const snapshot = {
      agentId: 'agent-1',
      date: '2026-02-08',
      overallScore: 82,
      errorRateScore: 90,
      costEfficiencyScore: 75,
      toolSuccessScore: 85,
      latencyScore: 70,
      completionRateScore: 80,
      sessionCount: 10,
    };
    expect(HealthSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });
});
