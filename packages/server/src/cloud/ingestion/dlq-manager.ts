/**
 * DLQ Management & Monitoring (S-3.6)
 *
 * Manages the dead-letter queue stream:
 * - Inspect DLQ entries (list with metadata)
 * - Replay events back to the main ingestion stream
 * - Expire old entries (> 7 days)
 * - Report DLQ depth in health checks
 */

import type { EventQueue, QueuedEvent, RedisClient } from './event-queue.js';
import { DLQ_STREAM_NAME, STREAM_NAME } from './event-queue.js';

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export interface DlqEntry {
  /** Redis stream message ID */
  streamId: string;
  /** Original event payload */
  event: QueuedEvent;
  /** Why it was sent to DLQ */
  dlqReason: string;
  /** Original stream ID before DLQ */
  originalStreamId: string;
  /** When it was moved to DLQ */
  dlqTimestamp: string;
}

export interface DlqStats {
  depth: number;
  oldestEntryAge?: number; // seconds
}

export interface DlqHealthInfo {
  dlqDepth: number;
  dlqHealthy: boolean;
  dlqWarning?: string;
}

/** DLQ expiry — 7 days in milliseconds */
const DLQ_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// ═══════════════════════════════════════════
// DLQ Manager (Redis-backed)
// ═══════════════════════════════════════════

/** Extended Redis client for DLQ operations */
export interface DlqRedisClient extends RedisClient {
  xrange(key: string, start: string, end: string, ...args: unknown[]): Promise<Array<[string, string[]]>>;
  xdel(key: string, ...ids: string[]): Promise<number>;
  xadd(...args: unknown[]): Promise<string>;
  xlen(key: string): Promise<number>;
}

export class DlqManager {
  constructor(private redis: DlqRedisClient) {}

  /**
   * Get DLQ depth (number of entries).
   */
  async getDepth(): Promise<number> {
    try {
      return await this.redis.xlen(DLQ_STREAM_NAME);
    } catch {
      return 0;
    }
  }

  /**
   * List DLQ entries, optionally with pagination.
   * @param limit Max entries to return (default 50)
   * @param startId Stream ID to start from (default '-' = beginning)
   */
  async listEntries(limit = 50, startId = '-'): Promise<DlqEntry[]> {
    const raw = await this.redis.xrange(DLQ_STREAM_NAME, startId, '+', 'COUNT', limit);
    return raw.map(([streamId, fields]) => this.parseEntry(streamId, fields));
  }

  /**
   * Get a single DLQ entry by stream ID.
   */
  async getEntry(streamId: string): Promise<DlqEntry | null> {
    const raw = await this.redis.xrange(DLQ_STREAM_NAME, streamId, streamId, 'COUNT', 1);
    if (raw.length === 0) return null;
    return this.parseEntry(raw[0][0], raw[0][1]);
  }

  /**
   * Replay a single DLQ entry back to the main ingestion stream.
   * Removes the entry from DLQ after successful re-queue.
   */
  async replayEntry(streamId: string): Promise<{ success: boolean; newStreamId?: string; error?: string }> {
    const entry = await this.getEntry(streamId);
    if (!entry) {
      return { success: false, error: 'Entry not found in DLQ' };
    }

    // Re-publish to main stream (strip DLQ metadata)
    const cleanEvent = { ...entry.event };
    // Remove internal DLQ fields from data if present
    const cleanData = { ...cleanEvent.data };
    delete (cleanData as Record<string, unknown>)._dlq_reason;
    delete (cleanData as Record<string, unknown>)._dlq_stream_id;
    delete (cleanData as Record<string, unknown>)._dlq_timestamp;
    cleanEvent.data = cleanData;

    const payload = JSON.stringify(cleanEvent);
    const newId = await this.redis.xadd(STREAM_NAME, '*', 'payload', payload);

    // Remove from DLQ
    await this.redis.xdel(DLQ_STREAM_NAME, streamId);

    return { success: true, newStreamId: newId };
  }

  /**
   * Replay multiple DLQ entries. Returns count of successfully replayed.
   */
  async replayBatch(streamIds: string[]): Promise<{ replayed: number; failed: number; errors: string[] }> {
    let replayed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const id of streamIds) {
      const result = await this.replayEntry(id);
      if (result.success) {
        replayed++;
      } else {
        failed++;
        errors.push(`${id}: ${result.error}`);
      }
    }

