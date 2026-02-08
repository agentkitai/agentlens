/**
 * Tests for Story 14.1: SSE Stream Endpoint
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createTestApp, authHeaders } from './test-helpers.js';
import { eventBus } from '../lib/event-bus.js';
import type { AgentLensEvent, Session } from '@agentlensai/core';

// Helper to create a mock AgentLensEvent
function mockEvent(overrides: Partial<AgentLensEvent> = {}): AgentLensEvent {
  return {
    id: 'evt_001',
    timestamp: new Date().toISOString(),
    sessionId: 'sess_001',
    agentId: 'agent_001',
    eventType: 'tool_call',
    severity: 'info',
    payload: { toolName: 'search', arguments: {}, callId: 'c1' },
    metadata: {},
    prevHash: null,
    hash: 'abc123',
    tenantId: 'default',
    ...overrides,
  };
}

// Helper to create a mock Session
function mockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess_001',
    agentId: 'agent_001',
    agentName: 'Test Agent',
    startedAt: new Date().toISOString(),
    status: 'active',
    eventCount: 1,
    toolCallCount: 0,
    errorCount: 0,
    totalCostUsd: 0,
    llmCallCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    tags: [],
    tenantId: 'default',
    ...overrides,
  };
}

/**
 * Parse SSE text into individual messages.
 */
function parseSSEMessages(text: string): Array<{ event: string; data: string }> {
  const messages: Array<{ event: string; data: string }> = [];
  const blocks = text.split('\n\n').filter(Boolean);
  for (const block of blocks) {
    const lines = block.split('\n');
    let event = '';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7);
      if (line.startsWith('data: ')) data = line.slice(6);
    }
    if (event || data) {
      messages.push({ event, data });
    }
  }
  return messages;
}

/**
 * Helper: make an SSE request, optionally emit bus events, then read the streamed chunks.
 * Uses ReadableStream reader to collect chunks, then cancels.
 */
async function sseRequest(
  app: ReturnType<typeof createTestApp>['app'],
  url: string,
  opts?: {
    emitAfter?: () => void;
    delayMs?: number;
  },
): Promise<{ text: string; messages: ReturnType<typeof parseSSEMessages>; headers: Headers }> {
  const controller = new AbortController();

  const resultOrPromise = app.request(url, { signal: controller.signal });
  const res = resultOrPromise instanceof Promise
    ? await resultOrPromise
    : resultOrPromise;

  const headers = res.headers;

  // Wait for connection to establish
  await new Promise((r) => setTimeout(r, 50));

  // Emit events if provided
  if (opts?.emitAfter) {
    opts.emitAfter();
  }

  // Wait for events to be delivered
  await new Promise((r) => setTimeout(r, opts?.delayMs ?? 100));

  // Read accumulated chunks from the stream
  let text = '';
  const decoder = new TextDecoder();

  if (res.body) {
    const reader = res.body.getReader();
    // Read all available chunks with a timeout
    const readChunks = async (): Promise<string> => {
      let accumulated = '';
      // eslint-disable-next-line no-constant-condition
      while (true) {
        // Race between read and a small timeout
        const result = await Promise.race([
          reader.read(),
          new Promise<{ done: true; value: undefined }>((resolve) =>
            setTimeout(() => resolve({ done: true, value: undefined }), 200),
          ),
        ]);
        if (result.value) {
          accumulated += decoder.decode(result.value, { stream: true });
        }
        if (result.done) break;
      }
      await reader.cancel().catch(() => {});
      return accumulated;
    };
    text = await readChunks();
  }

  controller.abort();

  return { text, messages: parseSSEMessages(text), headers };
}

