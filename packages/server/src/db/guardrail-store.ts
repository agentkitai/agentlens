/**
 * Guardrail Store (v0.8.0 — Story 1.2)
 *
 * CRUD operations for guardrail rules, runtime state, and trigger history.
 * All operations are tenant-scoped.
 */

import { sql } from 'drizzle-orm';
import { type AnyDb, dbRun, dbAll, dbGet } from './dialect-db.js';
import type {
  GuardrailRule,
  GuardrailState,
  GuardrailTriggerHistory,
} from '@agentkitai/agentlens-core';

export class GuardrailStore {
  constructor(private readonly db: AnyDb) {}

  // ─── Rules ───────────────────────────────────────────────

  async createRule(rule: GuardrailRule): Promise<void> {
    await dbRun(this.db, sql`
      INSERT INTO guardrail_rules (
        id, tenant_id, name, description, enabled,
        condition_type, condition_config, action_type, action_config,
        agent_id, cooldown_minutes, dry_run, created_at, updated_at,
        direction, tool_names, priority
      ) VALUES (
        ${rule.id}, ${rule.tenantId}, ${rule.name}, ${rule.description ?? null},
        ${rule.enabled ? 1 : 0},
        ${rule.conditionType}, ${JSON.stringify(rule.conditionConfig)},
        ${rule.actionType}, ${JSON.stringify(rule.actionConfig)},
        ${rule.agentId ?? null}, ${rule.cooldownMinutes},
        ${rule.dryRun ? 1 : 0},
        ${rule.createdAt}, ${rule.updatedAt},
        ${rule.direction ?? 'both'},
        ${rule.toolNames ? JSON.stringify(rule.toolNames) : null},
        ${rule.priority ?? 0}
      )
    `);
  }

  async getRule(tenantId: string, ruleId: string): Promise<GuardrailRule | null> {
    const row = await dbGet<Record<string, unknown>>(this.db, sql`
      SELECT * FROM guardrail_rules WHERE id = ${ruleId} AND tenant_id = ${tenantId}
    `);
    return row ? this._mapRule(row) : null;
  }

  async listRules(tenantId: string, agentId?: string): Promise<GuardrailRule[]> {
    if (agentId) {
      const rows = await dbAll<Record<string, unknown>>(this.db, sql`
        SELECT * FROM guardrail_rules WHERE tenant_id = ${tenantId} AND agent_id = ${agentId} ORDER BY created_at DESC
      `);
      return rows.map((r) => this._mapRule(r));
    }
    const rows = await dbAll<Record<string, unknown>>(this.db, sql`
      SELECT * FROM guardrail_rules WHERE tenant_id = ${tenantId} ORDER BY created_at DESC
    `);
    return rows.map((r) => this._mapRule(r));
  }

  async listEnabledRules(tenantId: string, agentId?: string): Promise<GuardrailRule[]> {
    if (agentId) {
      const rows = await dbAll<Record<string, unknown>>(this.db, sql`
        SELECT * FROM guardrail_rules
        WHERE tenant_id = ${tenantId} AND enabled = 1
          AND (agent_id IS NULL OR agent_id = ${agentId})
        ORDER BY created_at ASC
      `);
      return rows.map((r) => this._mapRule(r));
    }
    const rows = await dbAll<Record<string, unknown>>(this.db, sql`
      SELECT * FROM guardrail_rules
      WHERE tenant_id = ${tenantId} AND enabled = 1
      ORDER BY created_at ASC
    `);
    return rows.map((r) => this._mapRule(r));
  }

  async updateRule(tenantId: string, ruleId: string, updates: Partial<GuardrailRule>): Promise<boolean> {
    const existing = await this.getRule(tenantId, ruleId);
    if (!existing) return false;

    const merged = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    await dbRun(this.db, sql`
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
        updated_at = ${merged.updatedAt},
        direction = ${merged.direction ?? 'both'},
        tool_names = ${merged.toolNames ? JSON.stringify(merged.toolNames) : null},
        priority = ${merged.priority ?? 0}
      WHERE id = ${ruleId} AND tenant_id = ${tenantId}
    `);
    return true;
  }

  async deleteRule(tenantId: string, ruleId: string): Promise<boolean> {
    const existing = await this.getRule(tenantId, ruleId);
    if (!existing) return false;

    await dbRun(this.db, sql`DELETE FROM guardrail_rules WHERE id = ${ruleId} AND tenant_id = ${tenantId}`);
    // Also clean up state and history
    await dbRun(this.db, sql`DELETE FROM guardrail_state WHERE rule_id = ${ruleId} AND tenant_id = ${tenantId}`);
    await dbRun(this.db, sql`DELETE FROM guardrail_trigger_history WHERE rule_id = ${ruleId} AND tenant_id = ${tenantId}`);
    return true;
  }

  // ─── State ───────────────────────────────────────────────