    return { replayed, failed, errors };
  }

  /**
   * Expire DLQ entries older than 7 days.
   * Returns count of expired entries.
   */
  async expireOldEntries(): Promise<number> {
    const cutoffTime = Date.now() - DLQ_EXPIRY_MS;
    // Redis stream IDs are timestamp-based: "timestamp-seq"
    const cutoffId = `${cutoffTime}-0`;

    // Get all entries older than cutoff
    const old = await this.redis.xrange(DLQ_STREAM_NAME, '-', cutoffId, 'COUNT', 1000);
    if (old.length === 0) return 0;

    const ids = old.map(([id]) => id);
    const deleted = await this.redis.xdel(DLQ_STREAM_NAME, ...ids);
    return deleted;
  }

  /**
   * Get DLQ health info for inclusion in health check response.
   */
  async healthInfo(): Promise<DlqHealthInfo> {
    const depth = await this.getDepth();
    const WARNING_THRESHOLD = 1000;

    return {
      dlqDepth: depth,
      dlqHealthy: depth < WARNING_THRESHOLD,
      dlqWarning: depth >= WARNING_THRESHOLD
        ? `DLQ depth (${depth}) exceeds warning threshold (${WARNING_THRESHOLD})`
        : undefined,
    };
  }

  // ── Private ──

  private parseEntry(streamId: string, fields: string[]): DlqEntry {
    const payloadIdx = fields.indexOf('payload');
    let parsed: Record<string, unknown> = {};
    if (payloadIdx !== -1 && payloadIdx + 1 < fields.length) {
      try {
        parsed = JSON.parse(fields[payloadIdx + 1]);
      } catch {
        // unparseable
      }
    }

    const dlqReason = (parsed._dlq_reason as string) ?? 'unknown';
    const originalStreamId = (parsed._dlq_stream_id as string) ?? '';
    const dlqTimestamp = (parsed._dlq_timestamp as string) ?? '';

    // Strip DLQ metadata from the event
    const eventData = { ...(parsed as Record<string, unknown>) };
    delete eventData._dlq_reason;
    delete eventData._dlq_stream_id;
    delete eventData._dlq_timestamp;

    return {
      streamId,
      event: eventData as unknown as QueuedEvent,
      dlqReason,
      originalStreamId,
      dlqTimestamp,
    };
  }
}

// ═══════════════════════════════════════════
// In-Memory DLQ Manager (for testing)
// ═══════════════════════════════════════════

export interface InMemoryDlqEntry {
  streamId: string;
  payload: Record<string, unknown>;
  addedAt: number; // timestamp ms
}

export class InMemoryDlqManager {
  private entries: InMemoryDlqEntry[] = [];
  private replayedToMain: Array<Record<string, unknown>> = [];
  private counter = 0;

  /** Add an entry to the in-memory DLQ */
  addEntry(event: QueuedEvent, reason: string, originalStreamId: string): string {
    const streamId = `${Date.now()}-${this.counter++}`;
    this.entries.push({
      streamId,
      payload: {
        ...event,
        _dlq_reason: reason,
        _dlq_stream_id: originalStreamId,
        _dlq_timestamp: new Date().toISOString(),
      },
      addedAt: Date.now(),
    });
    return streamId;
  }

  async getDepth(): Promise<number> {
    return this.entries.length;
  }

  async listEntries(limit = 50): Promise<DlqEntry[]> {
    return this.entries.slice(0, limit).map((e) => this.toEntry(e));
  }

  async getEntry(streamId: string): Promise<DlqEntry | null> {
    const found = this.entries.find((e) => e.streamId === streamId);
    return found ? this.toEntry(found) : null;
  }

  async replayEntry(streamId: string): Promise<{ success: boolean; newStreamId?: string; error?: string }> {
    const idx = this.entries.findIndex((e) => e.streamId === streamId);
    if (idx === -1) return { success: false, error: 'Entry not found in DLQ' };

    const entry = this.entries[idx];
    const clean = { ...entry.payload };
    delete clean._dlq_reason;
    delete clean._dlq_stream_id;
    delete clean._dlq_timestamp;

    this.replayedToMain.push(clean);
    this.entries.splice(idx, 1);

    return { success: true, newStreamId: `${Date.now()}-replayed-${this.counter++}` };
  }

  async replayBatch(streamIds: string[]): Promise<{ replayed: number; failed: number; errors: string[] }> {
    let replayed = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const id of streamIds) {
      const r = await this.replayEntry(id);
      if (r.success) replayed++;
      else { failed++; errors.push(`${id}: ${r.error}`); }
    }
    return { replayed, failed, errors };
  }

  async expireOldEntries(expiryMs = DLQ_EXPIRY_MS): Promise<number> {
    const cutoff = Date.now() - expiryMs;
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.addedAt > cutoff);
    return before - this.entries.length;
  }

  async healthInfo(): Promise<DlqHealthInfo> {
    const depth = this.entries.length;
    return {
      dlqDepth: depth,
      dlqHealthy: depth < 1000,
      dlqWarning: depth >= 1000 ? `DLQ depth (${depth}) exceeds warning threshold` : undefined,
    };
  }

  /** Test helper: get replayed events */
  getReplayed(): Array<Record<string, unknown>> {
    return [...this.replayedToMain];
  }

  /** Test helper: clear all */
  clear(): void {
    this.entries = [];
    this.replayedToMain = [];
    this.counter = 0;
  }

  private toEntry(e: InMemoryDlqEntry): DlqEntry {
    const p = e.payload;
    const clean = { ...p };
    delete clean._dlq_reason;
    delete clean._dlq_stream_id;
    delete clean._dlq_timestamp;
    return {
      streamId: e.streamId,
      event: clean as unknown as QueuedEvent,
      dlqReason: (p._dlq_reason as string) ?? 'unknown',
      originalStreamId: (p._dlq_stream_id as string) ?? '',
      dlqTimestamp: (p._dlq_timestamp as string) ?? '',
    };
  }
}
