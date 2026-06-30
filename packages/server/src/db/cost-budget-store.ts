/**
 * Cost Budget Store (Feature 5 — Story 2)
 *
 * CRUD for cost budgets, state management, and anomaly config.
 * Follows GuardrailStore pattern.
 */

import { sql } from 'drizzle-orm';
import { type AnyDb, dbRun, dbAll, dbGet } from './dialect-db.js';
import type {
  CostBudget,
  CostBudgetState,
  CostAnomalyConfig,
} from '@agentkitai/agentlens-core';

export class CostBudgetStore {
  constructor(private readonly db: AnyDb) {}

  // ─── Budgets ─────────────────────────────────────────────

  async createBudget(budget: CostBudget): Promise<void> {
    await dbRun(this.db, sql`
      INSERT INTO cost_budgets (
        id, tenant_id, scope, agent_id, period, limit_usd,
        on_breach, downgrade_target_model, enabled, created_at, updated_at
      ) VALUES (
        ${budget.id}, ${budget.tenantId}, ${budget.scope}, ${budget.agentId ?? null},
        ${budget.period}, ${budget.limitUsd}, ${budget.onBreach},
        ${budget.downgradeTargetModel ?? null}, ${budget.enabled ? 1 : 0},
        ${budget.createdAt}, ${budget.updatedAt}
      )
    `);
  }

  async getBudget(tenantId: string, budgetId: string): Promise<CostBudget | null> {
    const row = await dbGet<Record<string, unknown>>(this.db, sql`
      SELECT * FROM cost_budgets WHERE id = ${budgetId} AND tenant_id = ${tenantId}
    `);
    return row ? this._mapBudget(row) : null;
  }

  async listBudgets(tenantId: string, opts?: { agentId?: string; scope?: string; enabled?: boolean }): Promise<CostBudget[]> {
    if (opts?.agentId && opts?.scope && opts?.enabled !== undefined) {
      return (await dbAll<Record<string, unknown>>(this.db, sql`
        SELECT * FROM cost_budgets WHERE tenant_id = ${tenantId}
          AND agent_id = ${opts.agentId} AND scope = ${opts.scope} AND enabled = ${opts.enabled ? 1 : 0}
        ORDER BY created_at DESC
      `)).map(r => this._mapBudget(r));
    }
    if (opts?.agentId && opts?.scope) {
      return (await dbAll<Record<string, unknown>>(this.db, sql`
        SELECT * FROM cost_budgets WHERE tenant_id = ${tenantId}
          AND agent_id = ${opts.agentId} AND scope = ${opts.scope}
        ORDER BY created_at DESC
      `)).map(r => this._mapBudget(r));
    }
    if (opts?.agentId && opts?.enabled !== undefined) {
      return (await dbAll<Record<string, unknown>>(this.db, sql`
        SELECT * FROM cost_budgets WHERE tenant_id = ${tenantId}
          AND agent_id = ${opts.agentId} AND enabled = ${opts.enabled ? 1 : 0}
        ORDER BY created_at DESC
      `)).map(r => this._mapBudget(r));
    }
    if (opts?.scope && opts?.enabled !== undefined) {
      return (await dbAll<Record<string, unknown>>(this.db, sql`
        SELECT * FROM cost_budgets WHERE tenant_id = ${tenantId}
          AND scope = ${opts.scope} AND enabled = ${opts.enabled ? 1 : 0}
        ORDER BY created_at DESC
      `)).map(r => this._mapBudget(r));
    }
    if (opts?.agentId) {
      return (await dbAll<Record<string, unknown>>(this.db, sql`
        SELECT * FROM cost_budgets WHERE tenant_id = ${tenantId} AND agent_id = ${opts.agentId}
        ORDER BY created_at DESC
      `)).map(r => this._mapBudget(r));
    }
    if (opts?.scope) {
      return (await dbAll<Record<string, unknown>>(this.db, sql`
        SELECT * FROM cost_budgets WHERE tenant_id = ${tenantId} AND scope = ${opts.scope}
        ORDER BY created_at DESC
      `)).map(r => this._mapBudget(r));
    }
    if (opts?.enabled !== undefined) {
      return (await dbAll<Record<string, unknown>>(this.db, sql`
        SELECT * FROM cost_budgets WHERE tenant_id = ${tenantId} AND enabled = ${opts.enabled ? 1 : 0}
        ORDER BY created_at DESC
      `)).map(r => this._mapBudget(r));
    }
    return (await dbAll<Record<string, unknown>>(this.db, sql`
      SELECT * FROM cost_budgets WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
    `)).map(r => this._mapBudget(r));
  }

  async listEnabledBudgets(tenantId: string, agentId?: string): Promise<CostBudget[]> {
    if (agentId) {
      return (await dbAll<Record<string, unknown>>(this.db, sql`
        SELECT * FROM cost_budgets
        WHERE tenant_id = ${tenantId} AND enabled = 1
          AND (scope = 'session' OR agent_id = ${agentId})
        ORDER BY created_at ASC
      `)).map(r => this._mapBudget(r));
    }
    return (await dbAll<Record<string, unknown>>(this.db, sql`
      SELECT * FROM cost_budgets
      WHERE tenant_id = ${tenantId} AND enabled = 1
      ORDER BY created_at ASC
    `)).map(r => this._mapBudget(r));
  }

