/**
 * Tests for Guardrail Condition Evaluators (v0.8.0 — Story 1.4)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeEventHash } from '@agentlensai/core';
import type { AgentLensEvent, GuardrailRule } from '@agentlensai/core';
import { createTestDb, type SqliteDb } from '../../../db/index.js';
import { runMigrations } from '../../../db/migrate.js';
import { SqliteEventStore } from '../../../db/sqlite-store.js';
import { TenantScopedStore } from '../../../db/tenant-scoped-store.js';
import {
  evaluateErrorRateThreshold,
  evaluateCostLimit,
  evaluateCustomMetric,
  evaluateCondition,
} from '../conditions.js';

const tenantId = 'test-tenant';
let eventCounter = 0;

function makeRule(overrides: Partial<GuardrailRule> = {}): GuardrailRule {
  return {
    id: 'rule_1', tenantId, name: 'Test Rule', enabled: true,
    conditionType: 'error_rate_threshold', conditionConfig: { threshold: 30, windowMinutes: 60 },
    actionType: 'pause_agent', actionConfig: {}, cooldownMinutes: 15, dryRun: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<AgentLensEvent> = {}): AgentLensEvent {
  eventCounter++;
  const id = `evt_${eventCounter}_${Date.now()}`;
  const base = {
    id,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    sessionId: overrides.sessionId ?? `ses_${id}`, // unique session per event
    agentId: overrides.agentId ?? 'agent_1',
    eventType: overrides.eventType ?? ('custom' as const),
    severity: overrides.severity ?? ('info' as const),
    payload: overrides.payload ?? { type: 'test', data: {} },
    metadata: overrides.metadata ?? {},
    prevHash: null,
  };
  const hash = computeEventHash(base);
  return { ...base, hash, tenantId } as AgentLensEvent;
}

describe('Guardrail Conditions', () => {
  let db: SqliteDb;
  let store: TenantScopedStore;

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    const rawStore = new SqliteEventStore(db);
    store = new TenantScopedStore(rawStore, tenantId);
    eventCounter = 0;
  });

  afterEach(() => {
    // @ts-expect-error accessing internal for cleanup
    db.$client?.close?.();
  });

  describe('evaluateErrorRateThreshold', () => {
    it('should not trigger when no events exist', async () => {
      const rule = makeRule({ conditionConfig: { threshold: 30, windowMinutes: 60 } });
      const result = await evaluateErrorRateThreshold(store, rule, 'agent_1');
      expect(result.triggered).toBe(false);
      expect(result.currentValue).toBe(0);
    });

    it('should not trigger when error rate is below threshold', async () => {
      for (let i = 0; i < 10; i++) {
        await store.insertEvents([makeEvent({ severity: i === 0 ? 'error' : 'info', agentId: 'agent_1' })]);
      }
      const rule = makeRule({ conditionConfig: { threshold: 30, windowMinutes: 60 } });
      const result = await evaluateErrorRateThreshold(store, rule, 'agent_1');
      expect(result.triggered).toBe(false);
      expect(result.currentValue).toBe(10);
    });

    it('should trigger when error rate exceeds threshold', async () => {
      for (let i = 0; i < 10; i++) {
        await store.insertEvents([makeEvent({ severity: i < 5 ? 'error' : 'info', agentId: 'agent_1' })]);
      }
      const rule = makeRule({ conditionConfig: { threshold: 30, windowMinutes: 60 } });
      const result = await evaluateErrorRateThreshold(store, rule, 'agent_1');
      expect(result.triggered).toBe(true);
      expect(result.currentValue).toBe(50);
    });

    it('should include a descriptive message', async () => {
      for (let i = 0; i < 4; i++) {
        await store.insertEvents([makeEvent({ severity: 'error', agentId: 'agent_1' })]);
      }
      const rule = makeRule({ conditionConfig: { threshold: 30, windowMinutes: 60 } });
      const result = await evaluateErrorRateThreshold(store, rule, 'agent_1');
      expect(result.message).toContain('100.0%');
      expect(result.message).toContain('exceeds');
    });
  });

  describe('evaluateCostLimit', () => {
    it('should not trigger when session cost is within limit', async () => {
      await store.upsertSession({
        id: 'ses_1', agentId: 'agent_1', startedAt: new Date().toISOString(),
        status: 'active', eventCount: 0, toolCallCount: 0, errorCount: 0,
        totalCostUsd: 2.5, llmCallCount: 0, totalInputTokens: 0, totalOutputTokens: 0, tags: [],
      });
      const rule = makeRule({ conditionType: 'cost_limit', conditionConfig: { maxCostUsd: 5, scope: 'session' } });
      const result = await evaluateCostLimit(store, rule, 'agent_1', 'ses_1');
      expect(result.triggered).toBe(false);
    });

    it('should trigger when session cost exceeds limit', async () => {
      await store.upsertSession({
        id: 'ses_1', agentId: 'agent_1', startedAt: new Date().toISOString(),
        status: 'active', eventCount: 0, toolCallCount: 0, errorCount: 0,
        totalCostUsd: 7.5, llmCallCount: 0, totalInputTokens: 0, totalOutputTokens: 0, tags: [],
      });
      const rule = makeRule({ conditionType: 'cost_limit', conditionConfig: { maxCostUsd: 5, scope: 'session' } });
      const result = await evaluateCostLimit(store, rule, 'agent_1', 'ses_1');
      expect(result.triggered).toBe(true);
      expect(result.currentValue).toBe(7.5);
    });

    it('should evaluate daily cost across sessions', async () => {
      await store.upsertSession({
        id: 'ses_1', agentId: 'agent_1', startedAt: new Date().toISOString(),
        status: 'completed', eventCount: 0, toolCallCount: 0, errorCount: 0,
        totalCostUsd: 3.0, llmCallCount: 0, totalInputTokens: 0, totalOutputTokens: 0, tags: [],
      });
      await store.upsertSession({
        id: 'ses_2', agentId: 'agent_1', startedAt: new Date().toISOString(),
        status: 'active', eventCount: 0, toolCallCount: 0, errorCount: 0,
        totalCostUsd: 4.0, llmCallCount: 0, totalInputTokens: 0, totalOutputTokens: 0, tags: [],
      });
      const rule = makeRule({ conditionType: 'cost_limit', conditionConfig: { maxCostUsd: 5, scope: 'daily' } });
      const result = await evaluateCostLimit(store, rule, 'agent_1');
      expect(result.triggered).toBe(true);
      expect(result.currentValue).toBe(7.0);
    });
  });

  describe('evaluateCustomMetric', () => {
    it('should evaluate event_count with gt operator', async () => {
      for (let i = 0; i < 15; i++) {
        await store.insertEvents([makeEvent({ agentId: 'agent_1' })]);
      }
      const rule = makeRule({ conditionType: 'custom_metric', conditionConfig: { metricName: 'event_count', operator: 'gt', value: 10, windowMinutes: 60 } });
      const result = await evaluateCustomMetric(store, rule, 'agent_1');
      expect(result.triggered).toBe(true);
      expect(result.currentValue).toBe(15);
    });

    it('should evaluate error_count', async () => {
      for (let i = 0; i < 5; i++) {
        await store.insertEvents([makeEvent({ agentId: 'agent_1', severity: 'error' })]);
      }
      const rule = makeRule({ conditionType: 'custom_metric', conditionConfig: { metricName: 'error_count', operator: 'gt', value: 3, windowMinutes: 60 } });
      const result = await evaluateCustomMetric(store, rule, 'agent_1');
      expect(result.triggered).toBe(true);
      expect(result.currentValue).toBe(5);
    });

    it('should not trigger with lt operator when value is above', async () => {
      for (let i = 0; i < 5; i++) {
        await store.insertEvents([makeEvent({ agentId: 'agent_1' })]);
      }
      const rule = makeRule({ conditionType: 'custom_metric', conditionConfig: { metricName: 'event_count', operator: 'lt', value: 3, windowMinutes: 60 } });
      const result = await evaluateCustomMetric(store, rule, 'agent_1');
      expect(result.triggered).toBe(false);
    });

    it('should handle unknown metric name', async () => {
      const rule = makeRule({ conditionType: 'custom_metric', conditionConfig: { metricName: 'unknown_metric', operator: 'gt', value: 0, windowMinutes: 60 } });
      const result = await evaluateCustomMetric(store, rule, 'agent_1');
      expect(result.triggered).toBe(false);
    });

    it('should evaluate metricKeyPath from event metadata (architecture §3.4)', async () => {
      for (let i = 0; i < 5; i++) {
        await store.insertEvents([makeEvent({ agentId: 'agent_1', metadata: { response_time_ms: 100 + i * 50 } })]);
      }
      const rule = makeRule({
        conditionType: 'custom_metric',
        conditionConfig: { metricKeyPath: 'response_time_ms', operator: 'gt', value: 200, windowMinutes: 60 },
      });
      const result = await evaluateCustomMetric(store, rule, 'agent_1');
      // Last event has response_time_ms = 300, which is > 200
      expect(result.triggered).toBe(true);
      expect(result.currentValue).toBe(300);
    });

    it('should extract nested metricKeyPath with dot notation', async () => {
      await store.insertEvents([makeEvent({ agentId: 'agent_1', metadata: { perf: { latency_ms: 150 } } })]);
      const rule = makeRule({
        conditionType: 'custom_metric',
        conditionConfig: { metricKeyPath: 'perf.latency_ms', operator: 'gte', value: 150, windowMinutes: 60 },
      });
      const result = await evaluateCustomMetric(store, rule, 'agent_1');
      expect(result.triggered).toBe(true);
      expect(result.currentValue).toBe(150);
    });

    it('should not trigger when no events have the metricKeyPath', async () => {
      await store.insertEvents([makeEvent({ agentId: 'agent_1', metadata: { other_field: 42 } })]);
      const rule = makeRule({
        conditionType: 'custom_metric',
        conditionConfig: { metricKeyPath: 'response_time_ms', operator: 'gt', value: 100, windowMinutes: 60 },
      });
      const result = await evaluateCustomMetric(store, rule, 'agent_1');
      expect(result.triggered).toBe(false);
      expect(result.message).toContain('No events with metadata key');
    });

    it('should support gte and lte operators', async () => {
      for (let i = 0; i < 3; i++) {
        await store.insertEvents([makeEvent({ agentId: 'agent_1' })]);
      }
      const ruleGte = makeRule({ conditionType: 'custom_metric', conditionConfig: { metricName: 'event_count', operator: 'gte', value: 3, windowMinutes: 60 } });
      const resultGte = await evaluateCustomMetric(store, ruleGte, 'agent_1');
      expect(resultGte.triggered).toBe(true);

      const ruleLte = makeRule({ conditionType: 'custom_metric', conditionConfig: { metricName: 'event_count', operator: 'lte', value: 3, windowMinutes: 60 } });
      const resultLte = await evaluateCustomMetric(store, ruleLte, 'agent_1');
      expect(resultLte.triggered).toBe(true);
    });
  });

  describe('evaluateCondition (dispatch)', () => {
    it('should dispatch to error_rate_threshold evaluator', async () => {
      const rule = makeRule({ conditionType: 'error_rate_threshold' });
      const result = await evaluateCondition(store, rule, 'agent_1');
      expect(result).toHaveProperty('triggered');
    });

    it('should dispatch to cost_limit evaluator', async () => {
      const rule = makeRule({ conditionType: 'cost_limit', conditionConfig: { maxCostUsd: 10, scope: 'daily' } });
      const result = await evaluateCondition(store, rule, 'agent_1');
      expect(result).toHaveProperty('triggered');
    });

    it('should dispatch to custom_metric evaluator', async () => {
      const rule = makeRule({ conditionType: 'custom_metric', conditionConfig: { metricName: 'event_count', operator: 'gt', value: 0, windowMinutes: 60 } });
      const result = await evaluateCondition(store, rule, 'agent_1');
      expect(result).toHaveProperty('triggered');
    });

    it('should return not triggered for unknown condition type', async () => {
      const rule = makeRule({ conditionType: 'unknown' as any });
      const result = await evaluateCondition(store, rule, 'agent_1');
      expect(result.triggered).toBe(false);
    });
  });
});
