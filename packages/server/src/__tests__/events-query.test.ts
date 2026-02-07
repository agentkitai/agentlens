/**
 * Tests for Story 4.5: Event Query Endpoints
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, authHeaders } from './test-helpers.js';
import type { Hono } from 'hono';

// Helper to ingest events
async function ingestEvents(app: Hono, apiKey: string, events: object[]) {
  return app.request('/api/events', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ events }),
  });
}

describe('Event Query Endpoints (Story 4.5)', () => {
  let app: Hono;
  let apiKey: string;

  beforeEach(async () => {
    const ctx = createTestApp();
    app = ctx.app;
    apiKey = ctx.apiKey;

    // Seed some events
    await ingestEvents(app, apiKey, [
      {
        sessionId: 'sess_001',
        agentId: 'agent_001',
        eventType: 'session_started',
        severity: 'info',
        timestamp: '2026-01-01T10:00:00Z',
        payload: { agentName: 'Agent One', tags: ['prod'] },
      },
      {
        sessionId: 'sess_001',
        agentId: 'agent_001',
        eventType: 'tool_call',
        severity: 'info',
        timestamp: '2026-01-01T10:01:00Z',
        payload: { toolName: 'search', arguments: { q: 'hello' }, callId: 'c1' },
      },
      {
        sessionId: 'sess_001',
        agentId: 'agent_001',
        eventType: 'tool_error',
        severity: 'error',
        timestamp: '2026-01-01T10:02:00Z',
        payload: { callId: 'c1', toolName: 'search', error: 'timeout', durationMs: 5000 },
      },
    ]);

    // Different session/agent
    await ingestEvents(app, apiKey, [
      {
        sessionId: 'sess_002',
        agentId: 'agent_002',
        eventType: 'session_started',
        severity: 'info',
        timestamp: '2026-01-01T11:00:00Z',
        payload: { agentName: 'Agent Two', tags: [] },
      },
    ]);
  });

  describe('GET /api/events', () => {
    it('returns all events with default pagination', async () => {
      const res = await app.request('/api/events', {
        headers: authHeaders(apiKey),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events).toBeInstanceOf(Array);
      expect(body.events.length).toBe(4);
      expect(body.total).toBe(4);
      expect(body.hasMore).toBe(false);
    });

    it('filters by sessionId', async () => {
      const res = await app.request('/api/events?sessionId=sess_001', {
        headers: authHeaders(apiKey),
      });

      const body = await res.json();
      expect(body.events.length).toBe(3);
      expect(body.events.every((e: { sessionId: string }) => e.sessionId === 'sess_001')).toBe(true);
    });

    it('filters by agentId', async () => {
      const res = await app.request('/api/events?agentId=agent_002', {
        headers: authHeaders(apiKey),
      });

      const body = await res.json();
      expect(body.events.length).toBe(1);
      expect(body.events[0].agentId).toBe('agent_002');
    });

    it('filters by eventType', async () => {
      const res = await app.request('/api/events?eventType=tool_call', {
        headers: authHeaders(apiKey),
      });

      const body = await res.json();
      expect(body.events.length).toBe(1);
      expect(body.events[0].eventType).toBe('tool_call');
    });

    it('filters by multiple eventTypes (comma-separated)', async () => {
      const res = await app.request('/api/events?eventType=tool_call,tool_error', {
        headers: authHeaders(apiKey),
      });

      const body = await res.json();
      expect(body.events.length).toBe(2);
    });

    it('filters by severity', async () => {
      const res = await app.request('/api/events?severity=error', {
        headers: authHeaders(apiKey),
      });

      const body = await res.json();
      expect(body.events.length).toBe(1);
      expect(body.events[0].severity).toBe('error');
    });

    it('filters by time range (from/to)', async () => {
      const res = await app.request(
        '/api/events?from=2026-01-01T10:00:30Z&to=2026-01-01T10:01:30Z',
        { headers: authHeaders(apiKey) },
      );

      const body = await res.json();
      expect(body.events.length).toBe(1);
      expect(body.events[0].eventType).toBe('tool_call');
    });

    it('respects limit and offset for pagination', async () => {
      const res = await app.request('/api/events?limit=2&offset=0&order=asc', {
        headers: authHeaders(apiKey),
      });

      const body = await res.json();
      expect(body.events.length).toBe(2);
      expect(body.total).toBe(4);
      expect(body.hasMore).toBe(true);
    });

    it('defaults to descending order (newest first)', async () => {
      const res = await app.request('/api/events', {
        headers: authHeaders(apiKey),
      });

      const body = await res.json();
      // First event should be the newest
      expect(body.events[0].timestamp >= body.events[body.events.length - 1].timestamp).toBe(true);
    });

    it('supports ascending order', async () => {
      const res = await app.request('/api/events?order=asc', {
        headers: authHeaders(apiKey),
      });

      const body = await res.json();
      expect(body.events[0].timestamp <= body.events[body.events.length - 1].timestamp).toBe(true);
    });

    it('supports search on payload content', async () => {
      const res = await app.request('/api/events?search=timeout', {
        headers: authHeaders(apiKey),
      });

      const body = await res.json();
      expect(body.events.length).toBe(1);
      expect(body.events[0].eventType).toBe('tool_error');
    });
  });

  describe('GET /api/events/:id', () => {
    it('returns a single event by ID', async () => {
      // Get the list first to find an ID
      const listRes = await app.request('/api/events?limit=1', {
        headers: authHeaders(apiKey),
      });
      const { events } = await listRes.json();
      const eventId = events[0].id;

      const res = await app.request(`/api/events/${eventId}`, {
        headers: authHeaders(apiKey),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(eventId);
      expect(body.sessionId).toBeTruthy();
      expect(body.hash).toBeTruthy();
    });

    it('returns 404 for non-existent event', async () => {
      const res = await app.request('/api/events/nonexistent-id', {
        headers: authHeaders(apiKey),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Event not found');
    });
  });
});
