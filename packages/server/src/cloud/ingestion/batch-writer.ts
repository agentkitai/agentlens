/**
 * Batch Writer — Queue Worker (S-3.3)
 *
 * Consumer group workers: XREADGROUP up to 50 messages from the
 * `event_ingestion` stream, enrich (cost calculation, hash chain),
 * batch INSERT into Postgres, XACK on success. After 3 failures → DLQ.
 */

import { createHash } from 'crypto';
import type { QueuedEvent, RedisClient } from './event-queue.js';
import { STREAM_NAME, DLQ_STREAM_NAME, CONSUMER_GROUP } from './event-queue.js';
import type { Pool } from '../tenant-pool.js';

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export interface StreamMessage {
  /** Redis stream message ID (e.g. "1234567890-0") */
  streamId: string;
  /** Parsed event payload */
  event: QueuedEvent;
}

export interface BatchWriterConfig {
  /** Consumer name (unique per worker instance) */
  consumerName: string;
  /** Max messages per XREADGROUP call (default: 50) */
  batchSize?: number;
  /** Block timeout in ms for XREADGROUP (default: 5000) */
  blockMs?: number;
  /** Max retries before DLQ (default: 3) */
  maxRetries?: number;
}

export interface WriterStats {
  processed: number;
  failed: number;
  dlqd: number;
}

/** Extended Redis client interface for consumer operations */
export interface ConsumerRedisClient extends RedisClient {
  xreadgroup(
    ...args: unknown[]
  ): Promise<Array<[string, Array<[string, string[]]>]> | null>;
  xack(...args: unknown[]): Promise<number>;
  xadd(...args: unknown[]): Promise<string>;
}

// ═══════════════════════════════════════════
// Cost Calculation
// ═══════════════════════════════════════════

/** Known model pricing (per 1K tokens) */
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  'claude-3.5-sonnet': { input: 0.003, output: 0.015 },
  'claude-4-opus': { input: 0.015, output: 0.075 },
  'claude-4-sonnet': { input: 0.003, output: 0.015 },
};

/**
 * Calculate cost for an LLM call event.
 * Returns cost in USD or null if not calculable.
 */
