/**
 * Tests for S-3.1 (Redis Streams Setup) and S-3.2 (API Gateway Service)
 *
 * All tests use InMemoryEventQueue — no Redis required.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryEventQueue,
  STREAM_NAME,
  DLQ_STREAM_NAME,
  CONSUMER_GROUP,
  BACKPRESSURE_THRESHOLD,
} from '../ingestion/event-queue.js';
import {
  IngestionGateway,
  validateEvent,
} from '../ingestion/gateway.js';
import type { ApiKeyAuthContext } from '../auth/api-key-middleware.js';

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function makeAuth(overrides?: Partial<ApiKeyAuthContext>): ApiKeyAuthContext {
  return {
    orgId: 'org-111',
    keyId: 'key-222',
    scopes: ['ingest', 'query'],
    rateLimitOverride: null,
    environment: 'production',
    ...overrides,
  };
}

function makeEvent(overrides?: Record<string, unknown>) {
  return {
    type: 'llm_call',
    session_id: 'sess-001',
    timestamp: new Date().toISOString(),
    data: { model: 'gpt-4' },
    ...overrides,
  };
}

// ═══════════════════════════════════════════
// S-3.1: Event Queue / Redis Streams Setup
// ═══════════════════════════════════════════

describe('S-3.1: Event Queue', () => {
  let queue: InMemoryEventQueue;

  beforeEach(() => {
    queue = new InMemoryEventQueue();
  });

  it('exports correct stream constants', () => {
    expect(STREAM_NAME).toBe('event_ingestion');
    expect(DLQ_STREAM_NAME).toBe('event_ingestion_dlq');
    expect(CONSUMER_GROUP).toBe('ingestion_workers');
  });

  it('initialize creates the queue', async () => {
    expect(queue.isInitialized).toBe(false);
    await queue.initialize();
    expect(queue.isInitialized).toBe(true);
  });

  it('publish fails before initialization', async () => {
    const event = makeEvent() as any;
    event.org_id = 'org-1';
    event.api_key_id = 'k-1';
    event.received_at = new Date().toISOString();
    event.request_id = 'req-1';
    event.id = 'evt-1';
    await expect(queue.publish(event)).rejects.toThrow('Queue not initialized');
  });

  it('publish and retrieve events', async () => {
    await queue.initialize();
    const event = {
      id: 'e1', type: 'llm_call', timestamp: new Date().toISOString(),
      session_id: 's1', data: {}, org_id: 'o1', api_key_id: 'k1',
      received_at: new Date().toISOString(), request_id: 'r1',
    };
    const id = await queue.publish(event);
    expect(id).toBeTruthy();
    expect(queue.getEvents()).toHaveLength(1);
    expect(queue.getEvents()[0].id).toBe('e1');
  });

  it('healthCheck returns correct status', async () => {
    let health = await queue.healthCheck();
    expect(health.healthy).toBe(false);

    await queue.initialize();
    health = await queue.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.streamLength).toBe(0);
    expect(health.dlqLength).toBe(0);
    expect(health.consumerGroupExists).toBe(true);
  });

  it('stream length tracking', async () => {
    await queue.initialize();
    const event = {
      id: 'e1', type: 'llm_call', timestamp: new Date().toISOString(),
      session_id: 's1', data: {}, org_id: 'o1', api_key_id: 'k1',
      received_at: new Date().toISOString(), request_id: 'r1',
    };
    await queue.publish(event);
    await queue.publish({ ...event, id: 'e2' });
    expect(await queue.getStreamLength()).toBe(2);
    expect(await queue.getDlqLength()).toBe(0);
  });
});

// ═══════════════════════════════════════════
// S-3.2: Validation
// ═══════════════════════════════════════════

describe('S-3.2: Event validation', () => {
  it('valid event passes', () => {
    expect(validateEvent(makeEvent(), 0)).toBeNull();
  });

  it('rejects missing type', () => {
    const err = validateEvent({ session_id: 's1' }, 0);
    expect(err).toEqual({ index: 0, error: 'missing required field: type' });
  });

  it('rejects unknown event type', () => {
    const err = validateEvent({ type: 'foo', session_id: 's1' }, 0);
    expect(err).toEqual({ index: 0, error: 'unknown event type: foo' });
  });

  it('rejects missing session_id', () => {
    const err = validateEvent({ type: 'llm_call' }, 0);
    expect(err).toEqual({ index: 0, error: 'missing required field: session_id' });
  });

  it('rejects invalid timestamp', () => {
    const err = validateEvent({ type: 'llm_call', session_id: 's1', timestamp: 'not-a-date' }, 0);
    expect(err).toEqual({ index: 0, error: 'invalid timestamp format' });
  });

  it('rejects future timestamp', () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const err = validateEvent({ type: 'llm_call', session_id: 's1', timestamp: future }, 0);
    expect(err).toEqual({ index: 0, error: 'timestamp in future' });
  });

  it('rejects non-object data', () => {
    const err = validateEvent({ type: 'llm_call', session_id: 's1', data: 'string' }, 0);
    expect(err).toEqual({ index: 0, error: 'data must be an object' });
  });

  it('rejects non-object event', () => {
    const err = validateEvent(null, 0);
    expect(err).toEqual({ index: 0, error: 'event must be an object' });
  });
});

// ═══════════════════════════════════════════
// S-3.2: Ingestion Gateway — Single Event
// ═══════════════════════════════════════════

describe('S-3.2: IngestionGateway — single event', () => {
  let queue: InMemoryEventQueue;
  let gateway: IngestionGateway;

  beforeEach(async () => {
    queue = new InMemoryEventQueue();
    await queue.initialize();
    gateway = new IngestionGateway(queue);
  });

  it('accepts valid event with 202', async () => {
    const result = await gateway.ingestSingle(makeEvent(), makeAuth());
    expect(result.status).toBe(202);
    expect((result.body as any).accepted).toBe(true);
    expect((result.body as any).request_id).toBeTruthy();
    expect(result.requestId).toBeTruthy();
    expect(queue.getEvents()).toHaveLength(1);
  });

  it('enriches event with org_id, api_key_id, received_at', async () => {
    await gateway.ingestSingle(makeEvent(), makeAuth());
    const queued = queue.getEvents()[0];
    expect(queued.org_id).toBe('org-111');
    expect(queued.api_key_id).toBe('key-222');
    expect(queued.received_at).toBeTruthy();
    expect(queued.request_id).toBeTruthy();
  });

  it('rejects invalid event with 400', async () => {
    const result = await gateway.ingestSingle({ session_id: 's1' }, makeAuth());
    expect(result.status).toBe(400);
    expect(queue.getEvents()).toHaveLength(0);
  });

  it('rejects key without ingest scope', async () => {
    const auth = makeAuth({ scopes: ['query'] });
    const result = await gateway.ingestSingle(makeEvent(), auth);
    expect(result.status).toBe(403);
  });

  it('returns X-Request-Id (requestId in response)', async () => {
    const result = await gateway.ingestSingle(makeEvent(), makeAuth());
    expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect((result.body as any).request_id).toBe(result.requestId);
  });
});

// ═══════════════════════════════════════════
// S-3.2: Ingestion Gateway — Batch
// ═══════════════════════════════════════════

describe('S-3.2: IngestionGateway — batch', () => {
  let queue: InMemoryEventQueue;
  let gateway: IngestionGateway;

  beforeEach(async () => {
    queue = new InMemoryEventQueue();
    await queue.initialize();
    gateway = new IngestionGateway(queue);
  });

  it('accepts batch of valid events', async () => {
    const events = [makeEvent(), makeEvent({ type: 'tool_use' })];
    const result = await gateway.ingestBatch(events, makeAuth());
    expect(result.status).toBe(202);
    const body = result.body as any;
    expect(body.accepted).toBe(2);
    expect(body.rejected).toBe(0);
    expect(body.errors).toHaveLength(0);
    expect(queue.getEvents()).toHaveLength(2);
  });

  it('partial accept: valid queued, invalid reported', async () => {
    const events = [
      makeEvent(),
      { type: 'foo', session_id: 's1' }, // unknown type
      makeEvent({ type: 'error' }),
    ];
    const result = await gateway.ingestBatch(events, makeAuth());
    expect(result.status).toBe(202);
    const body = result.body as any;
    expect(body.accepted).toBe(2);
    expect(body.rejected).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].index).toBe(1);
    expect(queue.getEvents()).toHaveLength(2);
  });

  it('rejects batch exceeding 100 events', async () => {
    const events = Array.from({ length: 101 }, () => makeEvent());
    const result = await gateway.ingestBatch(events, makeAuth());
    expect(result.status).toBe(400);
    expect((result.body as any).error).toContain('100');
  });

  it('rejects empty batch', async () => {
    const result = await gateway.ingestBatch([], makeAuth());
    expect(result.status).toBe(400);
  });

  it('rejects non-array input', async () => {
    const result = await gateway.ingestBatch('not-array' as any, makeAuth());
    expect(result.status).toBe(400);
  });

  it('rejects key without ingest scope', async () => {
    const auth = makeAuth({ scopes: ['query'] });
    const result = await gateway.ingestBatch([makeEvent()], auth);
    expect(result.status).toBe(403);
  });

  it('returns request_id in batch response', async () => {
    const result = await gateway.ingestBatch([makeEvent()], makeAuth());
    expect((result.body as any).request_id).toBe(result.requestId);
  });
});
