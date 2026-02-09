/**
 * Guardrail Store (v0.8.0 — Story 1.2)
 *
 * CRUD operations for guardrail rules, runtime state, and trigger history.
 * All operations are tenant-scoped.
 */

import { sql } from 'drizzle-orm';
import type { SqliteDb } from './index.js';
import type {
  GuardrailRule,
  GuardrailState,
  GuardrailTriggerHistory,
} from '@agentlensai/core';

export class GuardrailStore {
  constructor(private readonly db: SqliteDb) {}

  // ─── Rules ───────────────────────────────────────────────

  createRule(rule: GuardrailRule): void {
    this.db.run(sql`
      INSERT INTO guardrail_rules (
        id, tenant_id, name, description, enabled,
        condition_type, condition_config, action_type, action_config,
        agent_id, cooldown_minutes, dry_run, created_at, updated_at
      ) VALUES (
        ${rule.id}, ${rule.tenantId}, ${rule.name}, ${rule.description ?? null},
        ${rule.enabled ? 1 : 0},
        ${rule.conditionType}, ${JSON.stringify(rule.conditionConfig)},
        ${rule.actionType}, ${JSON.stringify(rule.actionConfig)},
        ${rule.agentId ?? null}, ${rule.cooldownMinutes},
        ${rule.dryRun ? 1 : 0},
        ${rule.createdAt}, ${rule.updatedAt}
      )
    `);
  }

  getRule(tenantId: string, ruleId: string): GuardrailRule | null {
    const row = this.db.get<Record<string, unknown>>(sql`
      SELECT * FROM guardrail_rules WHERE id = ${ruleId} AND tenant_id = ${tenantId}
    `);
    return row ? this._mapRule(row) : null;
  }

  listRules(tenantId: string, agentId?: string): GuardrailRule[] {
    if (agentId) {
      const rows = this.db.all<Record<string, unknown>>(sql`
        SELECT * FROM guardrail_rules WHERE tenant_id = ${tenantId} AND agent_id = ${agentId} ORDER BY created_at DESC
      `);
      return rows.map((r) => this._mapRule(r));
    }
    const rows = this.db.all<Record<string, unknown>>(sql`
      SELECT * FROM guardrail_rules WHERE tenant_id = ${tenantId} ORDER BY created_at DESC
    `);
    return rows.map((r) => this._mapRule(r));
  }

  listEnabledRules(tenantId: string, agentId?: string): GuardrailRule[] {
    if (agentId) {
      const rows = this.db.all<Record<string, unknown>>(sql`
        SELECT * FROM guardrail_rules
        WHERE tenant_id = ${tenantId} AND enabled = 1
          AND (agent_id IS NULL OR agent_id = ${agentId})
        ORDER BY created_at ASC
      `);
      return rows.map((r) => this._mapRule(r));
    }
    const rows = this.db.all<Record<string, unknown>>(sql`
      SELECT * FROM guardrail_rules
      WHERE tenant_id = ${tenantId} AND enabled = 1
      ORDER BY created_at ASC
    `);
    return rows.map((r) => this._mapRule(r));
  }

  updateRule(tenantId: string, ruleId: string, updates: Partial<GuardrailRule>): boolean {
    const existing = this.getRule(tenantId, ruleId);
    if (!existing) return false;

    const merged = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.db.run(sql`
      UPDATE guardrail_rules SET
        name = ${merged.name},
        description = ${merged.description ?? null},
        enabled = ${merged.enabled ? 1 : 0},
        condition_type = ${merged.conditionType},
        condition_config = ${JSON.stringify(merged.conditionConfig)},
        action_type = ${merged.actionType},
        action_config = ${JSON.stringify(merged.actionConfig)},
        agent_id = ${merged.agentId ?? null},
        cooldown_minutes = ${merged.cooldownMinutes},
        dry_run = ${merged.dryRun ? 1 : 0},
        updated_at = ${merged.updatedAt}
      WHERE id = ${ruleId} AND tenant_id = ${tenantId}
    `);
    return true;
  }

  deleteRule(tenantId: string, ruleId: string): boolean {
    const existing = this.getRule(tenantId, ruleId);
    if (!existing) return false;

    this.db.run(sql`DELETE FROM guardrail_rules WHERE id = ${ruleId} AND tenant_id = ${tenantId}`);
    // Also clean up state and history
    this.db.run(sql`DELETE FROM guardrail_state WHERE rule_id = ${ruleId} AND tenant_id = ${tenantId}`);
    this.db.run(sql`DELETE FROM guardrail_trigger_history WHERE rule_id = ${ruleId} AND tenant_id = ${tenantId}`);
    return true;
  }

  // ─── State ───────────────────────────────────────────────

  getState(tenantId: string, ruleId: string): GuardrailState | null {
    const row = this.db.get<Record<string, unknown>>(sql`
      SELECT * FROM guardrail_state WHERE rule_id = ${ruleId} AND tenant_id = ${tenantId}
    `);
    return row ? this._mapState(row) : null;
  }