export function calculateCost(event: QueuedEvent): number | null {
  if (event.type !== 'llm_call') return null;

  const data = event.data;
  const model = (data.model as string) ?? '';
  const inputTokens = (data.input_tokens as number) ?? (data.prompt_tokens as number) ?? 0;
  const outputTokens = (data.output_tokens as number) ?? (data.completion_tokens as number) ?? 0;

  // Find matching model (prefix match for versioned names)
  let pricing: { input: number; output: number } | undefined;
  for (const [key, cost] of Object.entries(MODEL_COSTS)) {
    if (model === key || model.startsWith(key + '-')) {
      pricing = cost;
      break;
    }
  }

  if (!pricing) return null;
  if (inputTokens === 0 && outputTokens === 0) return null;

  return (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
}

// ═══════════════════════════════════════════
// Hash Chain
// ═══════════════════════════════════════════

/**
 * Compute hash for event in the hash chain.
 * hash = SHA-256(previousHash + event.id + event.type + event.timestamp)
 */
export function computeHash(event: QueuedEvent, previousHash: string): string {
  const content = `${previousHash}:${event.id}:${event.type}:${event.timestamp}`;
  return createHash('sha256').update(content).digest('hex');
}

// ═══════════════════════════════════════════
// Batch Writer
// ═══════════════════════════════════════════

export class BatchWriter {
  private config: Required<BatchWriterConfig>;
  private running = false;
  private stats: WriterStats = { processed: 0, failed: 0, dlqd: 0 };
  /** Retry counts by stream message ID */
  private retryCounts = new Map<string, number>();
  /** Last hash per org for hash chain continuity */
  private lastHashByOrg = new Map<string, string>();

  constructor(
    private redis: ConsumerRedisClient,
    private pool: Pool,
    config: BatchWriterConfig,
  ) {
    this.config = {
      consumerName: config.consumerName,
      batchSize: config.batchSize ?? 50,
      blockMs: config.blockMs ?? 5000,
      maxRetries: config.maxRetries ?? 3,
    };
  }

  /** Start the worker loop */
  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      await this.processBatch();
    }
  }

  /** Stop the worker loop */
  stop(): void {
    this.running = false;
  }

  /** Get current stats */
  getStats(): WriterStats {
    return { ...this.stats };
  }

  /**
   * Process a single batch: XREADGROUP → enrich → INSERT → XACK.
   * Exposed for testing.
   */
  async processBatch(): Promise<number> {
    const messages = await this.readMessages();
    if (messages.length === 0) return 0;

    // Enrich all messages
    const enriched = this.enrichMessages(messages);

    // Group by org_id for batch insert
    const byOrg = new Map<string, Array<{ streamId: string; event: QueuedEvent }>>();
    for (const msg of enriched) {
      const orgEvents = byOrg.get(msg.event.org_id) ?? [];
      orgEvents.push(msg);
      byOrg.set(msg.event.org_id, orgEvents);
    }

    const ackedIds: string[] = [];
    const failedMsgs: StreamMessage[] = [];

    for (const [orgId, orgMessages] of byOrg) {
      try {
        await this.batchInsert(orgId, orgMessages.map((m) => m.event));
        ackedIds.push(...orgMessages.map((m) => m.streamId));
        this.stats.processed += orgMessages.length;
      } catch {
        failedMsgs.push(...orgMessages);
      }
    }

    // ACK successful messages
    if (ackedIds.length > 0) {
      await this.ackMessages(ackedIds);
    }

    // Handle failures (retry or DLQ)
    for (const msg of failedMsgs) {
      const retries = (this.retryCounts.get(msg.streamId) ?? 0) + 1;
      this.retryCounts.set(msg.streamId, retries);

      if (retries >= this.config.maxRetries) {
        await this.moveToDlq(msg);
        await this.ackMessages([msg.streamId]);
        this.retryCounts.delete(msg.streamId);
        this.stats.dlqd++;
      } else {
        this.stats.failed++;
      }
    }

    return messages.length;
  }

  // ── Private methods ──

  private async readMessages(): Promise<StreamMessage[]> {
    const result = await this.redis.xreadgroup(
      'GROUP', CONSUMER_GROUP, this.config.consumerName,
      'COUNT', this.config.batchSize,
      'BLOCK', this.config.blockMs,
      'STREAMS', STREAM_NAME, '>',
    );

    if (!result || result.length === 0) return [];

    const messages: StreamMessage[] = [];
    for (const [, entries] of result) {
      for (const [streamId, fields] of entries) {
        // fields is [key, value, key, value, ...]
        const payloadIdx = fields.indexOf('payload');
        if (payloadIdx === -1 || payloadIdx + 1 >= fields.length) continue;
        try {
          const event = JSON.parse(fields[payloadIdx + 1]) as QueuedEvent;
          messages.push({ streamId, event });
        } catch {
          // Unparseable message → DLQ immediately
          await this.moveToDlq({ streamId, event: { id: 'unknown', type: 'unknown', timestamp: '', session_id: '', data: {}, org_id: '', api_key_id: '', received_at: '', request_id: '' } });
          await this.ackMessages([streamId]);
        }
      }
    }

    return messages;
  }

  private enrichMessages(messages: StreamMessage[]): StreamMessage[] {
    for (const msg of messages) {
      // Cost calculation
      const cost = calculateCost(msg.event);
      if (cost !== null) {
        msg.event.data = { ...msg.event.data, estimated_cost_usd: cost };
      }

      // Hash chain — persist both prev_hash and hash for verifiability
      const prevHash = this.lastHashByOrg.get(msg.event.org_id) ?? '0';
      const hash = computeHash(msg.event, prevHash);
      msg.event.data = { ...msg.event.data, prev_hash: prevHash, hash };
      this.lastHashByOrg.set(msg.event.org_id, hash);
    }
    return messages;
  }

  private async batchInsert(orgId: string, events: QueuedEvent[]): Promise<void> {
    if (events.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL app.current_org = $1', [orgId]);

      // Build batch INSERT
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let paramIdx = 1;

      for (const event of events) {
        placeholders.push(
          `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`,
        );
        values.push(
          event.id,
          orgId,
          event.session_id,
          event.data.agent_id ?? 'unknown',
          event.type,
          event.data.severity ?? 'info',
          event.timestamp,
          JSON.stringify(event.data),
          event.data.prev_hash ?? null,
          event.data.hash ?? null,
        );
      }

      await client.query(
        `INSERT INTO events (id, org_id, session_id, agent_id, event_type, severity, timestamp, payload, prev_hash, hash)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (id, timestamp) DO NOTHING`,
        values,
      );

      // Update usage records (atomic increment)
      const hour = new Date(events[0].timestamp);
      hour.setMinutes(0, 0, 0);

      await client.query(
        `INSERT INTO usage_records (org_id, hour, event_count, api_key_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (org_id, hour, api_key_id)
         DO UPDATE SET event_count = usage_records.event_count + $3`,
        [orgId, hour.toISOString(), events.length, events[0].api_key_id || '00000000-0000-0000-0000-000000000000'],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async ackMessages(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.redis.xack(STREAM_NAME, CONSUMER_GROUP, ...ids);
  }

  private async moveToDlq(msg: StreamMessage): Promise<void> {
    const payload = JSON.stringify({
      ...msg.event,
      _dlq_reason: 'max_retries_exceeded',
      _dlq_stream_id: msg.streamId,
      _dlq_timestamp: new Date().toISOString(),
    });
    await this.redis.xadd(DLQ_STREAM_NAME, '*', 'payload', payload);
  }
}

// ═══════════════════════════════════════════
// In-Memory Batch Writer (for testing)
// ═══════════════════════════════════════════

export interface InMemoryBatchWriterDeps {
  /** Events available for consumption */
  pendingEvents: Array<{ streamId: string; event: QueuedEvent }>;
  /** Acknowledged stream IDs */
  ackedIds: string[];
  /** DLQ entries */
  dlqEvents: QueuedEvent[];
  /** Inserted events (grouped by org) */
  insertedEvents: Map<string, QueuedEvent[]>;
  /** Usage increments */
  usageIncrements: Array<{ orgId: string; count: number }>;
  /** Simulate DB failure for these org IDs */
  failingOrgs?: Set<string>;
}

/**
 * In-memory batch writer for testing without Redis/Postgres.
 */
export class InMemoryBatchWriter {
  private stats: WriterStats = { processed: 0, failed: 0, dlqd: 0 };
  private retryCounts = new Map<string, number>();
  private lastHashByOrg = new Map<string, string>();
  private maxRetries: number;
  private batchSize: number;

  constructor(
    private deps: InMemoryBatchWriterDeps,
    config?: { maxRetries?: number; batchSize?: number },
  ) {
    this.maxRetries = config?.maxRetries ?? 3;
    this.batchSize = config?.batchSize ?? 50;
  }

  getStats(): WriterStats {
    return { ...this.stats };
  }

  /**
   * Process one batch from pendingEvents.
   */
  async processBatch(): Promise<number> {
    const batch = this.deps.pendingEvents.splice(0, this.batchSize);
    if (batch.length === 0) return 0;

    // Enrich
    for (const msg of batch) {
      const cost = calculateCost(msg.event);
      if (cost !== null) {
        msg.event.data = { ...msg.event.data, estimated_cost_usd: cost };
      }
      const prevHash = this.lastHashByOrg.get(msg.event.org_id) ?? '0';
      const hash = computeHash(msg.event, prevHash);
      msg.event.data = { ...msg.event.data, hash };
      this.lastHashByOrg.set(msg.event.org_id, hash);
    }

    // Group by org
    const byOrg = new Map<string, Array<{ streamId: string; event: QueuedEvent }>>();
    for (const msg of batch) {
      const list = byOrg.get(msg.event.org_id) ?? [];
      list.push(msg);
      byOrg.set(msg.event.org_id, list);
    }

    const failedMsgs: Array<{ streamId: string; event: QueuedEvent }> = [];

    for (const [orgId, orgMsgs] of byOrg) {
      if (this.deps.failingOrgs?.has(orgId)) {
        failedMsgs.push(...orgMsgs);
        continue;
      }

      // "Insert"
      const existing = this.deps.insertedEvents.get(orgId) ?? [];
      existing.push(...orgMsgs.map((m) => m.event));
      this.deps.insertedEvents.set(orgId, existing);

      // Usage
      this.deps.usageIncrements.push({ orgId, count: orgMsgs.length });

      // ACK
      this.deps.ackedIds.push(...orgMsgs.map((m) => m.streamId));
      this.stats.processed += orgMsgs.length;
    }

    // Handle failures
    for (const msg of failedMsgs) {
      const retries = (this.retryCounts.get(msg.streamId) ?? 0) + 1;
      this.retryCounts.set(msg.streamId, retries);

      if (retries >= this.maxRetries) {
        this.deps.dlqEvents.push(msg.event);
        this.deps.ackedIds.push(msg.streamId);
        this.retryCounts.delete(msg.streamId);
        this.stats.dlqd++;
        // Re-add to pending won't happen; it's DLQ'd
      } else {
        this.stats.failed++;
        // Re-add to pending for retry
        this.deps.pendingEvents.push(msg);
      }
    }

    return batch.length;
  }
}
