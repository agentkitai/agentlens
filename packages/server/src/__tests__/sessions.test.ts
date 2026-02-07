/**
 * Tests for Story 4.6: Session Endpoints
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, authHeaders } from './test-helpers.js';
import type { Hono } from 'hono';

async function ingestEvents(app: Hono, apiKey: string, events: object[]) {
  return app.request('/api/events', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ events }),
  });
}

describe('Session Endpoints (Story 4.6)', () => {
  let app: Hono;
  let apiKey: string;

  beforeEach(async () => {
    const ctx = createTestApp();
    app = ctx.app;
    apiKey = ctx.apiKey;

    // Session 1: active with events
    await ingestEvents(app, apiKey, [
      {
        sessionId: 'sess_001',
        agentId: 'agent_001',
        eventType: 'session_started',
        timestamp: '2026-01-01T10:00:00Z',
        payload: { agentName: 'Agent One', tags: ['prod', 'v2'] },
      },
      {
        sessionId: 'sess_001',
        agentId: 'agent_001',
        eventType: 'tool_call',
        timestamp: '2026-01-01T10:01:00Z',
        payload: { toolName: 'search', arguments: {}, callId: 'c1' },
      },
    ]);

    // Session 2: completed
    await ingestEvents(app, apiKey, [
      {
        sessionId: 'sess_002',
        agentId: 'agent_002',
        eventType: 'session_started',
        timestamp: '2026-01-02T10:00:00Z',
        payload: { agentName: 'Agent Two', tags: ['staging'] },
      },
      {
        sessionId: 'sess_002',
        agentId: 'agent_002',
        eventType: 'session_ended',
        timestamp: '2026-01-02T11:00:00Z',
        payload: { reason: 'completed', summary: 'Done' },
      },
    ]);
  });

  describe('GET /api/sessions', () => {
    it('lists sessions with pagination', async () => {
      const res = await app.request('/api/sessions', {
        headers: authHeaders(apiKey),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessions).toBeInstanceOf(Array);
      expect(body.sessions.length).toBe(2);
      expect(body.total).toBe(2);
      expect(body.hasMore).toBe(false);
    });

    it('filters by agentId', async () => {
      const res = await app.request('/api/sessions?agentId=agent_001', {
        headers: authHeaders(apiKey),
      });

      const body = await res.json();
      expect(body.sessions.length).toBe(1);
      expect(body.sessions[0].agentId).toBe('agent_001');
    });

    it('filters by status', async () => {
      const res = await app.request('/api/sessions?status=completed', {
        headers: authHeaders(apiKey),
      });

      const body = await res.json();
      expect(body.sessions.length).toBe(1);
      expect(body.sessions[0].id).toBe('sess_002');
    });

    it('filters by time range', async () => {
      const res = await app.request(
        '/api/sessions?from=2026-01-02T00:00:00Z&to=2026-01-03T00:00:00Z',
        { headers: authHeaders(apiKey) },
      );

      const body = await res.json();
      expect(body.sessions.length).toBe(1);
      expect(body.sessions[0].id).toBe('sess_002');
    });

    it('filters by tags', async () => {
      const res = await app.request('/api/sessions?tags=prod', {
        headers: authHeaders(apiKey),
      });

      const body = await res.json();
      expect(body.sessions.length).toBe(1);
      expect(body.sessions[0].id).toBe('sess_001');
    });

    it('clamps negative limit to 1', async () => {
      const res = await app.request('/api/sessions?limit=-5', {
        headers: authHeaders(apiKey),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessions.length).toBeGreaterThanOrEqual(1);
    });

    it('clamps negative offset to 0', async () => {
      const res = await app.request('/api/sessions?offset=-10', {
        headers: authHeaders(apiKey),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessions.length).toBe(2);
    });

    it('respects limit and offset', async () => {
      const res = await app.request('/api/sessions?limit=1', {
        headers: authHeaders(apiKey),
      });

      const body = await res.json();
      expect(body.sessions.length).toBe(1);
      expect(body.total).toBe(2);
      expect(body.hasMore).toBe(true);
    });
  });

  describe('GET /api/sessions/:id', () => {
    it('returns session detail with aggregates', async () => {
      const res = await app.request('/api/sessions/sess_001', {
        headers: authHeaders(apiKey),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('sess_001');
      expect(body.agentId).toBe('agent_001');
      expect(body.agentName).toBe('Agent One');
      expect(body.status).toBe('active');
      expect(body.eventCount).toBe(2);
      expect(body.toolCallCount).toBe(1);
      expect(body.tags).toEqual(['prod', 'v2']);
    });

    it('returns 404 for non-existent session', async () => {
      const res = await app.request('/api/sessions/nonexistent', {
        headers: authHeaders(apiKey),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Session not found');
    });
  });

  describe('GET /api/sessions/:id/timeline', () => {
    it('returns all events ascending with chainValid', async () => {
      const res = await app.request('/api/sessions/sess_001/timeline', {
        headers: authHeaders(apiKey),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events).toBeInstanceOf(Array);
      expect(body.events.length).toBe(2);
      expect(typeof body.chainValid).toBe('boolean');
      expect(body.chainValid).toBe(true);

      // Events should be ascending
      expect(body.events[0].timestamp <= body.events[1].timestamp).toBe(true);
    });

    it('returns 404 for non-existent session', async () => {
      const res = await app.request('/api/sessions/nonexistent/timeline', {
        headers: authHeaders(apiKey),
      });

      expect(res.status).toBe(404);
    });

    it('returns chainValid=true for valid chain', async () => {
      const res = await app.request('/api/sessions/sess_002/timeline', {
        headers: authHeaders(apiKey),
      });

      const body = await res.json();
      expect(body.chainValid).toBe(true);
    });
  });
});
