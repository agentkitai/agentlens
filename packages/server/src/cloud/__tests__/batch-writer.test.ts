/**
 * Tests for S-3.3: Queue Workers — Batch Writer
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryBatchWriter,
  calculateCost,
  computeHash,
  type InMemoryBatchWriterDeps,
  type QueuedEvent,
} from '../ingestion/index.js';

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function makeQueuedEvent(overrides?: Partial<QueuedEvent>): QueuedEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    type: 'llm_call',
    timestamp: new Date().toISOString(),
    session_id: 'sess-001',
    data: { model: 'gpt-4', input_tokens: 1000, output_tokens: 500 },
    org_id: 'org-aaa',
    api_key_id: 'key-bbb',
    received_at: new Date().toISOString(),
    request_id: 'req-001',
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<InMemoryBatchWriterDeps>): InMemoryBatchWriterDeps {
  return {
    pendingEvents: [],
    ackedIds: [],
    dlqEvents: [],
    insertedEvents: new Map(),
    usageIncrements: [],
    ...overrides,
  };
}

// ═══════════════════════════════════════════
// Cost Calculation
// ═══════════════════════════════════════════

describe('S-3.3: Cost Calculation', () => {
  it('calculates cost for known GPT-4 model', () => {
    const event = makeQueuedEvent({
      data: { model: 'gpt-4', input_tokens: 1000, output_tokens: 500 },
    });
    const cost = calculateCost(event);
    // (1000/1000)*0.03 + (500/1000)*0.06 = 0.03 + 0.03 = 0.06
    expect(cost).toBeCloseTo(0.06, 5);
  });

  it('calculates cost for Claude model', () => {
    const event = makeQueuedEvent({
      data: { model: 'claude-3-haiku', input_tokens: 2000, output_tokens: 1000 },
    });
    const cost = calculateCost(event);
    // (2000/1000)*0.00025 + (1000/1000)*0.00125 = 0.0005 + 0.00125 = 0.00175
    expect(cost).toBeCloseTo(0.00175, 5);
  });

  it('returns null for non-LLM events', () => {
    const event = makeQueuedEvent({ type: 'tool_use', data: {} });
    expect(calculateCost(event)).toBeNull();
  });

  it('returns null for unknown model', () => {
    const event = makeQueuedEvent({
      data: { model: 'unknown-model', input_tokens: 100, output_tokens: 50 },
    });
    expect(calculateCost(event)).toBeNull();
  });

  it('returns null when no tokens present', () => {
    const event = makeQueuedEvent({
      data: { model: 'gpt-4' },
    });
    expect(calculateCost(event)).toBeNull();
  });
});

// ═══════════════════════════════════════════
// Hash Chain
// ═══════════════════════════════════════════

describe('S-3.3: Hash Chain', () => {
  it('computes deterministic hash', () => {
    const event = makeQueuedEvent({ id: 'e1', type: 'llm_call', timestamp: '2026-01-01T00:00:00Z' });
    const h1 = computeHash(event, '0');
    const h2 = computeHash(event, '0');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // SHA-256 hex
  });

  it('different previous hash produces different result', () => {
    const event = makeQueuedEvent({ id: 'e1', type: 'llm_call', timestamp: '2026-01-01T00:00:00Z' });
    const h1 = computeHash(event, '0');
    const h2 = computeHash(event, 'abc');
    expect(h1).not.toBe(h2);
  });
});

// ═══════════════════════════════════════════
// Batch Writer
// ═══════════════════════════════════════════

describe('S-3.3: InMemoryBatchWriter', () => {
  let deps: InMemoryBatchWriterDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it('processes a batch and inserts events', async () => {
    const events = [
      { streamId: 's1', event: makeQueuedEvent({ id: 'e1' }) },
      { streamId: 's2', event: makeQueuedEvent({ id: 'e2' }) },
    ];
    deps.pendingEvents = [...events];

    const writer = new InMemoryBatchWriter(deps);
    const count = await writer.processBatch();

    expect(count).toBe(2);
    expect(deps.ackedIds).toEqual(['s1', 's2']);
    expect(deps.insertedEvents.get('org-aaa')).toHaveLength(2);
    expect(writer.getStats().processed).toBe(2);
  });

  it('enriches LLM events with cost', async () => {
    deps.pendingEvents = [
      { streamId: 's1', event: makeQueuedEvent({
        id: 'e1',
        data: { model: 'gpt-4', input_tokens: 1000, output_tokens: 500 },
      }) },
    ];

    const writer = new InMemoryBatchWriter(deps);
    await writer.processBatch();

    const inserted = deps.insertedEvents.get('org-aaa')![0];
    expect(inserted.data.estimated_cost_usd).toBeCloseTo(0.06, 5);
  });

  it('enriches events with hash chain', async () => {
    deps.pendingEvents = [
      { streamId: 's1', event: makeQueuedEvent({ id: 'e1' }) },
      { streamId: 's2', event: makeQueuedEvent({ id: 'e2' }) },
    ];

    const writer = new InMemoryBatchWriter(deps);
    await writer.processBatch();

    const events = deps.insertedEvents.get('org-aaa')!;
    expect(events[0].data.hash).toBeTruthy();
    expect(events[1].data.hash).toBeTruthy();
    expect(events[0].data.hash).not.toBe(events[1].data.hash);
  });

  it('tracks usage increments', async () => {
    deps.pendingEvents = [
      { streamId: 's1', event: makeQueuedEvent({ id: 'e1' }) },
      { streamId: 's2', event: makeQueuedEvent({ id: 'e2' }) },
    ];

    const writer = new InMemoryBatchWriter(deps);
    await writer.processBatch();

    expect(deps.usageIncrements).toEqual([{ orgId: 'org-aaa', count: 2 }]);
  });

  it('respects batch size limit', async () => {
    deps.pendingEvents = Array.from({ length: 10 }, (_, i) => ({
      streamId: `s${i}`,
      event: makeQueuedEvent({ id: `e${i}` }),
    }));

    const writer = new InMemoryBatchWriter(deps, { batchSize: 3 });
    const count = await writer.processBatch();

    expect(count).toBe(3);
    expect(deps.insertedEvents.get('org-aaa')).toHaveLength(3);
    expect(deps.pendingEvents).toHaveLength(7); // remaining
  });

  it('moves to DLQ after max retries', async () => {
    deps.failingOrgs = new Set(['org-aaa']);
    deps.pendingEvents = [
      { streamId: 's1', event: makeQueuedEvent({ id: 'e1' }) },
    ];

    const writer = new InMemoryBatchWriter(deps, { maxRetries: 3 });

    // Attempt 1 — fails, re-queued
    await writer.processBatch();
    expect(writer.getStats().failed).toBe(1);
    expect(deps.dlqEvents).toHaveLength(0);

    // Attempt 2 — fails, re-queued
    await writer.processBatch();
    expect(writer.getStats().failed).toBe(2);

    // Attempt 3 — fails, DLQ'd
    await writer.processBatch();
    expect(writer.getStats().dlqd).toBe(1);
    expect(deps.dlqEvents).toHaveLength(1);
    expect(deps.dlqEvents[0].id).toBe('e1');
  });

  it('handles mixed org success and failure', async () => {
    deps.failingOrgs = new Set(['org-bad']);
    deps.pendingEvents = [
      { streamId: 's1', event: makeQueuedEvent({ id: 'e1', org_id: 'org-aaa' }) },
      { streamId: 's2', event: makeQueuedEvent({ id: 'e2', org_id: 'org-bad' }) },
    ];

    const writer = new InMemoryBatchWriter(deps, { maxRetries: 1 });
    await writer.processBatch();

    expect(deps.insertedEvents.get('org-aaa')).toHaveLength(1);
    expect(deps.insertedEvents.has('org-bad')).toBe(false);
    expect(deps.dlqEvents).toHaveLength(1);
    expect(writer.getStats()).toEqual({ processed: 1, failed: 0, dlqd: 1 });
  });

  it('returns 0 when no pending events', async () => {
    const writer = new InMemoryBatchWriter(deps);
    const count = await writer.processBatch();
    expect(count).toBe(0);
    expect(writer.getStats().processed).toBe(0);
  });
});
