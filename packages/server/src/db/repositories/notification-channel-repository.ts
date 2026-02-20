/**
 * Notification Channel repository — CRUD for notification channels and log.
 * Feature 12 — Story 12.1
 */

import { eq, and, desc, count as drizzleCount } from 'drizzle-orm';
import type { NotificationChannel, NotificationLogEntry } from '@agentlensai/core';
import type { SqliteDb } from '../index.js';
import { notificationChannels, notificationLog } from '../schema.sqlite.js';
import { NotFoundError } from '../errors.js';

export class NotificationChannelRepository {
  constructor(private db: SqliteDb) {}

  async createChannel(channel: NotificationChannel): Promise<void> {
    this.db
      .insert(notificationChannels)
      .values({
        id: channel.id,
        tenantId: channel.tenantId,
        type: channel.type,
        name: channel.name,
        config: JSON.stringify(channel.config),
        enabled: channel.enabled,
        createdAt: channel.createdAt,
        updatedAt: channel.updatedAt,
      })
      .run();
  }

  async getChannel(id: string, tenantId?: string): Promise<NotificationChannel | null> {
    const conditions = [eq(notificationChannels.id, id)];
    if (tenantId) conditions.push(eq(notificationChannels.tenantId, tenantId));

    const row = this.db
      .select()
      .from(notificationChannels)
      .where(and(...conditions))
      .get();

    return row ? this.mapRow(row) : null;
  }

  async listChannels(tenantId?: string): Promise<NotificationChannel[]> {
    const conditions = tenantId ? [eq(notificationChannels.tenantId, tenantId)] : [];
    const rows = this.db
      .select()
      .from(notificationChannels)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .all();
    return rows.map(this.mapRow);
  }

  async updateChannel(id: string, updates: Partial<NotificationChannel>, tenantId?: string): Promise<void> {
    const setValues: Record<string, unknown> = {};
    if (updates.name !== undefined) setValues.name = updates.name;
    if (updates.config !== undefined) setValues.config = JSON.stringify(updates.config);
    if (updates.enabled !== undefined) setValues.enabled = updates.enabled;
    if (updates.updatedAt !== undefined) setValues.updatedAt = updates.updatedAt;

    const conditions = [eq(notificationChannels.id, id)];
    if (tenantId) conditions.push(eq(notificationChannels.tenantId, tenantId));

    if (Object.keys(setValues).length === 0) return;

    const result = this.db
      .update(notificationChannels)
      .set(setValues)
      .where(and(...conditions))
      .run();

    if (result.changes === 0) {
      throw new NotFoundError(`Notification channel not found: ${id}`);
    }
  }

  async deleteChannel(id: string, tenantId?: string): Promise<void> {
    const conditions = [eq(notificationChannels.id, id)];
    if (tenantId) conditions.push(eq(notificationChannels.tenantId, tenantId));

    const result = this.db.delete(notificationChannels).where(and(...conditions)).run();
    if (result.changes === 0) {
      throw new NotFoundError(`Notification channel not found: ${id}`);
    }
  }

  // ─── Notification Log ─────────────────────────────────────

  async insertLog(entry: NotificationLogEntry): Promise<void> {
    this.db
      .insert(notificationLog)
      .values({
        id: entry.id,
        tenantId: entry.tenantId,
        channelId: entry.channelId,
        ruleId: entry.ruleId ?? null,
        ruleType: entry.ruleType ?? null,
        status: entry.status,
        attempt: entry.attempt,
        errorMessage: entry.errorMessage ?? null,
        payloadSummary: entry.payloadSummary ?? null,
        createdAt: entry.createdAt,
      })
      .run();
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

    const conditions = [];
    if (opts?.tenantId) conditions.push(eq(notificationLog.tenantId, opts.tenantId));
    if (opts?.channelId) conditions.push(eq(notificationLog.channelId, opts.channelId));
    if (opts?.ruleId) conditions.push(eq(notificationLog.ruleId, opts.ruleId));

    const rows = this.db
      .select()
      .from(notificationLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(notificationLog.createdAt))
      .limit(limit)
      .offset(offset)
      .all();

    const totalResult = this.db
      .select({ count: drizzleCount() })
      .from(notificationLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .get();

    return {
      entries: rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        channelId: row.channelId,
        ruleId: row.ruleId ?? undefined,
        ruleType: row.ruleType as NotificationLogEntry['ruleType'],
        status: row.status as NotificationLogEntry['status'],
        attempt: row.attempt,
        errorMessage: row.errorMessage ?? undefined,
        payloadSummary: row.payloadSummary ?? undefined,
        createdAt: row.createdAt,
      })),
      total: totalResult?.count ?? 0,
    };
  }

  private mapRow(row: typeof notificationChannels.$inferSelect): NotificationChannel {
    return {
      id: row.id,
      tenantId: row.tenantId,
      type: row.type as NotificationChannel['type'],
      name: row.name,
      config: JSON.parse(row.config) as Record<string, unknown>,
      enabled: row.enabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
