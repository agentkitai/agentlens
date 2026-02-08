/**
 * Tests for Guardrail Condition & Action Config Schemas (B1 — Story 1.1)
 */

import { describe, it, expect } from 'vitest';
import {
  ErrorRateConditionConfigSchema,
  CostLimitConditionConfigSchema,
  HealthScoreConditionConfigSchema,
  CustomMetricConditionConfigSchema,
  PauseAgentActionConfigSchema,
  WebhookActionConfigSchema,
  DowngradeModelActionConfigSchema,
  AgentGatePolicyActionConfigSchema,
  conditionConfigSchemas,
  actionConfigSchemas,
} from '../guardrail-config-schemas.js';
import type {
  ErrorRateConditionConfig,
  CostLimitConditionConfig,
  HealthScoreConditionConfig,
  CustomMetricConditionConfig,
  PauseAgentActionConfig,
  WebhookActionConfig,
  DowngradeModelActionConfig,
  AgentGatePolicyActionConfig,
  GuardrailConditionConfig,
  GuardrailActionConfig,
} from '../guardrail-config-schemas.js';

// ─── Condition Config Schemas ──────────────────────────────────────

describe('ErrorRateConditionConfigSchema', () => {
  it('should validate a valid config', () => {
    const result = ErrorRateConditionConfigSchema.safeParse({ threshold: 50, windowMinutes: 10 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.threshold).toBe(50);
      expect(result.data.windowMinutes).toBe(10);
    }
  });

  it('should apply default windowMinutes', () => {
    const result = ErrorRateConditionConfigSchema.safeParse({ threshold: 30 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.windowMinutes).toBe(5);
    }
  });

  it('should reject threshold > 100', () => {
    const result = ErrorRateConditionConfigSchema.safeParse({ threshold: 101 });
    expect(result.success).toBe(false);
  });

  it('should reject threshold < 0', () => {
    const result = ErrorRateConditionConfigSchema.safeParse({ threshold: -1 });
    expect(result.success).toBe(false);
  });

  it('should reject windowMinutes > 1440', () => {
    const result = ErrorRateConditionConfigSchema.safeParse({ threshold: 30, windowMinutes: 1441 });
    expect(result.success).toBe(false);
  });

  it('should reject windowMinutes < 1', () => {
    const result = ErrorRateConditionConfigSchema.safeParse({ threshold: 30, windowMinutes: 0 });
    expect(result.success).toBe(false);
  });
});

describe('CostLimitConditionConfigSchema', () => {
  it('should validate a valid config', () => {
    const result = CostLimitConditionConfigSchema.safeParse({ maxCostUsd: 10.50, scope: 'daily' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxCostUsd).toBe(10.50);
      expect(result.data.scope).toBe('daily');
    }
  });

  it('should reject non-positive maxCostUsd', () => {
    const result = CostLimitConditionConfigSchema.safeParse({ maxCostUsd: 0, scope: 'session' });
    expect(result.success).toBe(false);
  });

  it('should reject negative maxCostUsd', () => {
    const result = CostLimitConditionConfigSchema.safeParse({ maxCostUsd: -5, scope: 'session' });
    expect(result.success).toBe(false);
  });

  it('should reject invalid scope', () => {
    const result = CostLimitConditionConfigSchema.safeParse({ maxCostUsd: 5, scope: 'weekly' });
    expect(result.success).toBe(false);
  });

  it('should require scope field', () => {
    const result = CostLimitConditionConfigSchema.safeParse({ maxCostUsd: 5 });
    expect(result.success).toBe(false);
  });
});

describe('HealthScoreConditionConfigSchema', () => {
  it('should validate a valid config', () => {
    const result = HealthScoreConditionConfigSchema.safeParse({ minScore: 60, windowDays: 14 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minScore).toBe(60);
      expect(result.data.windowDays).toBe(14);
    }
  });

  it('should apply default windowDays', () => {
    const result = HealthScoreConditionConfigSchema.safeParse({ minScore: 70 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.windowDays).toBe(7);
    }
  });

  it('should reject minScore > 100', () => {
    const result = HealthScoreConditionConfigSchema.safeParse({ minScore: 101 });
    expect(result.success).toBe(false);
  });

  it('should reject windowDays > 90', () => {
    const result = HealthScoreConditionConfigSchema.safeParse({ minScore: 50, windowDays: 91 });
    expect(result.success).toBe(false);
  });
});

