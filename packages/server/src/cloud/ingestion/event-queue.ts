/**
 * Event Queue Abstraction (S-3.1)
 *
 * Interface for event ingestion queue with two implementations:
 * - InMemoryEventQueue: for testing and when REDIS_URL is not set
 * - RedisEventQueue: production implementation using Redis Streams
 *
 * Streams: `event_ingestion` (main), `event_ingestion_dlq` (dead letter)
 * Consumer group: `ingestion_workers`
 */

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export interface QueuedEvent {
  /** Unique event ID */
  id: string;
  /** Event type (e.g. 'llm_call', 'tool_use') */
  type: string;
  /** Event timestamp */
  timestamp: string;
  /** Event payload */
  data: Record<string, unknown>;
  /** Session ID */
  session_id: string;
  /** Enrichment fields */
  org_id: string;
  api_key_id: string;
  received_at: string;
  request_id: string;
}

export interface QueueHealth {
  healthy: boolean;
  streamLength: number;
  dlqLength: number;
  consumerGroupExists: boolean;
  error?: string;
}

export interface EventQueue {
  /** Initialize the queue (create streams, consumer groups) */
  initialize(): Promise<void>;

  /** Publish a single event to the ingestion stream. Returns stream message ID. */
  publish(event: QueuedEvent): Promise<string>;

  /** Publish multiple events. Returns stream message IDs. */
  publishBatch(events: QueuedEvent[]): Promise<string[]>;

  /** Get stream lengths and health status */
  healthCheck(): Promise<QueueHealth>;

  /** Get main stream length */
  getStreamLength(): Promise<number>;

  /** Get DLQ stream length */
  getDlqLength(): Promise<number>;

  /** Shutdown / cleanup */
  close(): Promise<void>;
}

// ═══════════════════════════════════════════
// Stream names & constants
// ═══════════════════════════════════════════

export const STREAM_NAME = 'event_ingestion';
export const DLQ_STREAM_NAME = 'event_ingestion_dlq';
export const CONSUMER_GROUP = 'ingestion_workers';
export const BACKPRESSURE_THRESHOLD = 100_000;

// ═══════════════════════════════════════════
// In-Memory Implementation (testing / no Redis)
// ═══════════════════════════════════════════

export class InMemoryEventQueue implements EventQueue {
  private stream: Array<{ id: string; event: QueuedEvent }> = [];
  private dlq: Array<{ id: string; event: QueuedEvent; error: string }> = [];
  private initialized = false;
  private counter = 0;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async publish(event: QueuedEvent): Promise<string> {
    if (!this.initialized) throw new Error('Queue not initialized');
    const id = `${Date.now()}-${this.counter++}`;
    this.stream.push({ id, event });
    return id;
  }

  async publishBatch(events: QueuedEvent[]): Promise<string[]> {
    const ids: string[] = [];
    for (const event of events) {
      ids.push(await this.publish(event));
    }
    return ids;
  }

  async healthCheck(): Promise<QueueHealth> {
    return {
      healthy: this.initialized,
      streamLength: this.stream.length,
      dlqLength: this.dlq.length,
      consumerGroupExists: this.initialized,
    };
  }

  async getStreamLength(): Promise<number> {
    return this.stream.length;
  }

  async getDlqLength(): Promise<number> {
    return this.dlq.length;
  }

  async close(): Promise<void> {
    this.initialized = false;
  }

  // ── Test helpers ──

  /** Get all published events */
  getEvents(): QueuedEvent[] {
    return this.stream.map((m) => m.event);
  }

  /** Clear all events */
  clear(): void {
    this.stream = [];
    this.dlq = [];
    this.counter = 0;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }
}

// ═══════════════════════════════════════════
// Redis Implementation
// ═══════════════════════════════════════════

/**
 * Redis Streams implementation. Activated when REDIS_URL is set.
 * Uses ioredis client passed in constructor.
 */
export class RedisEventQueue implements EventQueue {
  private client: RedisClient;

  constructor(client: RedisClient) {
    this.client = client;
  }

  async initialize(): Promise<void> {
    // Create consumer group (creates stream implicitly with MKSTREAM)
    try {
      await this.client.xgroup('CREATE', STREAM_NAME, CONSUMER_GROUP, '0', 'MKSTREAM');
    } catch (err: unknown) {
      // BUSYGROUP = group already exists, safe to ignore
      if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) {
        throw err;
      }
    }

    // Ensure DLQ stream exists
    try {
      await this.client.xgroup('CREATE', DLQ_STREAM_NAME, CONSUMER_GROUP, '0', 'MKSTREAM');
    } catch (err: unknown) {
      if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) {
        throw err;
      }
    }
  }

  async publish(event: QueuedEvent): Promise<string> {
    const id = await this.client.xadd(
      STREAM_NAME,
      '*',
      'payload',
      JSON.stringify(event),
    );
    return id;
  }

  async publishBatch(events: QueuedEvent[]): Promise<string[]> {
    const pipeline = this.client.pipeline();
    for (const event of events) {
      pipeline.xadd(STREAM_NAME, '*', 'payload', JSON.stringify(event));
    }
    const results = await pipeline.exec();
    return (results ?? []).map((r: [Error | null, unknown]) => String(r[1]));
  }

  async healthCheck(): Promise<QueueHealth> {
    try {
      const [streamLen, dlqLen] = await Promise.all([
        this.getStreamLength(),
        this.getDlqLength(),
      ]);

      let consumerGroupExists = false;
      try {
        const groups = await this.client.xinfo('GROUPS', STREAM_NAME) as unknown[];
        consumerGroupExists = Array.isArray(groups) && groups.length > 0;
      } catch {
        // Stream may not exist yet
      }

      return {
        healthy: true,
        streamLength: streamLen,
        dlqLength: dlqLen,
        consumerGroupExists,
      };
    } catch (err: unknown) {
      return {
        healthy: false,
        streamLength: 0,
        dlqLength: 0,
        consumerGroupExists: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getStreamLength(): Promise<number> {
    try {
      return await this.client.xlen(STREAM_NAME);
    } catch {
      return 0;
    }
  }

  async getDlqLength(): Promise<number> {
    try {
      return await this.client.xlen(DLQ_STREAM_NAME);
    } catch {
      return 0;
    }
  }

  async close(): Promise<void> {
    // Don't close the client — caller owns it
  }
}

// Minimal Redis client interface (compatible with ioredis)
export interface RedisClient {
  xgroup(...args: unknown[]): Promise<unknown>;
  xadd(...args: unknown[]): Promise<string>;
  xlen(key: string): Promise<number>;
  xinfo(...args: unknown[]): Promise<unknown>;
  pipeline(): RedisPipeline;
}

export interface RedisPipeline {
  xadd(...args: unknown[]): RedisPipeline;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}

// ═══════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════

/**
 * Create the appropriate EventQueue based on environment.
 * If a Redis client is provided, uses Redis Streams.
 * Otherwise, falls back to in-memory.
 */
export function createEventQueue(redisClient?: RedisClient): EventQueue {
  if (redisClient) {
    return new RedisEventQueue(redisClient);
  }
  return new InMemoryEventQueue();
}
