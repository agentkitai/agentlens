/**
 * Background Embedding Worker (Story 2.3)
 *
 * Processes an in-memory queue of records to embed. Fail-safe — never crashes
 * the server. If embedding service is not configured, silently skips all items.
 */

import type { EmbeddingService } from './index.js';
import type { EmbeddingStore } from '../../db/embedding-store.js';

/** Item to be embedded */
export interface EmbeddingQueueItem {
  tenantId: string;
  sourceType: string;
  sourceId: string;
  textContent: string;
}

/** Default maximum queue size */
const DEFAULT_MAX_QUEUE_SIZE = 10_000;

/** Maximum items to process per tick */
const BATCH_SIZE = 32;

/** Processing interval in milliseconds */
const TICK_INTERVAL_MS = 1_000;

export class EmbeddingWorker {
  private queue: EmbeddingQueueItem[] = [];
  private processedCount = 0;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly maxQueueSize: number;

  constructor(
    private readonly embeddingService: EmbeddingService | null,
    private readonly embeddingStore: EmbeddingStore | null,
    opts?: { maxQueueSize?: number },
  ) {
    this.maxQueueSize = opts?.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  }

  /**
   * Add an item to the embedding queue. Synchronous — never throws.
   * If the queue is full, drops the oldest items to make room.
   */
  enqueue(item: EmbeddingQueueItem): void {
    // Silently skip if service is not configured
    if (!this.embeddingService || !this.embeddingStore) return;

    this.queue.push(item);

    // Drop oldest on overflow
    if (this.queue.length > this.maxQueueSize) {
      const overflow = this.queue.length - this.maxQueueSize;
      this.queue.splice(0, overflow);
    }
  }

  /**
   * Start the background processing loop (setInterval-based, every 1 second).
   */
  start(): void {
    if (this.intervalHandle !== null) return; // already running
    if (!this.embeddingService || !this.embeddingStore) return; // nothing to do

    this.intervalHandle = setInterval(() => {
      void this.processBatch();
    }, TICK_INTERVAL_MS);

    // Prevent the interval from keeping the process alive
    if (typeof this.intervalHandle === 'object' && 'unref' in this.intervalHandle) {
      this.intervalHandle.unref();
    }
  }

  /**
   * Stop the processing loop and flush remaining items.
   */
  async stop(): Promise<void> {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    // Flush remaining
    await this.flush();
  }

  /**
   * Process all queued items immediately.
   */
  async flush(): Promise<void> {
    while (this.queue.length > 0) {
      await this.processBatch();
    }
  }

  /**
   * Return current queue length.
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Return total number of items successfully processed.
   */
  getProcessedCount(): number {
    return this.processedCount;
  }

  /**
   * Process up to BATCH_SIZE items from the queue.
   */
  private async processBatch(): Promise<void> {
    if (!this.embeddingService || !this.embeddingStore) return;
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, BATCH_SIZE);

    for (const item of batch) {
      try {
        const embedding = await this.embeddingService.embed(item.textContent);
        await this.embeddingStore.store(
          item.tenantId,
          item.sourceType,
          item.sourceId,
          item.textContent,
          embedding,
          this.embeddingService.modelName,
          this.embeddingService.dimensions,
        );
        this.processedCount++;
      } catch (err) {
        // Log and skip — never crash
        console.error(
          `[EmbeddingWorker] Failed to embed item (${item.sourceType}/${item.sourceId}):`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
}
