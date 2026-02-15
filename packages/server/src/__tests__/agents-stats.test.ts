/**
 * Tests for Story 4.7: Agent and Stats Endpoints
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

describe('Agent Endpoints (Story 4.7)', () => {
  let app: Hono;
  let apiKey: string;

  beforeEach(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    apiKey = ctx.apiKey;

    await ingestEvents(app, apiKey, [
      {
        sessionId: 'sess_001',
        agentId: 'agent_001',
        eventType: 'session_started',
        payload: { agentName: 'Agent One', tags: [] },
      },
    ]);

    await ingestEvents(app, apiKey, [
      {
        sessionId: 'sess_002',
        agentId: 'agent_002',
        eventType: 'session_started',
        payload: { agentName: 'Agent Two', tags: [] },
      },
    ]);
  });

  describe('GET /api/agents', () => {
    it('lists all agents', async () => {
      const res = await app.request('/api/agents', {
        headers: authHeaders(apiKey),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.agents).toBeInstanceOf(Array);
      expect(body.agents.length).toBe(2);

      const names = body.agents.map((a: { name: string }) => a.name);
      expect(names).toContain('Agent One');
      expect(names).toContain('Agent Two');
    });

    it('includes agent metadata', async () => {
      const res = await app.request('/api/agents', {
        headers: authHeaders(apiKey),
      });

      const body = await res.json();
      const agent = body.agents.find((a: { id: string }) => a.id === 'agent_001');
      expect(agent.id).toBe('agent_001');
      expect(agent.name).toBe('Agent One');
      expect(agent.firstSeenAt).toBeTruthy();
      expect(agent.lastSeenAt).toBeTruthy();
      expect(agent.sessionCount).toBe(1);
    });
  });

  describe('GET /api/agents/:id', () => {
    it('returns a single agent', async () => {
      const res = await app.request('/api/agents/agent_001', {
        headers: authHeaders(apiKey),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('agent_001');
      expect(body.name).toBe('Agent One');
    });

    it('returns 404 for non-existent agent', async () => {
      const res = await app.request('/api/agents/nonexistent', {
        headers: authHeaders(apiKey),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Agent not found');
    });
  });
});

describe('Stats Endpoint (Story 4.7)', () => {
  it('returns storage statistics for empty database', async () => {
    const { app, apiKey } = await createTestApp();

    const res = await app.request('/api/stats', {
      headers: authHeaders(apiKey),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalEvents).toBe(0);
    expect(body.totalSessions).toBe(0);
    expect(body.totalAgents).toBe(0);
  });

  it('returns accurate stats after ingestion', async () => {
    const { app, apiKey } = await createTestApp();

    await ingestEvents(app, apiKey, [
      {
        sessionId: 'sess_001',
        agentId: 'agent_001',
        eventType: 'session_started',
        timestamp: '2026-01-01T10:00:00Z',
        payload: { tags: [] },
      },
      {
        sessionId: 'sess_001',
        agentId: 'agent_001',
        eventType: 'tool_call',
        timestamp: '2026-01-01T10:01:00Z',
        payload: { toolName: 'search', arguments: {}, callId: 'c1' },
      },
    ]);

    await ingestEvents(app, apiKey, [
      {
        sessionId: 'sess_002',
        agentId: 'agent_002',
        eventType: 'session_started',
        timestamp: '2026-01-02T10:00:00Z',
        payload: { tags: [] },
      },
    ]);

    const res = await app.request('/api/stats', {
      headers: authHeaders(apiKey),
    });

    const body = await res.json();
    expect(body.totalEvents).toBe(3);
    expect(body.totalSessions).toBe(2);
    expect(body.totalAgents).toBe(2);
    expect(body.oldestEvent).toBeTruthy();
    expect(body.newestEvent).toBeTruthy();
    expect(typeof body.storageSizeBytes).toBe('number');
  });
});
