/**
 * Tests for BatchSender (S8)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BatchSender } from '../batch-sender.js';
import { QuotaExceededError } from '../errors.js';
import type { AgentLensEvent } from '@agentlensai/core';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

function makeEvent(id = '1'): AgentLensEvent {
  return {
    id,
    sessionId: 'sess-1',
    agentId: 'agent-1',
    eventType: 'tool_call',
    severity: 'info',
    timestamp: new Date().toISOString(),
    payload: {},
    metadata: {},
  } as AgentLensEvent;
}

describe('BatchSender', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes when batch size is reached', async () => {
    const sendFn = vi.fn<(events: AgentLensEvent[]) => Promise<void>>().mockResolvedValue(undefined);
    const sender = new BatchSender({ sendFn, maxBatchSize: 3, flushIntervalMs: 60_000 });

    sender.enqueue(makeEvent('1'));
    sender.enqueue(makeEvent('2'));
    expect(sendFn).not.toHaveBeenCalled();

    sender.enqueue(makeEvent('3')); // triggers flush
    // flush is async, wait for microtasks
    await vi.advanceTimersByTimeAsync(0);

    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn.mock.calls[0][0]).toHaveLength(3);

    await sender.shutdown();
  });

  it('flushes at interval', async () => {
    const sendFn = vi.fn<(events: AgentLensEvent[]) => Promise<void>>().mockResolvedValue(undefined);
    const sender = new BatchSender({ sendFn, maxBatchSize: 100, flushIntervalMs: 1_000 });

    sender.enqueue(makeEvent('1'));
    expect(sendFn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn.mock.calls[0][0]).toHaveLength(1);

    await sender.shutdown();
  });

  it('shutdown flushes remaining events', async () => {
    const sendFn = vi.fn<(events: AgentLensEvent[]) => Promise<void>>().mockResolvedValue(undefined);
    const sender = new BatchSender({ sendFn, maxBatchSize: 100, flushIntervalMs: 60_000 });

    sender.enqueue(makeEvent('1'));
    sender.enqueue(makeEvent('2'));

    await sender.shutdown();

    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn.mock.calls[0][0]).toHaveLength(2);
  });

  it('calls onError on send failure', async () => {
    const onError = vi.fn();
    const sendFn = vi.fn<(events: AgentLensEvent[]) => Promise<void>>().mockRejectedValue(new Error('network fail'));
    const sender = new BatchSender({ sendFn, onError, maxBatchSize: 1, flushIntervalMs: 60_000 });

    sender.enqueue(makeEvent('1'));
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('network fail');

    await sender.shutdown();
  });

  it('buffers to disk on 402 quota exceeded', async () => {
    vi.useRealTimers(); // need real FS ops

    const bufferDir = mkdtempSync(join(tmpdir(), 'batch-sender-test-'));
    const sendFn = vi.fn<(events: AgentLensEvent[]) => Promise<void>>().mockRejectedValue(
      new QuotaExceededError('Quota exceeded'),
    );
    const onError = vi.fn();
    const sender = new BatchSender({ sendFn, onError, maxBatchSize: 1, flushIntervalMs: 60_000, bufferDir });

    sender.enqueue(makeEvent('1'));
    // Wait for the async flush
    await new Promise((r) => setTimeout(r, 100));

    // onError should NOT have been called (quota is handled by buffering)
    expect(onError).not.toHaveBeenCalled();

    // Check a file was written
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(bufferDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^agentlens-buffer-/);

    const content = JSON.parse(await readFile(join(bufferDir, files[0]), 'utf-8'));
    expect(content).toHaveLength(1);
    expect(content[0].id).toBe('1');

    await sender.shutdown();
    await rm(bufferDir, { recursive: true, force: true });
  });

  it('drops oldest events on queue overflow', async () => {
    const onError = vi.fn();
    const sendFn = vi.fn<(events: AgentLensEvent[]) => Promise<void>>().mockResolvedValue(undefined);
    const sender = new BatchSender({ sendFn, onError, maxBatchSize: 100, maxQueueSize: 3, flushIntervalMs: 60_000 });

    sender.enqueue(makeEvent('1'));
    sender.enqueue(makeEvent('2'));
    sender.enqueue(makeEvent('3'));
    sender.enqueue(makeEvent('4')); // overflow — drops '1'

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toMatch(/dropped 1 oldest/);

    await sender.shutdown();

    // Should have flushed events 2, 3, 4 (not 1)
    expect(sendFn).toHaveBeenCalledTimes(1);
    const sentIds = sendFn.mock.calls[0][0].map((e: AgentLensEvent) => e.id);
    expect(sentIds).toEqual(['2', '3', '4']);
  });
});