  async updateBudget(tenantId: string, budgetId: string, updates: Partial<CostBudget>): Promise<boolean> {
    const existing = await this.getBudget(tenantId, budgetId);
    if (!existing) return false;

    const merged = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    await dbRun(this.db, sql`
      UPDATE cost_budgets SET
        scope = ${merged.scope},
        agent_id = ${merged.agentId ?? null},
        period = ${merged.period},
        limit_usd = ${merged.limitUsd},
        on_breach = ${merged.onBreach},
        downgrade_target_model = ${merged.downgradeTargetModel ?? null},
        enabled = ${merged.enabled ? 1 : 0},
        updated_at = ${merged.updatedAt}
      WHERE id = ${budgetId} AND tenant_id = ${tenantId}
    `);
    return true;
  }

  async deleteBudget(tenantId: string, budgetId: string): Promise<boolean> {
    const existing = await this.getBudget(tenantId, budgetId);
    if (!existing) return false;

    await dbRun(this.db, sql`DELETE FROM cost_budgets WHERE id = ${budgetId} AND tenant_id = ${tenantId}`);
    await dbRun(this.db, sql`DELETE FROM cost_budget_state WHERE budget_id = ${budgetId} AND tenant_id = ${tenantId}`);
    return true;
  }

  // ─── State ───────────────────────────────────────────────

  async getState(tenantId: string, budgetId: string): Promise<CostBudgetState | null> {
    const row = await dbGet<Record<string, unknown>>(this.db, sql`
      SELECT * FROM cost_budget_state WHERE budget_id = ${budgetId} AND tenant_id = ${tenantId}
    `);
    return row ? this._mapState(row) : null;
  }

  async upsertState(state: CostBudgetState): Promise<void> {
    await dbRun(this.db, sql`
      INSERT INTO cost_budget_state (budget_id, tenant_id, last_breach_at, breach_count, current_spend, period_start)
      VALUES (${state.budgetId}, ${state.tenantId}, ${state.lastBreachAt ?? null},
              ${state.breachCount}, ${state.currentSpend ?? null}, ${state.periodStart ?? null})
      ON CONFLICT (budget_id, tenant_id) DO UPDATE SET
        last_breach_at = ${state.lastBreachAt ?? null},
        breach_count = ${state.breachCount},
        current_spend = ${state.currentSpend ?? null},
        period_start = ${state.periodStart ?? null}
    `);
  }

  // ─── Anomaly Config ──────────────────────────────────────

  async getAnomalyConfig(tenantId: string): Promise<CostAnomalyConfig | null> {
    const row = await dbGet<Record<string, unknown>>(this.db, sql`
      SELECT * FROM cost_anomaly_config WHERE tenant_id = ${tenantId}
    `);
    return row ? this._mapAnomalyConfig(row) : null;
  }

  async upsertAnomalyConfig(config: CostAnomalyConfig): Promise<void> {
    await dbRun(this.db, sql`
      INSERT INTO cost_anomaly_config (tenant_id, multiplier, min_sessions, enabled, updated_at)
      VALUES (${config.tenantId}, ${config.multiplier}, ${config.minSessions},
              ${config.enabled ? 1 : 0}, ${config.updatedAt})
      ON CONFLICT (tenant_id) DO UPDATE SET
        multiplier = ${config.multiplier},
        min_sessions = ${config.minSessions},
        enabled = ${config.enabled ? 1 : 0},
        updated_at = ${config.updatedAt}
    `);
  }

  // ─── Mappers ─────────────────────────────────────────────

  private _mapBudget(row: Record<string, unknown>): CostBudget {
    return {
      id: row['id'] as string,
      tenantId: row['tenant_id'] as string,
      scope: row['scope'] as CostBudget['scope'],
      agentId: (row['agent_id'] as string) || undefined,
      period: row['period'] as CostBudget['period'],
      limitUsd: row['limit_usd'] as number,
      onBreach: row['on_breach'] as CostBudget['onBreach'],
      downgradeTargetModel: (row['downgrade_target_model'] as string) || undefined,
      enabled: row['enabled'] === 1 || row['enabled'] === true,
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    };
  }

  private _mapState(row: Record<string, unknown>): CostBudgetState {
    return {
      budgetId: row['budget_id'] as string,
      tenantId: row['tenant_id'] as string,
      lastBreachAt: (row['last_breach_at'] as string) || undefined,
      breachCount: (row['breach_count'] as number) ?? 0,
      currentSpend: row['current_spend'] != null ? (row['current_spend'] as number) : undefined,
      periodStart: (row['period_start'] as string) || undefined,
    };
  }

  private _mapAnomalyConfig(row: Record<string, unknown>): CostAnomalyConfig {
    return {
      tenantId: row['tenant_id'] as string,
      multiplier: row['multiplier'] as number,
      minSessions: row['min_sessions'] as number,
      enabled: row['enabled'] === 1 || row['enabled'] === true,
      updatedAt: row['updated_at'] as string,
    };
  }
}