describe('SSE Stream — GET /api/stream (Story 14.1)', () => {
  afterEach(() => {
    eventBus.removeAllListeners();
  });

  it('rejects unauthenticated requests when auth is enabled', async () => {
    const { app } = createTestApp(); // auth enabled
    const res = await app.request('/api/stream');
    expect(res.status).toBe(401);
  });

  it('accepts ?token= query param for auth', async () => {
    const { app, apiKey } = createTestApp(); // auth enabled
    const { headers } = await sseRequest(app, `/api/stream?token=${apiKey}`);
    expect(headers.get('Content-Type')).toBe('text/event-stream');
  });

  it('returns SSE content-type headers', async () => {
    const { app } = createTestApp({ authDisabled: true });
    const { headers } = await sseRequest(app, '/api/stream');
    expect(headers.get('Content-Type')).toBe('text/event-stream');
    expect(headers.get('Cache-Control')).toBe('no-cache');
  });

  it('sends initial heartbeat on connection', async () => {
    const { app } = createTestApp({ authDisabled: true });
    const { messages } = await sseRequest(app, '/api/stream');

    const heartbeats = messages.filter((m) => m.event === 'heartbeat');
    expect(heartbeats.length).toBeGreaterThanOrEqual(1);

    if (heartbeats[0]) {
      const data = JSON.parse(heartbeats[0].data);
      expect(data).toHaveProperty('time');
    }
  });

  it('streams events from EventBus to SSE clients', async () => {
    const { app } = createTestApp({ authDisabled: true });
    const event = mockEvent();

    const { messages } = await sseRequest(app, '/api/stream', {
      emitAfter: () => {
        eventBus.emit({
          type: 'event_ingested',
          event,
          timestamp: new Date().toISOString(),
        });
      },
    });

    const eventMessages = messages.filter((m) => m.event === 'event');
    expect(eventMessages.length).toBeGreaterThanOrEqual(1);

    if (eventMessages[0]) {
      const data = JSON.parse(eventMessages[0].data);
      expect(data.id).toBe('evt_001');
      expect(data.eventType).toBe('tool_call');
    }
  });

  it('filters events by sessionId', async () => {
    const { app } = createTestApp({ authDisabled: true });

    const { messages } = await sseRequest(app, '/api/stream?sessionId=sess_002', {
      emitAfter: () => {
        // Emit event for sess_001 (should be filtered out)
        eventBus.emit({
          type: 'event_ingested',
          event: mockEvent({ sessionId: 'sess_001' }),
          timestamp: new Date().toISOString(),
        });
        // Emit event for sess_002 (should pass through)
        eventBus.emit({
          type: 'event_ingested',
          event: mockEvent({ id: 'evt_002', sessionId: 'sess_002' }),
          timestamp: new Date().toISOString(),
        });
      },
    });

    const eventMessages = messages.filter((m) => m.event === 'event');
    expect(eventMessages.length).toBe(1);
    if (eventMessages[0]) {
      const data = JSON.parse(eventMessages[0].data);
      expect(data.sessionId).toBe('sess_002');
    }
  });

  it('filters events by agentId', async () => {
    const { app } = createTestApp({ authDisabled: true });

    const { messages } = await sseRequest(app, '/api/stream?agentId=agent_002', {
      emitAfter: () => {
        eventBus.emit({
          type: 'event_ingested',
          event: mockEvent({ agentId: 'agent_001' }),
          timestamp: new Date().toISOString(),
        });
        eventBus.emit({
          type: 'event_ingested',
          event: mockEvent({ id: 'evt_002', agentId: 'agent_002' }),
          timestamp: new Date().toISOString(),
        });
      },
    });

    const eventMessages = messages.filter((m) => m.event === 'event');
    expect(eventMessages.length).toBe(1);
    if (eventMessages[0]) {
      const data = JSON.parse(eventMessages[0].data);
      expect(data.agentId).toBe('agent_002');
    }
  });

  it('filters events by eventType', async () => {
    const { app } = createTestApp({ authDisabled: true });

    const { messages } = await sseRequest(app, '/api/stream?eventType=tool_error', {
      emitAfter: () => {
        eventBus.emit({
          type: 'event_ingested',
          event: mockEvent({ eventType: 'tool_call' }),
          timestamp: new Date().toISOString(),
        });
        eventBus.emit({
          type: 'event_ingested',
          event: mockEvent({ id: 'evt_err', eventType: 'tool_error' }),
          timestamp: new Date().toISOString(),
        });
      },
    });

    const eventMessages = messages.filter((m) => m.event === 'event');
    expect(eventMessages.length).toBe(1);
    if (eventMessages[0]) {
      const data = JSON.parse(eventMessages[0].data);
      expect(data.eventType).toBe('tool_error');
    }
  });

  it('streams session_update events', async () => {
    const { app } = createTestApp({ authDisabled: true });

    const { messages } = await sseRequest(app, '/api/stream', {
      emitAfter: () => {
        eventBus.emit({
          type: 'session_updated',
          session: mockSession(),
          timestamp: new Date().toISOString(),
        });
      },
    });

    const sessionMessages = messages.filter((m) => m.event === 'session_update');
    expect(sessionMessages.length).toBeGreaterThanOrEqual(1);

    if (sessionMessages[0]) {
      const data = JSON.parse(sessionMessages[0].data);
      expect(data.id).toBe('sess_001');
      expect(data.status).toBe('active');
    }
  });

  it('streams alert events to all clients', async () => {
    const { app } = createTestApp({ authDisabled: true });

    const { messages } = await sseRequest(app, '/api/stream?sessionId=sess_specific', {
      emitAfter: () => {
        eventBus.emit({
          type: 'alert_triggered',
          rule: {
            id: 'rule_001',
            name: 'High Error Rate',
            enabled: true,
            condition: 'error_rate_exceeds',
            threshold: 0.1,
            windowMinutes: 5,
            scope: {},
            notifyChannels: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            tenantId: 'default',
          },
          history: {
            id: 'hist_001',
            ruleId: 'rule_001',
            triggeredAt: new Date().toISOString(),
            currentValue: 0.25,
            threshold: 0.1,
            message: 'Error rate is 25% (threshold: 10%)',
            tenantId: 'default',
          },
          timestamp: new Date().toISOString(),
        });
      },
    });

    const alertMessages = messages.filter((m) => m.event === 'alert');
    expect(alertMessages.length).toBeGreaterThanOrEqual(1);

    if (alertMessages[0]) {
      const data = JSON.parse(alertMessages[0].data);
      expect(data.ruleId).toBe('rule_001');
      expect(data.name).toBe('High Error Rate');
    }
  });

  it('supports comma-separated eventType filter', async () => {
    const { app } = createTestApp({ authDisabled: true });

    const { messages } = await sseRequest(app, '/api/stream?eventType=tool_call,tool_error', {
      emitAfter: () => {
        eventBus.emit({
          type: 'event_ingested',
          event: mockEvent({ id: 'e1', eventType: 'tool_call' }),
          timestamp: new Date().toISOString(),
        });
        eventBus.emit({
          type: 'event_ingested',
          event: mockEvent({ id: 'e2', eventType: 'session_started' }),
          timestamp: new Date().toISOString(),
        });
        eventBus.emit({
          type: 'event_ingested',
          event: mockEvent({ id: 'e3', eventType: 'tool_error' }),
          timestamp: new Date().toISOString(),
        });
      },
    });

    const eventMessages = messages.filter((m) => m.event === 'event');
    expect(eventMessages.length).toBe(2);
  });
});

describe('EventBus emission on ingestion (Story 14.1)', () => {
  afterEach(() => {
    eventBus.removeAllListeners();
  });

  it('emits event_ingested when events are POST-ed to /api/events', async () => {
    const { app, apiKey } = createTestApp();

    const emittedEvents: unknown[] = [];
    eventBus.on('event_ingested', (e) => emittedEvents.push(e));

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        events: [
          {
            sessionId: 'sess_bus_test',
            agentId: 'agent_001',
            eventType: 'session_started',
            payload: { agentName: 'Test', tags: [] },
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    expect(emittedEvents.length).toBe(1);
  });

  it('emits session_updated after event ingestion', async () => {
    const { app, apiKey } = createTestApp();

    const emittedSessions: unknown[] = [];
    eventBus.on('session_updated', (e) => emittedSessions.push(e));

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        events: [
          {
            sessionId: 'sess_bus_test_2',
            agentId: 'agent_001',
            eventType: 'session_started',
            payload: { agentName: 'Test', tags: [] },
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    expect(emittedSessions.length).toBe(1);
  });
});
