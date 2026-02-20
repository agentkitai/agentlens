/**
 * Tests for CostBudgetStore (Feature 5 — Story 2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { CostBudgetStore } from '../cost-budget-store.js';
import type { CostBudget, CostBudgetState, CostAnomalyConfig } from '@agentlensai/core';

describe('CostBudgetStore', () => {
  let db: SqliteDb;
  let store: CostBudgetStore;
  const tenantId = 'test-tenant';

  function makeBudget(overrides: Partial<CostBudget> = {}): CostBudget {
    return {
      id: `cb_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      tenantId,
      scope: 'agent',
      agentId: 'agent-1',
      period: 'daily',
      limitUsd: 10.0,
      onBreach: 'alert',
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    store = new CostBudgetStore(db);
  });

  afterEach(() => {
    // @ts-expect-error accessing internal session for cleanup
    db.$client?.close?.();
  });

  // ─── Budget CRUD ───────────────────────────────────────

  describe('Budget CRUD', () => {
    it('should create and retrieve a budget', () => {
      const budget = makeBudget();
      store.createBudget(budget);
      const retrieved = store.getBudget(tenantId, budget.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(budget.id);
      expect(retrieved!.scope).toBe('agent');
      expect(retrieved!.limitUsd).toBe(10.0);
    });

    it('should return null for non-existent budget', () => {
      expect(store.getBudget(tenantId, 'nonexistent')).toBeNull();
    });

    it('should list budgets for tenant', () => {
      store.createBudget(makeBudget({ id: 'b1' }));
      store.createBudget(makeBudget({ id: 'b2', scope: 'session', period: 'session', agentId: undefined }));
      const budgets = store.listBudgets(tenantId);
      expect(budgets).toHaveLength(2);
    });

    it('should filter by scope', () => {
      store.createBudget(makeBudget({ id: 'b1', scope: 'agent' }));
      store.createBudget(makeBudget({ id: 'b2', scope: 'session', period: 'session', agentId: undefined }));
      const agents = store.listBudgets(tenantId, { scope: 'agent' });
      expect(agents).toHaveLength(1);
      expect(agents[0].scope).toBe('agent');
    });

    it('should filter by enabled', () => {
      store.createBudget(makeBudget({ id: 'b1', enabled: true }));
      store.createBudget(makeBudget({ id: 'b2', enabled: false }));
      const enabled = store.listBudgets(tenantId, { enabled: true });
      expect(enabled).toHaveLength(1);
    });

    it('should filter by agentId', () => {
      store.createBudget(makeBudget({ id: 'b1', agentId: 'agent-1' }));
      store.createBudget(makeBudget({ id: 'b2', agentId: 'agent-2' }));
      const filtered = store.listBudgets(tenantId, { agentId: 'agent-1' });
      expect(filtered).toHaveLength(1);
    });

    it('should update a budget', () => {
      const budget = makeBudget();
      store.createBudget(budget);
      const updated = store.updateBudget(tenantId, budget.id, { limitUsd: 20.0 });
      expect(updated).toBe(true);
      const retrieved = store.getBudget(tenantId, budget.id);
      expect(retrieved!.limitUsd).toBe(20.0);
    });

    it('should return false when updating non-existent budget', () => {
      expect(store.updateBudget(tenantId, 'nonexistent', { limitUsd: 20 })).toBe(false);
    });

    it('should delete a budget', () => {
      const budget = makeBudget();
      store.createBudget(budget);
      expect(store.deleteBudget(tenantId, budget.id)).toBe(true);
      expect(store.getBudget(tenantId, budget.id)).toBeNull();
    });

    it('should return false when deleting non-existent budget', () => {
      expect(store.deleteBudget(tenantId, 'nonexistent')).toBe(false);
    });

    it('should not return budgets from other tenants', () => {
      store.createBudget(makeBudget({ id: 'b1', tenantId: 'other-tenant' }));
      const budgets = store.listBudgets(tenantId);
      expect(budgets).toHaveLength(0);
    });
  });

  // ─── Enabled Budgets ──────────────────────────────────

  describe('listEnabledBudgets', () => {
    it('should return only enabled budgets', () => {
      store.createBudget(makeBudget({ id: 'b1', enabled: true }));
      store.createBudget(makeBudget({ id: 'b2', enabled: false }));
      const enabled = store.listEnabledBudgets(tenantId);
      expect(enabled).toHaveLength(1);
    });

    it('should filter by agentId and include session-scoped', () => {
      store.createBudget(makeBudget({ id: 'b1', scope: 'agent', agentId: 'agent-1' }));
      store.createBudget(makeBudget({ id: 'b2', scope: 'session', period: 'session', agentId: undefined }));
      store.createBudget(makeBudget({ id: 'b3', scope: 'agent', agentId: 'agent-2' }));
      const budgets = store.listEnabledBudgets(tenantId, 'agent-1');
      expect(budgets).toHaveLength(2); // agent-1 + session-scoped
    });
  });

  // ─── State ────────────────────────────────────────────

  describe('State', () => {
    it('should return null for no state', () => {
      expect(store.getState(tenantId, 'b1')).toBeNull();
    });

    it('should upsert and retrieve state', () => {
      const state: CostBudgetState = {
        budgetId: 'b1',
        tenantId,
        breachCount: 1,
        lastBreachAt: new Date().toISOString(),
        currentSpend: 5.5,
        periodStart: new Date().toISOString(),
      };
      store.upsertState(state);
      const retrieved = store.getState(tenantId, 'b1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.breachCount).toBe(1);
      expect(retrieved!.currentSpend).toBe(5.5);
    });

    it('should update state on conflict', () => {
      store.upsertState({ budgetId: 'b1', tenantId, breachCount: 1 });
      store.upsertState({ budgetId: 'b1', tenantId, breachCount: 2, currentSpend: 10 });
      const retrieved = store.getState(tenantId, 'b1');
      expect(retrieved!.breachCount).toBe(2);
      expect(retrieved!.currentSpend).toBe(10);
    });
  });

  // ─── Anomaly Config ───────────────────────────────────

  describe('Anomaly Config', () => {
    it('should return null when no config', () => {
      expect(store.getAnomalyConfig(tenantId)).toBeNull();
    });

    it('should upsert and retrieve config', () => {
      const config: CostAnomalyConfig = {
        tenantId,
        multiplier: 5.0,
        minSessions: 10,
        enabled: true,
        updatedAt: new Date().toISOString(),
      };
      store.upsertAnomalyConfig(config);
      const retrieved = store.getAnomalyConfig(tenantId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.multiplier).toBe(5.0);
      expect(retrieved!.minSessions).toBe(10);
    });

    it('should update config on conflict', () => {
      store.upsertAnomalyConfig({
        tenantId, multiplier: 3, minSessions: 5, enabled: true,
        updatedAt: new Date().toISOString(),
      });
      store.upsertAnomalyConfig({
        tenantId, multiplier: 5, minSessions: 10, enabled: false,
        updatedAt: new Date().toISOString(),
      });
      const retrieved = store.getAnomalyConfig(tenantId);
      expect(retrieved!.multiplier).toBe(5);
      expect(retrieved!.enabled).toBe(false);
    });
  });
});
