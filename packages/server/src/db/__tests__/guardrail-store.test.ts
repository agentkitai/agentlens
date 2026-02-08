/**
 * Tests for GuardrailStore (v0.8.0 — Story 1.2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { GuardrailStore } from '../guardrail-store.js';
import type { GuardrailRule, GuardrailState, GuardrailTriggerHistory } from '@agentlensai/core';

describe('GuardrailStore', () => {
  let db: SqliteDb;
  let store: GuardrailStore;
  const tenantId = 'test-tenant';

  function makeRule(overrides: Partial<GuardrailRule> = {}): GuardrailRule {
    return {
      id: `gr_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      tenantId,
      name: 'Test Rule',
      enabled: true,
      conditionType: 'error_rate_threshold',
      conditionConfig: { threshold: 30, windowMinutes: 5 },
      actionType: 'pause_agent',
      actionConfig: { message: 'Pausing' },
      cooldownMinutes: 15,
      dryRun: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    store = new GuardrailStore(db);
  });

  afterEach(() => {
    // @ts-expect-error accessing internal session for cleanup
    db.$client?.close?.();
  });

  // ─── Rules CRUD ───────────────────────────────────────

  describe('Rules CRUD', () => {
    it('should create and retrieve a rule', () => {
      const rule = makeRule();
      store.createRule(rule);

      const fetched = store.getRule(tenantId, rule.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(rule.id);
      expect(fetched!.name).toBe('Test Rule');
      expect(fetched!.conditionType).toBe('error_rate_threshold');
      expect(fetched!.actionType).toBe('pause_agent');
      expect(fetched!.enabled).toBe(true);
      expect(fetched!.dryRun).toBe(false);
      expect(fetched!.cooldownMinutes).toBe(15);
    });

    it('should return null for non-existent rule', () => {
      const fetched = store.getRule(tenantId, 'nonexistent');
      expect(fetched).toBeNull();
    });

    it('should list rules for tenant', () => {
      store.createRule(makeRule({ name: 'Rule A' }));
      store.createRule(makeRule({ name: 'Rule B' }));

      const rules = store.listRules(tenantId);
      expect(rules).toHaveLength(2);
    });

    it('should not list rules from other tenants', () => {
      store.createRule(makeRule({ tenantId: 'other-tenant' }));
      store.createRule(makeRule({ tenantId }));

      const rules = store.listRules(tenantId);
      expect(rules).toHaveLength(1);
    });

    it('should list enabled rules', () => {
      store.createRule(makeRule({ name: 'Enabled', enabled: true }));
      store.createRule(makeRule({ name: 'Disabled', enabled: false }));

      const rules = store.listEnabledRules(tenantId);
      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe('Enabled');
    });

    it('should list enabled rules scoped to agent', () => {
      store.createRule(makeRule({ name: 'Global', agentId: undefined }));
      store.createRule(makeRule({ name: 'AgentA', agentId: 'agent-a' }));
      store.createRule(makeRule({ name: 'AgentB', agentId: 'agent-b' }));

      const rules = store.listEnabledRules(tenantId, 'agent-a');
      expect(rules).toHaveLength(2); // Global + AgentA
      const names = rules.map((r) => r.name);
      expect(names).toContain('Global');
      expect(names).toContain('AgentA');
      expect(names).not.toContain('AgentB');
    });

    it('should update a rule', () => {
      const rule = makeRule();
      store.createRule(rule);

      const updated = store.updateRule(tenantId, rule.id, {
        name: 'Updated Name',
        enabled: false,
        dryRun: true,
      });
      expect(updated).toBe(true);

      const fetched = store.getRule(tenantId, rule.id);
      expect(fetched!.name).toBe('Updated Name');
      expect(fetched!.enabled).toBe(false);
      expect(fetched!.dryRun).toBe(true);
    });

    it('should return false when updating non-existent rule', () => {
      const updated = store.updateRule(tenantId, 'nonexistent', { name: 'X' });
      expect(updated).toBe(false);
    });

    it('should delete a rule and its state + history', () => {
      const rule = makeRule();
      store.createRule(rule);
      store.upsertState({ ruleId: rule.id, tenantId, triggerCount: 3 });
      store.insertTrigger({
        id: 'trig_1',
        ruleId: rule.id,
        tenantId,
        triggeredAt: new Date().toISOString(),
        conditionValue: 50,
        conditionThreshold: 30,
        actionExecuted: true,
        metadata: {},
      });

      const deleted = store.deleteRule(tenantId, rule.id);
      expect(deleted).toBe(true);
      expect(store.getRule(tenantId, rule.id)).toBeNull();
      expect(store.getState(tenantId, rule.id)).toBeNull();
      expect(store.listTriggerHistory(tenantId, { ruleId: rule.id }).triggers).toHaveLength(0);
    });

    it('should return false when deleting non-existent rule', () => {
      const deleted = store.deleteRule(tenantId, 'nonexistent');
      expect(deleted).toBe(false);
    });

    it('should store conditionConfig and actionConfig as JSON', () => {
      const rule = makeRule({
        conditionConfig: { threshold: 50, windowMinutes: 10 },
        actionConfig: { url: 'https://example.com', headers: { 'X-Key': 'val' } },
      });
      store.createRule(rule);

      const fetched = store.getRule(tenantId, rule.id);
      expect(fetched!.conditionConfig).toEqual({ threshold: 50, windowMinutes: 10 });
      expect(fetched!.actionConfig).toEqual({ url: 'https://example.com', headers: { 'X-Key': 'val' } });
    });

    it('should handle optional description and agentId', () => {
      const rule = makeRule({
        description: 'A description',
        agentId: 'agent-1',
      });
      store.createRule(rule);

      const fetched = store.getRule(tenantId, rule.id);
      expect(fetched!.description).toBe('A description');
      expect(fetched!.agentId).toBe('agent-1');
    });
  });

  // ─── State ────────────────────────────────────────────

  describe('State', () => {
    it('should create and retrieve state', () => {
      const state: GuardrailState = {
        ruleId: 'rule_1',
        tenantId,
        triggerCount: 0,
      };
      store.upsertState(state);

      const fetched = store.getState(tenantId, 'rule_1');
      expect(fetched).not.toBeNull();
      expect(fetched!.ruleId).toBe('rule_1');
      expect(fetched!.triggerCount).toBe(0);
    });

    it('should upsert (update existing) state', () => {
      store.upsertState({ ruleId: 'rule_1', tenantId, triggerCount: 0 });
      store.upsertState({
        ruleId: 'rule_1',
        tenantId,
        triggerCount: 3,
        lastTriggeredAt: '2026-01-01T00:00:00Z',
        currentValue: 42.5,
      });

      const fetched = store.getState(tenantId, 'rule_1');
      expect(fetched!.triggerCount).toBe(3);
      expect(fetched!.lastTriggeredAt).toBe('2026-01-01T00:00:00Z');
      expect(fetched!.currentValue).toBe(42.5);
    });

    it('should return null for non-existent state', () => {
      expect(store.getState(tenantId, 'nonexistent')).toBeNull();
    });
  });

  // ─── Trigger History ──────────────────────────────────

  describe('Trigger History', () => {
    it('should insert and list trigger history', () => {
      const trigger: GuardrailTriggerHistory = {
        id: 'trig_1',
        ruleId: 'rule_1',
        tenantId,
        triggeredAt: '2026-01-01T00:00:00Z',
        conditionValue: 45,
        conditionThreshold: 30,
        actionExecuted: true,
        actionResult: 'success',
        metadata: { agentId: 'agent-1' },
      };
      store.insertTrigger(trigger);

      const { triggers, total } = store.listTriggerHistory(tenantId);
      expect(triggers).toHaveLength(1);
      expect(total).toBe(1);
      expect(triggers[0].id).toBe('trig_1');
      expect(triggers[0].conditionValue).toBe(45);
      expect(triggers[0].actionExecuted).toBe(true);
      expect(triggers[0].actionResult).toBe('success');
      expect(triggers[0].metadata).toEqual({ agentId: 'agent-1' });
    });

    it('should filter trigger history by ruleId', () => {
      store.insertTrigger({
        id: 'trig_1', ruleId: 'rule_1', tenantId,
        triggeredAt: '2026-01-01T00:00:00Z',
        conditionValue: 45, conditionThreshold: 30,
        actionExecuted: true, metadata: {},
      });
      store.insertTrigger({
        id: 'trig_2', ruleId: 'rule_2', tenantId,
        triggeredAt: '2026-01-01T01:00:00Z',
        conditionValue: 60, conditionThreshold: 50,
        actionExecuted: true, metadata: {},
      });

      const { triggers, total } = store.listTriggerHistory(tenantId, { ruleId: 'rule_1' });
      expect(triggers).toHaveLength(1);
      expect(total).toBe(1);
      expect(triggers[0].ruleId).toBe('rule_1');
    });

    it('should paginate trigger history', () => {
      for (let i = 0; i < 5; i++) {
        store.insertTrigger({
          id: `trig_${i}`, ruleId: 'rule_1', tenantId,
          triggeredAt: new Date(Date.now() + i * 1000).toISOString(),
          conditionValue: i * 10, conditionThreshold: 30,
          actionExecuted: true, metadata: {},
        });
      }

      const page1 = store.listTriggerHistory(tenantId, { limit: 2, offset: 0 });
      expect(page1.triggers).toHaveLength(2);
      expect(page1.total).toBe(5);

      const page2 = store.listTriggerHistory(tenantId, { limit: 2, offset: 2 });
      expect(page2.triggers).toHaveLength(2);
    });

    it('should get recent triggers for a rule', () => {
      for (let i = 0; i < 10; i++) {
        store.insertTrigger({
          id: `trig_${i}`, ruleId: 'rule_1', tenantId,
          triggeredAt: new Date(Date.now() + i * 1000).toISOString(),
          conditionValue: i, conditionThreshold: 30,
          actionExecuted: true, metadata: {},
        });
      }

      const recent = store.getRecentTriggers(tenantId, 'rule_1', 3);
      expect(recent).toHaveLength(3);
      // Should be newest first
      expect(recent[0].conditionValue).toBeGreaterThan(recent[1].conditionValue);
    });

    it('should not return triggers from other tenants', () => {
      store.insertTrigger({
        id: 'trig_1', ruleId: 'rule_1', tenantId: 'other-tenant',
        triggeredAt: new Date().toISOString(),
        conditionValue: 45, conditionThreshold: 30,
        actionExecuted: true, metadata: {},
      });

      const { triggers } = store.listTriggerHistory(tenantId);
      expect(triggers).toHaveLength(0);
    });
  });
});
