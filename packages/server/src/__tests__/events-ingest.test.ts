/**
 * Tests for Story 4.4: Event Ingestion Endpoint
 */

import { describe, it, expect } from 'vitest';
import { createTestApp, authHeaders } from './test-helpers.js';

describe('Event Ingestion — POST /api/events (Story 4.4)', () => {
  it('ingests a single event and returns id + hash', async () => {
    const { app, apiKey } = await createTestApp();

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        events: [
          {
            sessionId: 'sess_001',
            agentId: 'agent_001',
            eventType: 'session_started',
            payload: { agentName: 'Test', tags: ['test'] },
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ingested).toBe(1);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].id).toBeTruthy();
    expect(body.events[0].hash).toHaveLength(64);
  });

  it('ingests a batch of events', async () => {
    const { app, apiKey } = await createTestApp();

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        events: [
          {
            sessionId: 'sess_001',
            agentId: 'agent_001',
            eventType: 'session_started',
            payload: { tags: [] },
          },
          {
            sessionId: 'sess_001',
            agentId: 'agent_001',
            eventType: 'tool_call',
            payload: { toolName: 'search', arguments: {}, callId: 'c1' },
          },
          {
            sessionId: 'sess_001',
            agentId: 'agent_001',
            eventType: 'tool_response',
            payload: { callId: 'c1', toolName: 'search', result: 'found', durationMs: 100 },
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ingested).toBe(3);
    expect(body.events).toHaveLength(3);
  });

  it('assigns ULIDs as event IDs', async () => {
    const { app, apiKey } = await createTestApp();

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        events: [
          {
            sessionId: 'sess_001',
            agentId: 'agent_001',
            eventType: 'custom',
            payload: { type: 'test', data: {} },
          },
        ],
      }),
    });

    const body = await res.json();
    // ULIDs are 26 characters, uppercase alphanumeric
    expect(body.events[0].id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it('chains hashes within a session', async () => {
    const { app, apiKey } = await createTestApp();

    // First batch
    const res1 = await app.request('/api/events', {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        events: [
          {
            sessionId: 'sess_001',
            agentId: 'agent_001',
            eventType: 'session_started',
            payload: { tags: [] },
          },
        ],
      }),
    });
    const body1 = await res1.json();
    const firstHash = body1.events[0].hash;

    // Second batch — should chain from the first
    const res2 = await app.request('/api/events', {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        events: [
          {
            sessionId: 'sess_001',
            agentId: 'agent_001',
            eventType: 'custom',
            payload: { type: 'test', data: {} },
          },
        ],
      }),
    });

    expect(res2.status).toBe(201);
    const body2 = await res2.json();
    // The second event's hash should be different from the first
    expect(body2.events[0].hash).not.toBe(firstHash);
  });

  it('returns 400 for invalid JSON body', async () => {
    const { app, apiKey } = await createTestApp();

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: 'not json',
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for missing required fields', async () => {
    const { app, apiKey } = await createTestApp();

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        events: [
          {
            // Missing sessionId, agentId, eventType, payload
          },
        ],
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details).toBeInstanceOf(Array);
    expect(body.details.length).toBeGreaterThan(0);
  });

  it('returns 400 for invalid eventType', async () => {
    const { app, apiKey } = await createTestApp();

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        events: [
          {
            sessionId: 'sess_001',
            agentId: 'agent_001',
            eventType: 'not_a_valid_type',
            payload: {},
          },
        ],
      }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for empty events array', async () => {
    const { app, apiKey } = await createTestApp();

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ events: [] }),
    });

    expect(res.status).toBe(400);
  });

  it('validates payload against event-type-specific schema', async () => {
    const { app, apiKey } = await createTestApp();

    // tool_call requires toolName, arguments, callId
    const res = await app.request('/api/events', {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        events: [
          {
            sessionId: 'sess_001',
            agentId: 'agent_001',
            eventType: 'tool_call',
            payload: { missing: 'required fields' },
          },
        ],
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details.some((d: { path: string }) => d.path.startsWith('events.0.payload'))).toBe(true);
  });

  it('defaults severity to info when not provided', async () => {
    const { app, apiKey, store } = await createTestApp();

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        events: [
          {
            sessionId: 'sess_001',
            agentId: 'agent_001',
            eventType: 'custom',
            payload: { type: 'test', data: {} },
          },
        ],
      }),
    });

    const body = await res.json();
    const event = await store.getEvent(body.events[0].id);
    expect(event?.severity).toBe('info');
  });

  it('handles events across multiple sessions in a single batch', async () => {
    const { app, apiKey } = await createTestApp();

    const res = await app.request('/api/events', {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        events: [
          {
            sessionId: 'sess_001',
            agentId: 'agent_001',
            eventType: 'session_started',
            payload: { tags: [] },
          },
          {
            sessionId: 'sess_002',
            agentId: 'agent_001',
            eventType: 'session_started',
            payload: { tags: [] },
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ingested).toBe(2);
  });
});
