import { describe, it, expect } from 'vitest';
import {
  CostRecommendationSchema,
  OptimizationResultSchema,
  ComplexityTierSchema,
  ConfidenceLevelSchema,
} from '../schemas.js';
import { DEFAULT_MODEL_COSTS } from '../constants.js';
import type { CostRecommendation, OptimizationResult } from '../types.js';

const validRecommendation: CostRecommendation = {
  currentModel: 'gpt-4o',
  recommendedModel: 'gpt-4o-mini',
  complexityTier: 'simple',
  currentCostPerCall: 0.03,
  recommendedCostPerCall: 0.002,
  monthlySavings: 140,
  callVolume: 5000,
  currentSuccessRate: 0.98,
  recommendedSuccessRate: 0.95,
  confidence: 'high',
  agentId: 'agent-1',
};

describe('CostRecommendationSchema', () => {
  it('accepts a valid recommendation', () => {
    expect(CostRecommendationSchema.parse(validRecommendation)).toEqual(validRecommendation);
  });

  it('rejects empty currentModel', () => {
    expect(() =>
      CostRecommendationSchema.parse({ ...validRecommendation, currentModel: '' }),
    ).toThrow();
  });

  it('rejects negative currentCostPerCall', () => {
    expect(() =>
      CostRecommendationSchema.parse({ ...validRecommendation, currentCostPerCall: -1 }),
    ).toThrow();
  });

  it('rejects successRate > 1', () => {
    expect(() =>
      CostRecommendationSchema.parse({ ...validRecommendation, currentSuccessRate: 1.5 }),
    ).toThrow();
  });

  it('rejects invalid complexityTier', () => {
    expect(() =>
      ComplexityTierSchema.parse('extreme'),
    ).toThrow();
  });

  it('rejects invalid confidence level', () => {
    expect(() =>
      ConfidenceLevelSchema.parse('ultra'),
    ).toThrow();
  });
});

describe('OptimizationResultSchema', () => {
  const validResult: OptimizationResult = {
    recommendations: [validRecommendation],
    totalPotentialSavings: 140,
    period: 30,
    analyzedCalls: 5000,
  };

  it('accepts a valid optimization result', () => {
    expect(OptimizationResultSchema.parse(validResult)).toEqual(validResult);
  });

  it('accepts empty recommendations array', () => {
    const empty = { ...validResult, recommendations: [], totalPotentialSavings: 0 };
    expect(OptimizationResultSchema.parse(empty)).toEqual(empty);
  });

  it('rejects negative totalPotentialSavings', () => {
    expect(() =>
      OptimizationResultSchema.parse({ ...validResult, totalPotentialSavings: -100 }),
    ).toThrow();
  });

  it('rejects period of 0', () => {
    expect(() =>
      OptimizationResultSchema.parse({ ...validResult, period: 0 }),
    ).toThrow();
  });
});

describe('DEFAULT_MODEL_COSTS', () => {
  it('contains expected models', () => {
    expect(Object.keys(DEFAULT_MODEL_COSTS)).toEqual(
      expect.arrayContaining([
        'gpt-4o',
        'gpt-4o-mini',
        'claude-opus-4',
        'claude-sonnet-4',
        'claude-haiku-3.5',
      ]),
    );
  });

  it('all costs are positive numbers', () => {
    for (const [model, costs] of Object.entries(DEFAULT_MODEL_COSTS)) {
      expect(costs.input).toBeGreaterThan(0);
      expect(costs.output).toBeGreaterThan(0);
    }
  });

  it('output cost >= input cost for all models', () => {
    for (const [, costs] of Object.entries(DEFAULT_MODEL_COSTS)) {
      expect(costs.output).toBeGreaterThanOrEqual(costs.input);
    }
  });
});
