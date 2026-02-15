/**
 * @agentlensai/sdk — Batch Event Sender
 *
 * Queues events and sends them in batches to the AgentLens server,
 * auto-flushing at a size threshold or time interval.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentLensEvent } from '@agentlensai/core';

/** Options accepted by {@link BatchSender}. */
export interface BatchSenderOptions {
  /** Function that sends a batch of events to the server. */
  sendFn: (events: AgentLensEvent[]) => Promise<void>;
  /** Max events per batch (default 100, server max 1000). */
  maxBatchSize?: number;
  /** Periodic flush interval in ms (default 5000). */
  flushIntervalMs?: number;
  /** Max queued events before dropping oldest (default 10000). */
  maxQueueSize?: number;
  /** Called on non-fatal errors (default: console.warn + drop). */
  onError?: (error: Error) => void;
  /** Directory to buffer events on 402 quota exceeded. Reads AGENTLENS_BUFFER_DIR env, falls back to OS temp. */
  bufferDir?: string;
}

export class BatchSender {
  private readonly sendFn: (events: AgentLensEvent[]) => Promise<void>;
  private readonly maxBatchSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxQueueSize: number;
  private readonly onError: (error: Error) => void;
  private readonly bufferDir: string;

  private queue: AgentLensEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing: Promise<void> | null = null;
  private stopped = false;

  constructor(options: BatchSenderOptions) {
    this.sendFn = options.sendFn;
    this.maxBatchSize = options.maxBatchSize ?? 100;
    this.flushIntervalMs = options.flushIntervalMs ?? 5_000;
    this.maxQueueSize = options.maxQueueSize ?? 10_000;
    this.onError = options.onError ?? ((err) => console.warn(`[BatchSender] ${err.message}`));
    this.bufferDir = options.bufferDir ?? process.env.AGENTLENS_BUFFER_DIR ?? tmpdir();

    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    // Don't hold the process open
    if (this.timer && typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref();
    }
  }

  /** Add an event to the queue (non-blocking). */
  enqueue(event: AgentLensEvent): void {
    if (this.stopped) return;

    this.queue.push(event);

    // Drop oldest on overflow
    if (this.queue.length > this.maxQueueSize) {
      const dropped = this.queue.length - this.maxQueueSize;
      this.queue = this.queue.slice(dropped);
      this.onError(new Error(`Queue overflow: dropped ${dropped} oldest event(s)`));
    }

    // Auto-flush at batch size
    if (this.queue.length >= this.maxBatchSize) {
      void this.flush();
    }
  }

  /** Flush current queued events to the server. */
  async flush(): Promise<void> {
    // Serialize flushes
    if (this.flushing) {
      await this.flushing;
    }
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.maxBatchSize);
    this.flushing = this._send(batch);
    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
  }

  /** Stop the sender, flush remaining events, then resolve. */
  async shutdown(timeoutMs = 30_000): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const done = (async () => {
      // Flush all remaining in batches
      while (this.queue.length > 0) {
        await this.flush();
      }
    })();

    // Race against timeout
    await Promise.race([
      done,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  private async _send(batch: AgentLensEvent[]): Promise<void> {
    try {
      await this.sendFn(batch);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));

      // On 402 (quota exceeded), buffer to disk
      if (isQuotaError(error)) {
        await this.bufferToDisk(batch);
        return;
      }

      this.onError(error);
    }
  }

  private async bufferToDisk(events: AgentLensEvent[]): Promise<void> {
    try {
      await mkdir(this.bufferDir, { recursive: true });
      const filename = `agentlens-buffer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
      const filepath = join(this.bufferDir, filename);
      await writeFile(filepath, JSON.stringify(events), 'utf-8');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.onError(new Error(`Failed to buffer events to disk: ${error.message}`));
    }
  }
}

function isQuotaError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 402) {
    return true;
  }
  if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'QUOTA_EXCEEDED') {
    return true;
  }
  return false;
}
