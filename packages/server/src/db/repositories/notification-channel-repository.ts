/**
 * Notification Channel repository — CRUD for notification channels and log.
 * Feature 12 — Story 12.1. Dialect-agnostic (#172): raw SQL routed through the
 * dialect-db helpers so it runs on both SQLite and Postgres. The one divergence
 * is `enabled` — INTEGER on sqlite, boolean on pg — bound/read per-dialect.
 */

import { sql, type SQL } from 'drizzle-orm';
import type { NotificationChannel, NotificationLogEntry } from '@agentkitai/agentlens-core';
import { type AnyDb, isSqliteDb, dbRun, dbAll, dbGet, dbRunCount } from '../dialect-db.js';
import { NotFoundError } from '../errors.js';

interface ChannelRow {
  id: string;
  tenant_id: string;
  type: string;
  name: string;
  config: string;
  enabled: number | boolean;
  created_at: string;
  updated_at: string;
}

interface LogRow {
  id: string;
  tenant_id: string;
  channel_id: string;
  rule_id: string | null;
  rule_type: string | null;
  status: string;
  attempt: number;
  error_message: string | null;
  payload_summary: string | null;
  created_at: string;
}

export class NotificationChannelRepository {
  constructor(private db: AnyDb) {}

  /** sqlite cannot bind a JS boolean (needs 0/1); pg needs a real boolean. */
  private enabledParam(v: boolean): number | boolean {
    return isSqliteDb(this.db) ? (v ? 1 : 0) : v;
  }

  async createChannel(channel: NotificationChannel): Promise<void> {
    await dbRun(this.db, sql`
      INSERT INTO notification_channels (id, tenant_id, type, name, config, enabled, created_at, updated_at)
      VALUES (
        ${channel.id}, ${channel.tenantId}, ${channel.type}, ${channel.name},
        ${JSON.stringify(channel.config)}, ${this.enabledParam(channel.enabled)},
        ${channel.createdAt}, ${channel.updatedAt}
      )
    `);
  }

  async getChannel(id: string, tenantId?: string): Promise<NotificationChannel | null> {
    const row = await dbGet<ChannelRow>(
      this.db,
      tenantId
        ? sql`SELECT * FROM notification_channels WHERE id = ${id} AND tenant_id = ${tenantId}`
        : sql`SELECT * FROM notification_channels WHERE id = ${id}`,
    );
    return row ? this.mapRow(row) : null;
  }

  async listChannels(tenantId?: string): Promise<NotificationChannel[]> {
    const rows = await dbAll<ChannelRow>(
      this.db,
      tenantId
        ? sql`SELECT * FROM notification_channels WHERE tenant_id = ${tenantId}`
        : sql`SELECT * FROM notification_channels`,
    );
    return rows.map((r) => this.mapRow(r));
  }

  async updateChannel(id: string, updates: Partial<NotificationChannel>, tenantId?: string): Promise<void> {
    const sets: SQL[] = [];
    if (updates.name !== undefined) sets.push(sql`name = ${updates.name}`);
    if (updates.config !== undefined) sets.push(sql`config = ${JSON.stringify(updates.config)}`);
    if (updates.enabled !== undefined) sets.push(sql`enabled = ${this.enabledParam(updates.enabled)}`);
    if (updates.updatedAt !== undefined) sets.push(sql`updated_at = ${updates.updatedAt}`);
    if (sets.length === 0) return;

    const where = tenantId ? sql`id = ${id} AND tenant_id = ${tenantId}` : sql`id = ${id}`;
    const changed = await dbRunCount(
      this.db,
      sql`UPDATE notification_channels SET ${sql.join(sets, sql`, `)} WHERE ${where}`,
    );
    if (changed === 0) {
      throw new NotFoundError(`Notification channel not found: ${id}`);
    }
  }

  async deleteChannel(id: string, tenantId?: string): Promise<void> {
    const changed = await dbRunCount(
      this.db,
      tenantId
        ? sql`DELETE FROM notification_channels WHERE id = ${id} AND tenant_id = ${tenantId}`
        : sql`DELETE FROM notification_channels WHERE id = ${id}`,
    );
    if (changed === 0) {
      throw new NotFoundError(`Notification channel not found: ${id}`);
    }
  }

  // ─── Notification Log ─────────────────────────────────────

  async insertLog(entry: NotificationLogEntry): Promise<void> {
    await dbRun(this.db, sql`
      INSERT INTO notification_log (id, tenant_id, channel_id, rule_id, rule_type, status, attempt, error_message, payload_summary, created_at)
      VALUES (
        ${entry.id}, ${entry.tenantId}, ${entry.channelId}, ${entry.ruleId ?? null}, ${entry.ruleType ?? null},
        ${entry.status}, ${entry.attempt}, ${entry.errorMessage ?? null}, ${entry.payloadSummary ?? null}, ${entry.createdAt}
      )
    `);
  }

  async listLog(opts?: {
    tenantId?: string;
    channelId?: string;
    ruleId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: NotificationLogEntry[]; total: number }> {
    const limit = Math.min(opts?.limit ?? 50, 500);
    const offset = opts?.offset ?? 0;

    const conds: SQL[] = [];
    if (opts?.tenantId) conds.push(sql`tenant_id = ${opts.tenantId}`);
    if (opts?.channelId) conds.push(sql`channel_id = ${opts.channelId}`);
    if (opts?.ruleId) conds.push(sql`rule_id = ${opts.ruleId}`);
    const where = conds.length > 0 ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;

    const rows = await dbAll<LogRow>(
      this.db,
      sql`SELECT * FROM notification_log ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    );
    const totalRow = await dbGet<{ count: number }>(
      this.db,
      sql`SELECT COUNT(*) as count FROM notification_log ${where}`,
    );

    return {
      entries: rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        channelId: row.channel_id,
        ruleId: row.rule_id ?? undefined,
        ruleType: row.rule_type as NotificationLogEntry['ruleType'],
        status: row.status as NotificationLogEntry['status'],
        attempt: row.attempt,
        errorMessage: row.error_message ?? undefined,
        payloadSummary: row.payload_summary ?? undefined,
        createdAt: row.created_at,
      })),
      total: Number(totalRow?.count ?? 0),
    };
  }

  private mapRow(row: ChannelRow): NotificationChannel {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      type: row.type as NotificationChannel['type'],
      name: row.name,
      config: JSON.parse(row.config) as Record<string, unknown>,
      enabled: Boolean(row.enabled), // sqlite 0/1, pg true/false
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
