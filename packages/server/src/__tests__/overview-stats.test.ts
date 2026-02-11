/**
 * Tests for Story S-3.2: Overview Page API Consolidation
 *
 * - GET /api/stats/overview — consolidated overview metrics
 * - GET /api/sessions?countOnly=true — count-only sessions
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

function todayAt(hour: number, min = 0): string {
  // Use hour=0..3 to ensure timestamps are always in the past today (UTC-safe)
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0); // midnight UTC today
  d.setUTCHours(hour, min, 0, 0);
  return d.toISOString();
}

function yesterdayAt(hour: number, min = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(hour, min, 0, 0);
  return d.toISOString();
}

describe('Overview Stats API (Story S-3.2)', () => {
  let app: Hono;
  let apiKey: string;

  beforeEach(async () => {
    const ctx = createTestApp();
    app = ctx.app;
    apiKey = ctx.apiKey;
  });

  describe('GET /api/stats/overview', () => {
    it('returns zeroes when no data exists', async () => {
      const res = await app.request('/api/stats/overview', {
        headers: authHeaders(apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        eventsTodayCount: 0,
        eventsYesterdayCount: 0,
        errorsTodayCount: 0,
        errorsYesterdayCount: 0,
        sessionsTodayCount: 0,
        sessionsYesterdayCount: 0,
        totalAgents: 0,
        errorRate: 0,
      });
    });

    it('counts today events and sessions correctly', async () => {
      const ingestRes = await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_today_1',
          agentId: 'agent_1',
          eventType: 'session_started',
          timestamp: todayAt(1),
          payload: { agentName: 'Agent 1', tags: [] },
        },
        {
          sessionId: 'sess_today_1',
          agentId: 'agent_1',
          eventType: 'tool_call',
          timestamp: todayAt(1, 5),
          payload: { toolName: 'search', arguments: {}, callId: 'c1' },
        },
        {
          sessionId: 'sess_today_1',
          agentId: 'agent_1',
          eventType: 'session_ended',
          severity: 'error',
          timestamp: todayAt(1, 10),
          payload: { reason: 'error' },
        },
      ]);
      expect(ingestRes.status).toBeLessThan(300);

      const res = await app.request('/api/stats/overview', {
        headers: authHeaders(apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.eventsTodayCount).toBe(3);
      expect(body.errorsTodayCount).toBe(1);
      expect(body.sessionsTodayCount).toBe(1);
      expect(body.totalAgents).toBe(1);
      expect(body.errorRate).toBeCloseTo(1 / 3);
    });

    it('separates today vs yesterday counts', async () => {
      await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_yesterday',
          agentId: 'agent_1',
          eventType: 'session_started',
          timestamp: yesterdayAt(14),
          payload: { agentName: 'Agent 1', tags: [] },
        },
        {
          sessionId: 'sess_yesterday',
          agentId: 'agent_1',
          eventType: 'tool_call',
          timestamp: yesterdayAt(14, 5),
          payload: { toolName: 'search', arguments: {}, callId: 'c1' },
        },
        {
          sessionId: 'sess_today',
          agentId: 'agent_1',
          eventType: 'session_started',
          timestamp: todayAt(1),
          payload: { agentName: 'Agent 1', tags: [] },
        },
      ]);

      const res = await app.request('/api/stats/overview', {
        headers: authHeaders(apiKey),
      });
      const body = await res.json();
      expect(body.eventsTodayCount).toBe(1);
      expect(body.eventsYesterdayCount).toBe(2);
      expect(body.sessionsTodayCount).toBe(1);
      expect(body.sessionsYesterdayCount).toBe(1);
    });

    it('counts multiple agents', async () => {
      await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_a',
          agentId: 'agent_1',
          eventType: 'session_started',
          timestamp: todayAt(3),
          payload: { agentName: 'Agent 1', tags: [] },
        },
        {
          sessionId: 'sess_b',
          agentId: 'agent_2',
          eventType: 'session_started',
          timestamp: todayAt(3, 30),
          payload: { agentName: 'Agent 2', tags: [] },
        },
      ]);

      const res = await app.request('/api/stats/overview', {
        headers: authHeaders(apiKey),
      });
      const body = await res.json();
      expect(body.totalAgents).toBe(2);
    });
  });

  describe('GET /api/sessions?countOnly=true', () => {
    it('returns only count when countOnly=true', async () => {
      await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_1',
          agentId: 'agent_1',
          eventType: 'session_started',
          timestamp: todayAt(1),
          payload: { agentName: 'Agent 1', tags: [] },
        },
        {
          sessionId: 'sess_2',
          agentId: 'agent_1',
          eventType: 'session_started',
          timestamp: todayAt(2),
          payload: { agentName: 'Agent 1', tags: [] },
        },
      ]);

      const res = await app.request('/api/sessions?countOnly=true', {
        headers: authHeaders(apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ count: 2 });
      // Should NOT have sessions array
      expect(body.sessions).toBeUndefined();
    });

    it('returns count=0 when no sessions', async () => {
      const res = await app.request('/api/sessions?countOnly=true', {
        headers: authHeaders(apiKey),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ count: 0 });
    });

    it('respects filters with countOnly', async () => {
      await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_a1',
          agentId: 'agent_1',
          eventType: 'session_started',
          timestamp: todayAt(1),
          payload: { agentName: 'Agent 1', tags: [] },
        },
        {
          sessionId: 'sess_b1',
          agentId: 'agent_2',
          eventType: 'session_started',
          timestamp: todayAt(2),
          payload: { agentName: 'Agent 2', tags: [] },
        },
      ]);

      const res = await app.request('/api/sessions?countOnly=true&agentId=agent_1', {
        headers: authHeaders(apiKey),
      });
      const body = await res.json();
      expect(body).toEqual({ count: 1 });
    });

    it('still returns full response without countOnly', async () => {
      await ingestEvents(app, apiKey, [
        {
          sessionId: 'sess_full',
          agentId: 'agent_1',
          eventType: 'session_started',
          timestamp: todayAt(1),
          payload: { agentName: 'Agent 1', tags: [] },
        },
      ]);

      const res = await app.request('/api/sessions', {
        headers: authHeaders(apiKey),
      });
      const body = await res.json();
      expect(body.sessions).toBeDefined();
      expect(body.total).toBeDefined();
      expect(body.hasMore).toBeDefined();
    });
  });
});