describe('CustomMetricConditionConfigSchema', () => {
  it('should validate a valid config', () => {
    const result = CustomMetricConditionConfigSchema.safeParse({
      metricKeyPath: 'payload.latencyMs',
      operator: 'gt',
      value: 5000,
      windowMinutes: 15,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metricKeyPath).toBe('payload.latencyMs');
      expect(result.data.operator).toBe('gt');
      expect(result.data.value).toBe(5000);
    }
  });

  it('should apply default windowMinutes', () => {
    const result = CustomMetricConditionConfigSchema.safeParse({
      metricKeyPath: 'payload.score',
      operator: 'lte',
      value: 50,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.windowMinutes).toBe(5);
    }
  });

  it('should reject invalid operator', () => {
    const result = CustomMetricConditionConfigSchema.safeParse({
      metricKeyPath: 'payload.x',
      operator: 'neq',
      value: 10,
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty metricKeyPath', () => {
    const result = CustomMetricConditionConfigSchema.safeParse({
      metricKeyPath: '',
      operator: 'gt',
      value: 10,
    });
    expect(result.success).toBe(false);
  });

  it('should accept all valid operators', () => {
    for (const op of ['gt', 'gte', 'lt', 'lte', 'eq']) {
      const result = CustomMetricConditionConfigSchema.safeParse({
        metricKeyPath: 'x',
        operator: op,
        value: 0,
      });
      expect(result.success).toBe(true);
    }
  });
});

// ─── Action Config Schemas ──────────────────────────────────────────

describe('PauseAgentActionConfigSchema', () => {
  it('should validate with a message', () => {
    const result = PauseAgentActionConfigSchema.safeParse({ message: 'Too many errors' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBe('Too many errors');
    }
  });

  it('should validate without a message (empty object)', () => {
    const result = PauseAgentActionConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe('WebhookActionConfigSchema', () => {
  it('should validate a valid config with all fields', () => {
    const result = WebhookActionConfigSchema.safeParse({
      url: 'https://hooks.example.com/guardrail',
      headers: { Authorization: 'Bearer token123' },
      secret: 'hmac-secret',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe('https://hooks.example.com/guardrail');
      expect(result.data.headers?.Authorization).toBe('Bearer token123');
      expect(result.data.secret).toBe('hmac-secret');
    }
  });

  it('should validate with only url', () => {
    const result = WebhookActionConfigSchema.safeParse({ url: 'https://example.com' });
    expect(result.success).toBe(true);
  });

  it('should reject invalid url', () => {
    const result = WebhookActionConfigSchema.safeParse({ url: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('should reject missing url', () => {
    const result = WebhookActionConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('DowngradeModelActionConfigSchema', () => {
  it('should validate a valid config', () => {
    const result = DowngradeModelActionConfigSchema.safeParse({
      targetModel: 'gpt-4o-mini',
      message: 'Downgrading due to cost',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetModel).toBe('gpt-4o-mini');
      expect(result.data.message).toBe('Downgrading due to cost');
    }
  });

  it('should validate with only targetModel', () => {
    const result = DowngradeModelActionConfigSchema.safeParse({ targetModel: 'claude-3-haiku' });
    expect(result.success).toBe(true);
  });

  it('should reject empty targetModel', () => {
    const result = DowngradeModelActionConfigSchema.safeParse({ targetModel: '' });
    expect(result.success).toBe(false);
  });

  it('should reject missing targetModel', () => {
    const result = DowngradeModelActionConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('AgentGatePolicyActionConfigSchema', () => {
  it('should validate a valid config with all fields', () => {
    const result = AgentGatePolicyActionConfigSchema.safeParse({
      agentgateUrl: 'https://gate.example.com',
      policyId: 'pol_abc123',
      action: 'tighten',
      params: { maxConcurrency: 1 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentgateUrl).toBe('https://gate.example.com');
      expect(result.data.policyId).toBe('pol_abc123');
      expect(result.data.action).toBe('tighten');
    }
  });

  it('should validate without optional params', () => {
    const result = AgentGatePolicyActionConfigSchema.safeParse({
      agentgateUrl: 'https://gate.example.com',
      policyId: 'pol_1',
      action: 'disable',
    });
    expect(result.success).toBe(true);
  });

  it('should accept all valid actions', () => {
    for (const action of ['tighten', 'loosen', 'disable']) {
      const result = AgentGatePolicyActionConfigSchema.safeParse({
        agentgateUrl: 'https://gate.example.com',
        policyId: 'pol_1',
        action,
      });
      expect(result.success).toBe(true);
    }
  });

  it('should reject invalid action', () => {
    const result = AgentGatePolicyActionConfigSchema.safeParse({
      agentgateUrl: 'https://gate.example.com',
      policyId: 'pol_1',
      action: 'nuke',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid url', () => {
    const result = AgentGatePolicyActionConfigSchema.safeParse({
      agentgateUrl: 'not-a-url',
      policyId: 'pol_1',
      action: 'tighten',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty policyId', () => {
    const result = AgentGatePolicyActionConfigSchema.safeParse({
      agentgateUrl: 'https://gate.example.com',
      policyId: '',
      action: 'tighten',
    });
    expect(result.success).toBe(false);
  });
});

// ─── Schema Maps ────────────────────────────────────────────────────

describe('conditionConfigSchemas map', () => {
  it('should have all 4 condition types', () => {
    expect(Object.keys(conditionConfigSchemas)).toEqual([
      'error_rate_threshold',
      'cost_limit',
      'health_score_threshold',
      'custom_metric',
    ]);
  });
});

describe('actionConfigSchemas map', () => {
  it('should have all 4 action types', () => {
    expect(Object.keys(actionConfigSchemas)).toEqual([
      'pause_agent',
      'notify_webhook',
      'downgrade_model',
      'agentgate_policy',
    ]);
  });
});

// ─── Type-level tests (compile-time checks) ────────────────────────

describe('Union types', () => {
  it('should compile GuardrailConditionConfig union', () => {
    // Just verifying the type exists and can be assigned
    const configs: GuardrailConditionConfig[] = [
      { threshold: 50, windowMinutes: 5 },
      { maxCostUsd: 10, scope: 'daily' },
      { minScore: 70, windowDays: 7 },
      { metricKeyPath: 'x', operator: 'gt', value: 10, windowMinutes: 5 },
    ];
    expect(configs).toHaveLength(4);
  });

  it('should compile GuardrailActionConfig union', () => {
    const configs: GuardrailActionConfig[] = [
      { message: 'paused' },
      { url: 'https://example.com' },
      { targetModel: 'gpt-4o-mini' },
      { agentgateUrl: 'https://gate.example.com', policyId: 'p1', action: 'tighten' },
    ];
    expect(configs).toHaveLength(4);
  });
});
