/**
 * Tests for GuardrailEngine (v0.8.0 — Story 1.3)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ulid } from 'ulid';
import { computeEventHash } from '@agentlensai/core';
import type { AgentLensEvent, GuardrailRule } from '@agentlensai/core';
import { createTestDb, type SqliteDb } from '../../../db/index.js';
import { runMigrations } from '../../../db/migrate.js';
import { SqliteEventStore } from '../../../db/sqlite-store.js';
import { TenantScopedStore } from '../../../db/tenant-scoped-store.js';
import { GuardrailStore } from '../../../db/guardrail-store.js';
import { GuardrailEngine } from '../engine.js';
import { eventBus } from '../../event-bus.js';

const tenantId = 'test-tenant';
let counter = 0;

function makeRule(gStore: GuardrailStore, overrides: Partial<GuardrailRule> = {}): GuardrailRule {
  const rule: GuardrailRule = {
    id: `gr_${ulid()}`, tenantId, name: 'Test Rule', enabled: true,
    conditionType: 'error_rate_threshold', conditionConfig: { threshold: 30, windowMinutes: 60 },
    actionType: 'pause_agent', actionConfig: {},
    cooldownMinutes: 15, dryRun: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  };
  gStore.createRule(rule);
  return rule;
}

function makeEvent(overrides: Partial<AgentLensEvent> = {}): AgentLensEvent {
  counter++;
  const id = `evt_${counter}_${Date.now()}`;
  const base = {
    id, timestamp: new Date().toISOString(),
    sessionId: overrides.sessionId ?? `ses_${id}`,
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

describe('GuardrailEngine', () => {
  let db: SqliteDb;
  let tenantStore: TenantScopedStore;
  let guardrailStore: GuardrailStore;
  let engine: GuardrailEngine;

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    const rawStore = new SqliteEventStore(db);
    tenantStore = new TenantScopedStore(rawStore, tenantId);
    guardrailStore = new GuardrailStore(db);
    engine = new GuardrailEngine(tenantStore, db);
    counter = 0;
  });

  afterEach(() => {
    engine.stop();
    eventBus.removeAllListeners();
    // @ts-expect-error internal cleanup
    db.$client?.close?.();
  });

  it('should start and stop without errors', () => {
    engine.start();
    expect(() => engine.stop()).not.toThrow();
  });

  it('should not crash with no rules', async () => {
    await expect(engine.evaluateEvent(makeEvent())).resolves.not.toThrow();
  });

  it('should not trigger when condition is not met', async () => {
    makeRule(guardrailStore, { conditionConfig: { threshold: 90, windowMinutes: 60 } });
    for (let i = 0; i < 10; i++) {
      await tenantStore.insertEvents([makeEvent({ severity: 'info' })]);
    }
    await engine.evaluateEvent(makeEvent());
    const history = guardrailStore.listTriggerHistory(tenantId);
    expect(history.triggers).toHaveLength(0);
  });

  it('should trigger when condition is met', async () => {
    const rule = makeRule(guardrailStore, { conditionConfig: { threshold: 30, windowMinutes: 60 } });
    for (let i = 0; i < 10; i++) {
      await tenantStore.insertEvents([makeEvent({ severity: i < 6 ? 'error' : 'info' })]);
    }
    const alerts: unknown[] = [];
    eventBus.on('alert_triggered', (e) => alerts.push(e));
    await engine.evaluateEvent(makeEvent({ severity: 'error' }));
    const history = guardrailStore.listTriggerHistory(tenantId, { ruleId: rule.id });
    expect(history.triggers.length).toBeGreaterThanOrEqual(1);
    expect(history.triggers[0].actionExecuted).toBe(true);
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });

  it('should respect cooldown period', async () => {
    const rule = makeRule(guardrailStore, { conditionConfig: { threshold: 10, windowMinutes: 60 }, cooldownMinutes: 60 });
    guardrailStore.upsertState({ ruleId: rule.id, tenantId, lastTriggeredAt: new Date().toISOString(), triggerCount: 1 });
    for (let i = 0; i < 10; i++) {
      await tenantStore.insertEvents([makeEvent({ severity: 'error' })]);
    }
    await engine.evaluateEvent(makeEvent({ severity: 'error' }));
    const history = guardrailStore.listTriggerHistory(tenantId, { ruleId: rule.id });
    expect(history.triggers).toHaveLength(0);
  });

  it('should not execute action in dry-run mode', async () => {
    const rule = makeRule(guardrailStore, { conditionConfig: { threshold: 10, windowMinutes: 60 }, dryRun: true });
    for (let i = 0; i < 10; i++) {
      await tenantStore.insertEvents([makeEvent({ severity: 'error' })]);
    }
    const alerts: unknown[] = [];
    eventBus.on('alert_triggered', (e) => alerts.push(e));
    await engine.evaluateEvent(makeEvent({ severity: 'error' }));
    const history = guardrailStore.listTriggerHistory(tenantId, { ruleId: rule.id });
    expect(history.triggers.length).toBeGreaterThanOrEqual(1);
    expect(history.triggers[0].actionResult).toBe('dry_run');
    expect(history.triggers[0].actionExecuted).toBe(false);
    expect(alerts).toHaveLength(0);
  });

  it('should update state after evaluation', async () => {
    const rule = makeRule(guardrailStore, { conditionConfig: { threshold: 90, windowMinutes: 60 } });
    await engine.evaluateEvent(makeEvent());
    const state = guardrailStore.getState(tenantId, rule.id);
    expect(state).not.toBeNull();
    expect(state!.lastEvaluatedAt).toBeDefined();
  });

  it('should increment trigger count', async () => {
    const rule = makeRule(guardrailStore, { conditionConfig: { threshold: 10, windowMinutes: 60 }, cooldownMinutes: 0 });
    for (let i = 0; i < 10; i++) {
      await tenantStore.insertEvents([makeEvent({ severity: 'error' })]);
    }
    await engine.evaluateEvent(makeEvent({ severity: 'error' }));
    await engine.evaluateEvent(makeEvent({ severity: 'error' }));
    const state = guardrailStore.getState(tenantId, rule.id);
    expect(state!.triggerCount).toBeGreaterThanOrEqual(2);
  });

  it('should handle disabled rules', async () => {
    makeRule(guardrailStore, { enabled: false, conditionConfig: { threshold: 10, windowMinutes: 60 } });
    for (let i = 0; i < 10; i++) {
      await tenantStore.insertEvents([makeEvent({ severity: 'error' })]);
    }
    await engine.evaluateEvent(makeEvent({ severity: 'error' }));
    const history = guardrailStore.listTriggerHistory(tenantId);
    expect(history.triggers).toHaveLength(0);
  });

  it('should subscribe to EventBus when started', async () => {
    const rule = makeRule(guardrailStore, { conditionConfig: { threshold: 10, windowMinutes: 60 } });
    for (let i = 0; i < 10; i++) {
      await tenantStore.insertEvents([makeEvent({ severity: 'error' })]);
    }
    engine.start();
    eventBus.emit({ type: 'event_ingested', event: makeEvent({ severity: 'error' }), timestamp: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 200));
    const history = guardrailStore.listTriggerHistory(tenantId, { ruleId: rule.id });
    expect(history.triggers.length).toBeGreaterThanOrEqual(1);
  });

  it('should expose the GuardrailStore', () => {
    expect(engine.getStore()).toBeInstanceOf(GuardrailStore);
  });
});