  async getState(tenantId: string, ruleId: string): Promise<GuardrailState | null> {
    const row = await dbGet<Record<string, unknown>>(this.db, sql`
      SELECT * FROM guardrail_state WHERE rule_id = ${ruleId} AND tenant_id = ${tenantId}
    `);
    return row ? this._mapState(row) : null;
  }

  async upsertState(state: GuardrailState): Promise<void> {
    await dbRun(this.db, sql`
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

  async insertTrigger(trigger: GuardrailTriggerHistory): Promise<void> {
    await dbRun(this.db, sql`
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

  async listTriggerHistory(
    tenantId: string,
    opts?: { ruleId?: string; limit?: number; offset?: number },
  ): Promise<{ triggers: GuardrailTriggerHistory[]; total: number }> {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    let triggers: GuardrailTriggerHistory[];
    let total: number;

    if (opts?.ruleId) {
      triggers = (await dbAll<Record<string, unknown>>(this.db, sql`
          SELECT * FROM guardrail_trigger_history
          WHERE tenant_id = ${tenantId} AND rule_id = ${opts.ruleId}
          ORDER BY triggered_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `))
        .map((r) => this._mapTrigger(r));

      const countRow = await dbGet<{ count: number }>(this.db, sql`
        SELECT COUNT(*) as count FROM guardrail_trigger_history
        WHERE tenant_id = ${tenantId} AND rule_id = ${opts.ruleId}
      `);
      total = Number(countRow?.count ?? 0);
    } else {
      triggers = (await dbAll<Record<string, unknown>>(this.db, sql`
          SELECT * FROM guardrail_trigger_history
          WHERE tenant_id = ${tenantId}
          ORDER BY triggered_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `))
        .map((r) => this._mapTrigger(r));

      const countRow = await dbGet<{ count: number }>(this.db, sql`
        SELECT COUNT(*) as count FROM guardrail_trigger_history
        WHERE tenant_id = ${tenantId}
      `);
      total = Number(countRow?.count ?? 0);
    }

    return { triggers, total };
  }

  async getRecentTriggers(tenantId: string, ruleId: string, limit: number = 5): Promise<GuardrailTriggerHistory[]> {
    return (await dbAll<Record<string, unknown>>(this.db, sql`
        SELECT * FROM guardrail_trigger_history
        WHERE tenant_id = ${tenantId} AND rule_id = ${ruleId}
        ORDER BY triggered_at DESC
        LIMIT ${limit}
      `))
      .map((r) => this._mapTrigger(r));
  }

  /**
   * Aggregate guardrail trigger stats for compliance report.
   * Joins with guardrail_rules to get condition_type and action_type.
   */
  async getTriggerStats(
    tenantId: string,
    from: string,
    to: string,
  ): Promise<{ total: number; byConditionType: Record<string, number>; byActionType: Record<string, number> }> {
    // Get total triggers in range
    const totalRow = await dbGet<{ count: number }>(this.db, sql`
      SELECT COUNT(*) as count FROM guardrail_trigger_history
      WHERE tenant_id = ${tenantId}
        AND triggered_at >= ${from}
        AND triggered_at <= ${to}
    `);
    const total = Number(totalRow?.count ?? 0);

    // Get breakdown by condition_type (via JOIN with rules)
    const conditionRows = await dbAll<{ condition_type: string; count: number }>(this.db, sql`
      SELECT r.condition_type, COUNT(*) as count
      FROM guardrail_trigger_history h
      JOIN guardrail_rules r ON h.rule_id = r.id AND h.tenant_id = r.tenant_id
      WHERE h.tenant_id = ${tenantId}
        AND h.triggered_at >= ${from}
        AND h.triggered_at <= ${to}
      GROUP BY r.condition_type
    `);
    const byConditionType: Record<string, number> = {};
    for (const row of conditionRows) {
      byConditionType[row.condition_type] = Number(row.count);
    }

    // Get breakdown by action_type (via JOIN with rules)
    const actionRows = await dbAll<{ action_type: string; count: number }>(this.db, sql`
      SELECT r.action_type, COUNT(*) as count
      FROM guardrail_trigger_history h
      JOIN guardrail_rules r ON h.rule_id = r.id AND h.tenant_id = r.tenant_id
      WHERE h.tenant_id = ${tenantId}
        AND h.triggered_at >= ${from}
        AND h.triggered_at <= ${to}
      GROUP BY r.action_type
    `);
    const byActionType: Record<string, number> = {};
    for (const row of actionRows) {
      byActionType[row.action_type] = Number(row.count);
    }

    return { total, byConditionType, byActionType };
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
      // Feature 8 fields:
      direction: (row['direction'] as GuardrailRule['direction']) || 'both',
      toolNames: row['tool_names'] ? JSON.parse(row['tool_names'] as string) : undefined,
      priority: (row['priority'] as number) ?? 0,
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
