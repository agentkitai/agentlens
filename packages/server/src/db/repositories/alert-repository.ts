/**
 * Alert repository — CRUD for alert rules and history.
 * Extracted from SqliteEventStore (Story S-7.4).
 */

import { eq, and, desc, count as drizzleCount } from 'drizzle-orm';
import type { AlertRule, AlertHistory } from '@agentlensai/core';
import type { SqliteDb } from '../index.js';
import { alertRules, alertHistory } from '../schema.sqlite.js';
import { NotFoundError } from '../errors.js';
import { mapAlertRuleRow } from '../shared/query-helpers.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('AlertRepository');

export class AlertRepository {
  constructor(private db: SqliteDb) {}

  private warnIfNoTenant(method: string, tenantId?: string): void {
    if (tenantId === undefined) {
      log.warn(
        `${method}() called without tenantId — query is unscoped. ` +
          `Ensure tenant isolation is applied upstream (via TenantScopedStore).`,
      );
    }
  }

  async createAlertRule(rule: AlertRule): Promise<void> {
    this.db
      .insert(alertRules)
      .values({
        id: rule.id,
        name: rule.name,
        enabled: rule.enabled,
        condition: rule.condition,
        threshold: rule.threshold,
        windowMinutes: rule.windowMinutes,
        scope: JSON.stringify(rule.scope),
        notifyChannels: JSON.stringify(rule.notifyChannels),
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt,
        tenantId: rule.tenantId ?? 'default',
      })
      .run();
  }

  async updateAlertRule(
    id: string,
    updates: Partial<AlertRule>,
    tenantId?: string,
  ): Promise<void> {
    const setValues: Record<string, unknown> = {};
    if (updates.name !== undefined) setValues.name = updates.name;
    if (updates.enabled !== undefined) setValues.enabled = updates.enabled;
    if (updates.condition !== undefined) setValues.condition = updates.condition;
    if (updates.threshold !== undefined) setValues.threshold = updates.threshold;
    if (updates.windowMinutes !== undefined) setValues.windowMinutes = updates.windowMinutes;
    if (updates.scope !== undefined) setValues.scope = JSON.stringify(updates.scope);
    if (updates.notifyChannels !== undefined) setValues.notifyChannels = JSON.stringify(updates.notifyChannels);
    if (updates.updatedAt !== undefined) setValues.updatedAt = updates.updatedAt;

    const whereConditions = [eq(alertRules.id, id)];
    if (tenantId) whereConditions.push(eq(alertRules.tenantId, tenantId));

    if (Object.keys(setValues).length === 0) {
      const existing = this.db
        .select({ id: alertRules.id })
        .from(alertRules)
        .where(and(...whereConditions))
        .get();
      if (!existing) {
        throw new NotFoundError(`Alert rule not found: ${id}`);
      }
      return;
    }

    const result = this.db
      .update(alertRules)
      .set(setValues)
      .where(and(...whereConditions))
      .run();

    if (result.changes === 0) {
      throw new NotFoundError(`Alert rule not found: ${id}`);
    }
  }

  async deleteAlertRule(id: string, tenantId?: string): Promise<void> {
    const whereConditions = [eq(alertRules.id, id)];
    if (tenantId) whereConditions.push(eq(alertRules.tenantId, tenantId));

    const result = this.db.delete(alertRules).where(and(...whereConditions)).run();
    if (result.changes === 0) {
      throw new NotFoundError(`Alert rule not found: ${id}`);
    }
  }

  async listAlertRules(tenantId?: string): Promise<AlertRule[]> {
    this.warnIfNoTenant('listAlertRules', tenantId);
    const conditions = tenantId ? [eq(alertRules.tenantId, tenantId)] : [];
    const rows = this.db
      .select()
      .from(alertRules)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .all();
    return rows.map(mapAlertRuleRow);
  }

  async getAlertRule(id: string, tenantId?: string): Promise<AlertRule | null> {
    const conditions = [eq(alertRules.id, id)];
    if (tenantId) conditions.push(eq(alertRules.tenantId, tenantId));

    const row = this.db
      .select()
      .from(alertRules)
      .where(and(...conditions))
      .get();
    return row ? mapAlertRuleRow(row) : null;
  }

  async insertAlertHistory(entry: AlertHistory): Promise<void> {
    this.db
      .insert(alertHistory)
      .values({
        id: entry.id,
        ruleId: entry.ruleId,
        triggeredAt: entry.triggeredAt,
        resolvedAt: entry.resolvedAt ?? null,
        currentValue: entry.currentValue,
        threshold: entry.threshold,
        message: entry.message,
        tenantId: entry.tenantId ?? 'default',
      })
      .run();
  }

  async listAlertHistory(opts?: {
    ruleId?: string;
    limit?: number;
    offset?: number;
    tenantId?: string;
  }): Promise<{ entries: AlertHistory[]; total: number }> {
    const limit = Math.min(opts?.limit ?? 50, 500);
    const offset = opts?.offset ?? 0;

    const conditions = [];
    if (opts?.ruleId) {
      conditions.push(eq(alertHistory.ruleId, opts.ruleId));
    }
    if (opts?.tenantId) {
      conditions.push(eq(alertHistory.tenantId, opts.tenantId));
    }

    const rows = this.db
      .select()
      .from(alertHistory)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(alertHistory.triggeredAt))
      .limit(limit)
      .offset(offset)
      .all();

    const totalResult = this.db
      .select({ count: drizzleCount() })
      .from(alertHistory)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .get();

    return {
      entries: rows.map((row) => ({
        id: row.id,
        ruleId: row.ruleId,
        triggeredAt: row.triggeredAt,
        resolvedAt: row.resolvedAt ?? undefined,
        currentValue: row.currentValue,
        threshold: row.threshold,
        message: row.message,
        tenantId: row.tenantId,
      })),
      total: totalResult?.count ?? 0,
    };
  }
}
