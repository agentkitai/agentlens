/**
 * Tests for Cost Budget Schemas (Feature 5 — Story 1)
 */

import { describe, it, expect } from 'vitest';
import {
  createCostBudgetSchema,
  updateCostBudgetSchema,
  updateAnomalyConfigSchema,
} from '../cost-budget-schemas.js';

describe('createCostBudgetSchema', () => {
  it('should accept valid session budget', () => {
    const result = createCostBudgetSchema.safeParse({
      scope: 'session',
      period: 'session',
      limitUsd: 5.0,
    });
    expect(result.success).toBe(true);
  });

  it('should accept valid agent daily budget', () => {
    const result = createCostBudgetSchema.safeParse({
      scope: 'agent',
      agentId: 'agent-1',
      period: 'daily',
      limitUsd: 100,
      onBreach: 'pause_agent',
    });
    expect(result.success).toBe(true);
  });

  it('should reject agent scope without agentId', () => {
    const result = createCostBudgetSchema.safeParse({
      scope: 'agent',
      period: 'daily',
      limitUsd: 100,
    });
    expect(result.success).toBe(false);
  });

  it('should reject session scope with non-session period', () => {
    const result = createCostBudgetSchema.safeParse({
      scope: 'session',
      period: 'daily',
      limitUsd: 5.0,
    });
    expect(result.success).toBe(false);
  });

  it('should reject downgrade_model without target model', () => {
    const result = createCostBudgetSchema.safeParse({
      scope: 'agent',
      agentId: 'agent-1',
      period: 'daily',
      limitUsd: 100,
      onBreach: 'downgrade_model',
    });
    expect(result.success).toBe(false);
  });

  it('should accept downgrade_model with target model', () => {
    const result = createCostBudgetSchema.safeParse({
      scope: 'agent',
      agentId: 'agent-1',
      period: 'daily',
      limitUsd: 100,
      onBreach: 'downgrade_model',
      downgradeTargetModel: 'gpt-3.5-turbo',
    });
    expect(result.success).toBe(true);
  });

  it('should reject negative limitUsd', () => {
    const result = createCostBudgetSchema.safeParse({
      scope: 'session',
      period: 'session',
      limitUsd: -1,
    });
    expect(result.success).toBe(false);
  });

  it('should reject zero limitUsd', () => {
    const result = createCostBudgetSchema.safeParse({
      scope: 'session',
      period: 'session',
      limitUsd: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should default onBreach to alert', () => {
    const result = createCostBudgetSchema.safeParse({
      scope: 'session',
      period: 'session',
      limitUsd: 5,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.onBreach).toBe('alert');
    }
  });

  it('should default enabled to true', () => {
    const result = createCostBudgetSchema.safeParse({
      scope: 'session',
      period: 'session',
      limitUsd: 5,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
    }
  });
});

describe('updateCostBudgetSchema', () => {
  it('should accept partial updates', () => {
    const result = updateCostBudgetSchema.safeParse({ limitUsd: 10 });
    expect(result.success).toBe(true);
  });

  it('should accept empty object', () => {
    const result = updateCostBudgetSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe('updateAnomalyConfigSchema', () => {
  it('should accept valid config', () => {
    const result = updateAnomalyConfigSchema.safeParse({
      multiplier: 5.0,
      minSessions: 10,
      enabled: false,
    });
    expect(result.success).toBe(true);
  });

  it('should reject multiplier below 1.5', () => {
    const result = updateAnomalyConfigSchema.safeParse({ multiplier: 1.0 });
    expect(result.success).toBe(false);
  });

  it('should reject multiplier above 20', () => {
    const result = updateAnomalyConfigSchema.safeParse({ multiplier: 25 });
    expect(result.success).toBe(false);
  });

  it('should reject minSessions below 1', () => {
    const result = updateAnomalyConfigSchema.safeParse({ minSessions: 0 });
    expect(result.success).toBe(false);
  });

  it('should reject minSessions above 100', () => {
    const result = updateAnomalyConfigSchema.safeParse({ minSessions: 101 });
    expect(result.success).toBe(false);
  });
});
