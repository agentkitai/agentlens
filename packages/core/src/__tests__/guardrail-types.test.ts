/**
 * Tests for Guardrail Types & Schemas (v0.8.0 — Story 1.1)
 */

import { describe, it, expect } from 'vitest';
import {
  CreateGuardrailRuleSchema,
  UpdateGuardrailRuleSchema,
  GuardrailRuleSchema,
  GuardrailConditionTypeSchema,
  GuardrailActionTypeSchema,
} from '../schemas.js';
import type {
  GuardrailRule,
  GuardrailState,
  GuardrailTriggerHistory,
  GuardrailConditionType,
  GuardrailActionType,
  GuardrailConditionResult,
} from '../types.js';

describe('Guardrail Types (Story 1.1)', () => {
  it('should have all condition types', () => {
    const types: GuardrailConditionType[] = [
      'error_rate_threshold',
      'cost_limit',
      'health_score_threshold',
      'custom_metric',
    ];
    for (const t of types) {
      expect(GuardrailConditionTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it('should have all action types', () => {
    const types: GuardrailActionType[] = [
      'pause_agent',
      'notify_webhook',
      'downgrade_model',
      'agentgate_policy',
    ];
    for (const t of types) {
      expect(GuardrailActionTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it('should reject invalid condition type', () => {
    expect(GuardrailConditionTypeSchema.safeParse('invalid').success).toBe(false);
  });

  it('should reject invalid action type', () => {
    expect(GuardrailActionTypeSchema.safeParse('invalid').success).toBe(false);
  });

  it('should define GuardrailRule interface correctly', () => {
    const rule: GuardrailRule = {
      id: 'gr_123',
      tenantId: 'default',
      name: 'Test Rule',
      enabled: true,
      conditionType: 'error_rate_threshold',
      conditionConfig: { threshold: 30, windowMinutes: 5 },
      actionType: 'pause_agent',
      actionConfig: { message: 'Too many errors' },
      cooldownMinutes: 15,
      dryRun: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    expect(rule.id).toBe('gr_123');
    expect(rule.conditionType).toBe('error_rate_threshold');
  });

  it('should define GuardrailState interface correctly', () => {
    const state: GuardrailState = {
      ruleId: 'gr_123',
      tenantId: 'default',
      triggerCount: 5,
      lastTriggeredAt: '2026-01-01T00:00:00Z',
    };
    expect(state.triggerCount).toBe(5);
  });

  it('should define GuardrailTriggerHistory interface correctly', () => {
    const trigger: GuardrailTriggerHistory = {
      id: 'gt_123',
      ruleId: 'gr_123',
      tenantId: 'default',
      triggeredAt: '2026-01-01T00:00:00Z',
      conditionValue: 45,
      conditionThreshold: 30,
      actionExecuted: true,
      actionResult: 'success',
      metadata: {},
    };
    expect(trigger.actionExecuted).toBe(true);
  });

  it('should define GuardrailConditionResult interface correctly', () => {
    const result: GuardrailConditionResult = {
      triggered: true,
      currentValue: 45,
      threshold: 30,
      message: 'Error rate 45% exceeds threshold 30%',
    };
    expect(result.triggered).toBe(true);
  });
});

describe('CreateGuardrailRuleSchema', () => {
  const validRule = {
    name: 'Error Rate Guard',
    conditionType: 'error_rate_threshold',
    conditionConfig: { threshold: 30, windowMinutes: 5 },
    actionType: 'pause_agent',
    actionConfig: { message: 'Pausing due to errors' },
  };

  it('should validate a minimal valid rule', () => {
    const result = CreateGuardrailRuleSchema.safeParse(validRule);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true); // default
      expect(result.data.cooldownMinutes).toBe(15); // default
      expect(result.data.dryRun).toBe(true); // default (PRD FR-G1.5: dry-run by default)
    }
  });

  it('should validate a full rule with all fields', () => {
    const result = CreateGuardrailRuleSchema.safeParse({
      ...validRule,
      description: 'Monitors error rate',
      enabled: false,
      agentId: 'agent-1',
      cooldownMinutes: 30,
      dryRun: true,
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty name', () => {
    const result = CreateGuardrailRuleSchema.safeParse({ ...validRule, name: '' });
    expect(result.success).toBe(false);
  });

  it('should reject invalid condition type', () => {
    const result = CreateGuardrailRuleSchema.safeParse({ ...validRule, conditionType: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('should reject invalid action type', () => {
    const result = CreateGuardrailRuleSchema.safeParse({ ...validRule, actionType: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('should reject cooldown > 1440', () => {
    const result = CreateGuardrailRuleSchema.safeParse({ ...validRule, cooldownMinutes: 2000 });
    expect(result.success).toBe(false);
  });

  it('should reject negative cooldown', () => {
    const result = CreateGuardrailRuleSchema.safeParse({ ...validRule, cooldownMinutes: -1 });
    expect(result.success).toBe(false);
  });
});

describe('UpdateGuardrailRuleSchema', () => {
  it('should validate partial updates', () => {
    const result = UpdateGuardrailRuleSchema.safeParse({ name: 'New Name' });
    expect(result.success).toBe(true);
  });

  it('should validate empty update (no fields)', () => {
    const result = UpdateGuardrailRuleSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should validate null agentId (clearing scope)', () => {
    const result = UpdateGuardrailRuleSchema.safeParse({ agentId: null });
    expect(result.success).toBe(true);
  });
});

describe('GuardrailRuleSchema', () => {
  it('should validate a complete rule', () => {
    const result = GuardrailRuleSchema.safeParse({
      id: 'gr_123',
      tenantId: 'default',
      name: 'Test Rule',
      enabled: true,
      conditionType: 'cost_limit',
      conditionConfig: { maxCostUsd: 5, scope: 'session' },
      actionType: 'notify_webhook',
      actionConfig: { url: 'https://example.com/hook' },
      cooldownMinutes: 15,
      dryRun: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });
});