  upsertState(state: GuardrailState): void {
    this.db.run(sql`
      INSERT INTO guardrail_state (rule_id, tenant_id, last_triggered_at, trigger_count, last_evaluated_at, current_value)
      VALUES (${state.ruleId}, ${state.tenantId}, ${state.lastTriggeredAt ?? null},
              ${state.triggerCount}, ${state.lastEvaluatedAt ?? null}, ${state.currentValue ?? null})
      ON CONFLICT (rule_id, tenant_id) DO UPDATE SET
        last_triggered_at = ${state.lastTriggeredAt ?? null},
        trigger_count = ${state.triggerCount},
        last_evaluated_at = ${state.lastEvaluatedAt ?? null},
        current_value = ${state.currentValue ?? null}
    `);
  }

  // ─── Trigger History ─────────────────────────────────────

  insertTrigger(trigger: GuardrailTriggerHistory): void {
    this.db.run(sql`
      INSERT INTO guardrail_trigger_history (
        id, rule_id, tenant_id, triggered_at, condition_value, condition_threshold,
        action_executed, action_result, metadata
      ) VALUES (
        ${trigger.id}, ${trigger.ruleId}, ${trigger.tenantId}, ${trigger.triggeredAt},
        ${trigger.conditionValue}, ${trigger.conditionThreshold},
        ${trigger.actionExecuted ? 1 : 0}, ${trigger.actionResult ?? null},
        ${JSON.stringify(trigger.metadata)}
      )
    `);
  }

  listTriggerHistory(
    tenantId: string,
    opts?: { ruleId?: string; limit?: number; offset?: number },
  ): { triggers: GuardrailTriggerHistory[]; total: number } {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    let triggers: GuardrailTriggerHistory[];
    let total: number;

    if (opts?.ruleId) {
      triggers = this.db
        .all<Record<string, unknown>>(sql`
          SELECT * FROM guardrail_trigger_history
          WHERE tenant_id = ${tenantId} AND rule_id = ${opts.ruleId}
          ORDER BY triggered_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `)
        .map((r) => this._mapTrigger(r));

      const countRow = this.db.get<{ count: number }>(sql`
        SELECT COUNT(*) as count FROM guardrail_trigger_history
        WHERE tenant_id = ${tenantId} AND rule_id = ${opts.ruleId}
      `);
      total = countRow?.count ?? 0;
    } else {
      triggers = this.db
        .all<Record<string, unknown>>(sql`
          SELECT * FROM guardrail_trigger_history
          WHERE tenant_id = ${tenantId}
          ORDER BY triggered_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `)
        .map((r) => this._mapTrigger(r));

      const countRow = this.db.get<{ count: number }>(sql`
        SELECT COUNT(*) as count FROM guardrail_trigger_history
        WHERE tenant_id = ${tenantId}
      `);
      total = countRow?.count ?? 0;
    }

    return { triggers, total };
  }

  getRecentTriggers(tenantId: string, ruleId: string, limit: number = 5): GuardrailTriggerHistory[] {
    return this.db
      .all<Record<string, unknown>>(sql`
        SELECT * FROM guardrail_trigger_history
        WHERE tenant_id = ${tenantId} AND rule_id = ${ruleId}
        ORDER BY triggered_at DESC
        LIMIT ${limit}
      `)
      .map((r) => this._mapTrigger(r));
  }

  // ─── Mappers ─────────────────────────────────────────────

  private _mapRule(row: Record<string, unknown>): GuardrailRule {
    return {
      id: row['id'] as string,
      tenantId: row['tenant_id'] as string,
      name: row['name'] as string,
      description: (row['description'] as string) || undefined,
      enabled: row['enabled'] === 1 || row['enabled'] === true,
      conditionType: row['condition_type'] as GuardrailRule['conditionType'],
      conditionConfig: JSON.parse((row['condition_config'] as string) || '{}'),
      actionType: row['action_type'] as GuardrailRule['actionType'],
      actionConfig: JSON.parse((row['action_config'] as string) || '{}'),
      agentId: (row['agent_id'] as string) || undefined,
      cooldownMinutes: (row['cooldown_minutes'] as number) ?? 15,
      dryRun: row['dry_run'] === 1 || row['dry_run'] === true,
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    };
  }

  private _mapState(row: Record<string, unknown>): GuardrailState {
    return {
      ruleId: row['rule_id'] as string,
      tenantId: row['tenant_id'] as string,
      lastTriggeredAt: (row['last_triggered_at'] as string) || undefined,
      triggerCount: (row['trigger_count'] as number) ?? 0,
      lastEvaluatedAt: (row['last_evaluated_at'] as string) || undefined,
      currentValue: row['current_value'] != null ? (row['current_value'] as number) : undefined,
    };
  }

  private _mapTrigger(row: Record<string, unknown>): GuardrailTriggerHistory {
    return {
      id: row['id'] as string,
      ruleId: row['rule_id'] as string,
      tenantId: row['tenant_id'] as string,
      triggeredAt: row['triggered_at'] as string,
      conditionValue: row['condition_value'] as number,
      conditionThreshold: row['condition_threshold'] as number,
      actionExecuted: row['action_executed'] === 1 || row['action_executed'] === true,
      actionResult: (row['action_result'] as string) || undefined,
      metadata: JSON.parse((row['metadata'] as string) || '{}'),
    };
  }
}
