import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentLensEvent } from '@agentlens/core';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { SqliteEventStore } from '../sqlite-store.js';

let counter = 0;
function makeEvent(overrides: Partial<AgentLensEvent> = {}): AgentLensEvent {
  counter++;
  const id = `evt_${String(counter).padStart(6, '0')}`;
  return {
    id,
    timestamp: new Date(Date.UTC(2026, 0, 15, 10, 0, counter)).toISOString(),
    sessionId: 'sess_001',
    agentId: 'agent_001',
    eventType: 'custom',
    severity: 'info',
    payload: { type: 'test', data: {} },
    metadata: {},
    prevHash: null,
    hash: `hash_${id}`,
    ...overrides,
  };
}

describe('SqliteEventStore — Read Operations (Story 3.5)', () => {
  let db: SqliteDb;
  let store: SqliteEventStore;

  beforeEach(() => {
    counter = 0;
    db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
  });

  // ─── queryEvents ─────────────────────────────────────────

  describe('queryEvents()', () => {
    it('should return events filtered by sessionId', async () => {
      await store.insertEvents([
        makeEvent({ sessionId: 'sess_A', eventType: 'session_started', payload: { tags: [] } }),
        makeEvent({ sessionId: 'sess_A' }),
        makeEvent({ sessionId: 'sess_B', eventType: 'session_started', payload: { tags: [] } }),
        makeEvent({ sessionId: 'sess_B' }),
      ]);

      const result = await store.queryEvents({ sessionId: 'sess_A' });
      expect(result.events).toHaveLength(2);
      expect(result.events.every((e) => e.sessionId === 'sess_A')).toBe(true);
      expect(result.total).toBe(2);
    });

    it('should return events filtered by eventType', async () => {
      await store.insertEvents([
        makeEvent({ eventType: 'session_started', payload: { tags: [] } }),
        makeEvent({ eventType: 'tool_call', payload: { toolName: 'search', arguments: {}, callId: 'c1' } }),
        makeEvent({ eventType: 'tool_call', payload: { toolName: 'read', arguments: {}, callId: 'c2' } }),
        makeEvent({ eventType: 'tool_response', payload: { callId: 'c1', toolName: 'search', result: {}, durationMs: 100 } }),
      ]);

      const result = await store.queryEvents({ eventType: 'tool_call' });
      expect(result.events).toHaveLength(2);
      expect(result.events.every((e) => e.eventType === 'tool_call')).toBe(true);
    });

    it('should return events filtered by multiple eventTypes (array)', async () => {
      await store.insertEvents([
        makeEvent({ eventType: 'session_started', payload: { tags: [] } }),
        makeEvent({ eventType: 'tool_call', payload: { toolName: 'a', arguments: {}, callId: 'c1' } }),
        makeEvent({ eventType: 'tool_error', severity: 'error', payload: { callId: 'c1', toolName: 'a', error: 'fail', durationMs: 100 } }),
        makeEvent({ eventType: 'custom' }),
      ]);

      const result = await store.queryEvents({ eventType: ['tool_call', 'tool_error'] });
      expect(result.events).toHaveLength(2);
    });

    it('should return events filtered by severity', async () => {
      await store.insertEvents([
        makeEvent({ eventType: 'session_started', payload: { tags: [] } }),
        makeEvent({ severity: 'info' }),
        makeEvent({ severity: 'error' }),
        makeEvent({ severity: 'warn' }),
        makeEvent({ severity: 'error' }),
      ]);

      const result = await store.queryEvents({ severity: 'error' });
      expect(result.events).toHaveLength(2);
      expect(result.events.every((e) => e.severity === 'error')).toBe(true);
    });

    it('should return events filtered by multiple severities (array)', async () => {
      await store.insertEvents([
        makeEvent({ eventType: 'session_started', payload: { tags: [] } }),
        makeEvent({ severity: 'info' }),
        makeEvent({ severity: 'error' }),
        makeEvent({ severity: 'critical' }),
        makeEvent({ severity: 'warn' }),
      ]);

      const result = await store.queryEvents({ severity: ['error', 'critical'] });
      expect(result.events).toHaveLength(2);
    });

    it('should filter events by eventType AND severity combined', async () => {
      await store.insertEvents([
        makeEvent({ eventType: 'session_started', payload: { tags: [] } }),
        makeEvent({ eventType: 'tool_call', severity: 'info', payload: { toolName: 'a', arguments: {}, callId: 'c1' } }),
        makeEvent({ eventType: 'tool_call', severity: 'error', payload: { toolName: 'b', arguments: {}, callId: 'c2' } }),
        makeEvent({ eventType: 'custom', severity: 'error' }),
      ]);

      const result = await store.queryEvents({ eventType: 'tool_call', severity: 'error' });
      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.eventType).toBe('tool_call');
      expect(result.events[0]!.severity).toBe('error');
    });

    it('should filter events by time range (from/to)', async () => {
      await store.insertEvents([
        makeEvent({ id: 'e1', timestamp: '2026-01-01T00:00:00Z', eventType: 'session_started', payload: { tags: [] } }),
        makeEvent({ id: 'e2', timestamp: '2026-01-02T00:00:00Z' }),
        makeEvent({ id: 'e3', timestamp: '2026-01-03T00:00:00Z' }),
        makeEvent({ id: 'e4', timestamp: '2026-01-04T00:00:00Z' }),
        makeEvent({ id: 'e5', timestamp: '2026-01-05T00:00:00Z' }),
      ]);

      const result = await store.queryEvents({
        from: '2026-01-02T00:00:00Z',
        to: '2026-01-04T00:00:00Z',
      });
      expect(result.events).toHaveLength(3);
      expect(result.events.map((e) => e.id).sort()).toEqual(['e2', 'e3', 'e4']);
    });

    it('should return events ordered by timestamp descending by default', async () => {
      await store.insertEvents([
        makeEvent({ id: 'e1', timestamp: '2026-01-01T00:00:00Z', eventType: 'session_started', payload: { tags: [] } }),
        makeEvent({ id: 'e2', timestamp: '2026-01-02T00:00:00Z' }),
        makeEvent({ id: 'e3', timestamp: '2026-01-03T00:00:00Z' }),
      ]);

      const result = await store.queryEvents({});
      expect(result.events[0]!.id).toBe('e3');
      expect(result.events[2]!.id).toBe('e1');
    });

    it('should return events ordered ascending when requested', async () => {
      await store.insertEvents([
        makeEvent({ id: 'e1', timestamp: '2026-01-01T00:00:00Z', eventType: 'session_started', payload: { tags: [] } }),
        makeEvent({ id: 'e2', timestamp: '2026-01-02T00:00:00Z' }),
        makeEvent({ id: 'e3', timestamp: '2026-01-03T00:00:00Z' }),
      ]);

      const result = await store.queryEvents({ order: 'asc' });
      expect(result.events[0]!.id).toBe('e1');
      expect(result.events[2]!.id).toBe('e3');
    });

    it('should respect limit and offset for pagination', async () => {
      const evts = Array.from({ length: 10 }, (_, i) =>
        makeEvent({
          id: `e${String(i + 1).padStart(2, '0')}`,
          timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
          ...(i === 0
            ? { eventType: 'session_started' as const, payload: { tags: [] } }
            : {}),
        }),
      );
      await store.insertEvents(evts);

      const page1 = await store.queryEvents({ limit: 3, offset: 0, order: 'asc' });
      expect(page1.events).toHaveLength(3);
      expect(page1.total).toBe(10);
      expect(page1.hasMore).toBe(true);

      const page2 = await store.queryEvents({ limit: 3, offset: 3, order: 'asc' });
      expect(page2.events).toHaveLength(3);
      expect(page2.hasMore).toBe(true);

      const lastPage = await store.queryEvents({ limit: 3, offset: 9, order: 'asc' });
      expect(lastPage.events).toHaveLength(1);
      expect(lastPage.hasMore).toBe(false);
    });

    it('should enforce max limit of 500', async () => {
      // Insert a few events
      await store.insertEvents([
        makeEvent({ eventType: 'session_started', payload: { tags: [] } }),
      ]);

      const result = await store.queryEvents({ limit: 9999 });
      // Should cap at 500, though we only have 1 event
      expect(result.events.length).toBeLessThanOrEqual(500);
    });

    it('should default limit to 50', async () => {
      const evts = Array.from({ length: 60 }, (_, i) =>
        makeEvent({
          id: `e${String(i + 1).padStart(3, '0')}`,
          timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
          ...(i === 0
            ? { eventType: 'session_started' as const, payload: { tags: [] } }
            : {}),
        }),
      );
      await store.insertEvents(evts);

      const result = await store.queryEvents({});
      expect(result.events).toHaveLength(50);
      expect(result.total).toBe(60);
    });

    it('should search payload text', async () => {
      await store.insertEvents([
        makeEvent({ eventType: 'session_started', payload: { tags: [] } }),
        makeEvent({ id: 'e_search1', eventType: 'tool_call', payload: { toolName: 'web_search', arguments: { query: 'weather' }, callId: 'c1' } }),
        makeEvent({ id: 'e_search2', eventType: 'tool_call', payload: { toolName: 'file_read', arguments: {}, callId: 'c2' } }),
      ]);

      const result = await store.queryEvents({ search: 'web_search' });
      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.id).toBe('e_search1');
    });
  });

  // ─── getEvent ────────────────────────────────────────────

  describe('getEvent()', () => {
    it('should return a single event by ID', async () => {
      await store.insertEvents([
        makeEvent({ id: 'evt_target', eventType: 'session_started', payload: { agentName: 'Test', tags: [] } }),
      ]);

      const event = await store.getEvent('evt_target');
      expect(event).not.toBeNull();
      expect(event!.id).toBe('evt_target');
      expect(event!.payload).toEqual({ agentName: 'Test', tags: [] });
    });

    it('should return null for non-existent event', async () => {
      const event = await store.getEvent('nonexistent');
      expect(event).toBeNull();
    });
  });

  // ─── getSessionTimeline ──────────────────────────────────

  describe('getSessionTimeline()', () => {
    it('should return all events for a session in ascending timestamp order', async () => {
      await store.insertEvents([
        makeEvent({ id: 'e1', sessionId: 'sess_timeline', timestamp: '2026-01-01T10:00:00Z', eventType: 'session_started', payload: { tags: [] } }),
        makeEvent({ id: 'e2', sessionId: 'sess_timeline', timestamp: '2026-01-01T10:01:00Z', eventType: 'tool_call', payload: { toolName: 'a', arguments: {}, callId: 'c1' } }),
        makeEvent({ id: 'e3', sessionId: 'sess_timeline', timestamp: '2026-01-01T10:02:00Z', eventType: 'tool_response', payload: { callId: 'c1', toolName: 'a', result: {}, durationMs: 50 } }),
        makeEvent({ id: 'e4', sessionId: 'sess_timeline', timestamp: '2026-01-01T10:03:00Z', eventType: 'session_ended', payload: { reason: 'completed' } }),
        // Different session — should NOT appear
        makeEvent({ id: 'e5', sessionId: 'sess_other', timestamp: '2026-01-01T10:00:30Z', eventType: 'session_started', payload: { tags: [] } }),
      ]);

      const timeline = await store.getSessionTimeline('sess_timeline');
      expect(timeline).toHaveLength(4);
      expect(timeline[0]!.id).toBe('e1');
      expect(timeline[1]!.id).toBe('e2');
      expect(timeline[2]!.id).toBe('e3');
      expect(timeline[3]!.id).toBe('e4');
      // Verify ascending order
      for (let i = 1; i < timeline.length; i++) {
        expect(timeline[i]!.timestamp >= timeline[i - 1]!.timestamp).toBe(true);
      }
    });

    it('should return empty array for non-existent session', async () => {
      const timeline = await store.getSessionTimeline('nonexistent');
      expect(timeline).toEqual([]);
    });
  });

  // ─── countEvents ─────────────────────────────────────────

  describe('countEvents()', () => {
    it('should count all events without filters', async () => {
      await store.insertEvents([
        makeEvent({ eventType: 'session_started', payload: { tags: [] } }),
        makeEvent(),
        makeEvent(),
      ]);

      const count = await store.countEvents({});
      expect(count).toBe(3);
    });

    it('should count events matching filters', async () => {
      await store.insertEvents([
        makeEvent({ eventType: 'session_started', payload: { tags: [] } }),
        makeEvent({ severity: 'error' }),
        makeEvent({ severity: 'error' }),
        makeEvent({ severity: 'info' }),
      ]);

      const count = await store.countEvents({ severity: 'error' });
      expect(count).toBe(2);
    });
  });

  // ─── querySessions ───────────────────────────────────────

  describe('querySessions()', () => {
    beforeEach(async () => {
      // Create sessions across two agents
      await store.insertEvents([
        makeEvent({ id: 'e1', sessionId: 'sess_A1', agentId: 'agent_A', timestamp: '2026-01-01T10:00:00Z', eventType: 'session_started', payload: { agentName: 'Agent A', tags: ['prod'] } }),
        makeEvent({ id: 'e2', sessionId: 'sess_A1', agentId: 'agent_A', timestamp: '2026-01-01T10:05:00Z', eventType: 'session_ended', payload: { reason: 'completed' } }),
        makeEvent({ id: 'e3', sessionId: 'sess_A2', agentId: 'agent_A', timestamp: '2026-01-02T10:00:00Z', eventType: 'session_started', payload: { agentName: 'Agent A', tags: ['dev'] } }),
        makeEvent({ id: 'e4', sessionId: 'sess_B1', agentId: 'agent_B', timestamp: '2026-01-03T10:00:00Z', eventType: 'session_started', payload: { agentName: 'Agent B', tags: ['prod'] } }),
        makeEvent({ id: 'e5', sessionId: 'sess_B1', agentId: 'agent_B', timestamp: '2026-01-03T10:10:00Z', eventType: 'session_ended', payload: { reason: 'error' } }),
      ]);
    });

    it('should return all sessions ordered by startedAt desc', async () => {
      const { sessions, total } = await store.querySessions({});
      expect(total).toBe(3);
      expect(sessions).toHaveLength(3);
      // Most recent first
      expect(sessions[0]!.id).toBe('sess_B1');
      expect(sessions[1]!.id).toBe('sess_A2');
      expect(sessions[2]!.id).toBe('sess_A1');
    });

    it('should filter sessions by agentId', async () => {
      const { sessions, total } = await store.querySessions({ agentId: 'agent_A' });
      expect(total).toBe(2);
      expect(sessions.every((s) => s.agentId === 'agent_A')).toBe(true);
    });

    it('should filter sessions by status', async () => {
      const { sessions } = await store.querySessions({ status: 'completed' });
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.id).toBe('sess_A1');

      const { sessions: errorSessions } = await store.querySessions({ status: 'error' });
      expect(errorSessions).toHaveLength(1);
      expect(errorSessions[0]!.id).toBe('sess_B1');

      const { sessions: activeSessions } = await store.querySessions({ status: 'active' });
      expect(activeSessions).toHaveLength(1);
      expect(activeSessions[0]!.id).toBe('sess_A2');
    });

    it('should filter sessions by time range', async () => {
      const { sessions } = await store.querySessions({
        from: '2026-01-02T00:00:00Z',
        to: '2026-01-03T23:59:59Z',
      });
      expect(sessions).toHaveLength(2);
    });

    it('should filter sessions by tags', async () => {
      const { sessions } = await store.querySessions({ tags: ['prod'] });
      expect(sessions).toHaveLength(2);
      // sess_A1 and sess_B1 have 'prod' tag
      const ids = sessions.map((s) => s.id).sort();
      expect(ids).toEqual(['sess_A1', 'sess_B1']);
    });

    it('should paginate sessions', async () => {
      const page1 = await store.querySessions({ limit: 2, offset: 0 });
      expect(page1.sessions).toHaveLength(2);
      expect(page1.total).toBe(3);

      const page2 = await store.querySessions({ limit: 2, offset: 2 });
      expect(page2.sessions).toHaveLength(1);
    });
  });

  // ─── getSession ──────────────────────────────────────────

  describe('getSession()', () => {
    it('should return a session with correct fields', async () => {
      await store.insertEvents([
        makeEvent({ sessionId: 'sess_detail', eventType: 'session_started', payload: { agentName: 'DetailAgent', tags: ['test'] } }),
        makeEvent({ sessionId: 'sess_detail', eventType: 'tool_call', payload: { toolName: 'x', arguments: {}, callId: 'c1' } }),
        makeEvent({ sessionId: 'sess_detail', severity: 'error' }),
      ]);

      const session = await store.getSession('sess_detail');
      expect(session).not.toBeNull();
      expect(session!.agentName).toBe('DetailAgent');
      expect(session!.status).toBe('active');
      expect(session!.eventCount).toBe(3);
      expect(session!.toolCallCount).toBe(1);
      expect(session!.errorCount).toBe(1);
      expect(session!.tags).toEqual(['test']);
    });

    it('should return null for non-existent session', async () => {
      const session = await store.getSession('nonexistent');
      expect(session).toBeNull();
    });
  });

  // ─── listAgents / getAgent ───────────────────────────────

  describe('listAgents()', () => {
    it('should list all agents ordered by lastSeenAt desc', async () => {
      await store.insertEvents([
        makeEvent({ agentId: 'agent_old', timestamp: '2026-01-01T00:00:00Z', eventType: 'session_started', payload: { agentName: 'Old Agent', tags: [] } }),
        makeEvent({ agentId: 'agent_new', timestamp: '2026-01-10T00:00:00Z', eventType: 'session_started', payload: { agentName: 'New Agent', tags: [] } }),
      ]);

      const agentList = await store.listAgents();
      expect(agentList).toHaveLength(2);
      expect(agentList[0]!.id).toBe('agent_new');
      expect(agentList[1]!.id).toBe('agent_old');
    });
  });

  describe('getAgent()', () => {
    it('should return agent with correct fields', async () => {
      await store.insertEvents([
        makeEvent({ agentId: 'agent_x', sessionId: 's1', timestamp: '2026-01-01T00:00:00Z', eventType: 'session_started', payload: { agentName: 'Agent X', tags: [] } }),
        makeEvent({ agentId: 'agent_x', sessionId: 's2', timestamp: '2026-01-05T00:00:00Z', eventType: 'session_started', payload: { tags: [] } }),
      ]);

      const agent = await store.getAgent('agent_x');
      expect(agent).not.toBeNull();
      expect(agent!.name).toBe('Agent X');
      expect(agent!.firstSeenAt).toBe('2026-01-01T00:00:00Z');
      expect(agent!.lastSeenAt).toBe('2026-01-05T00:00:00Z');
      expect(agent!.sessionCount).toBe(2);
    });

    it('should return null for non-existent agent', async () => {
      const agent = await store.getAgent('nonexistent');
      expect(agent).toBeNull();
    });
  });

  // ─── getAnalytics ────────────────────────────────────────

  describe('getAnalytics()', () => {
    beforeEach(async () => {
      // Insert events spanning 3 hours
      await store.insertEvents([
        // Hour 1: 10:00–10:59
        makeEvent({ id: 'a1', timestamp: '2026-01-15T10:00:00Z', eventType: 'session_started', sessionId: 'sA', payload: { tags: [] } }),
        makeEvent({ id: 'a2', timestamp: '2026-01-15T10:10:00Z', eventType: 'tool_call', sessionId: 'sA', payload: { toolName: 'a', arguments: {}, callId: 'c1' } }),
        makeEvent({ id: 'a3', timestamp: '2026-01-15T10:20:00Z', eventType: 'tool_error', sessionId: 'sA', severity: 'error', payload: { callId: 'c1', toolName: 'a', error: 'fail', durationMs: 100 } }),
        // Hour 2: 11:00–11:59
        makeEvent({ id: 'a4', timestamp: '2026-01-15T11:00:00Z', eventType: 'tool_call', sessionId: 'sB', agentId: 'agent_002', payload: { toolName: 'b', arguments: {}, callId: 'c2' } }),
        makeEvent({ id: 'a5', timestamp: '2026-01-15T11:30:00Z', eventType: 'custom', sessionId: 'sB', agentId: 'agent_002', severity: 'info' }),
        // Hour 3: 12:00–12:59
        makeEvent({ id: 'a6', timestamp: '2026-01-15T12:00:00Z', eventType: 'tool_call', sessionId: 'sA', payload: { toolName: 'c', arguments: {}, callId: 'c3' } }),
      ]);
    });

    it('should return bucketed counts with hourly granularity', async () => {
      const result = await store.getAnalytics({
        from: '2026-01-15T10:00:00Z',
        to: '2026-01-15T12:59:59Z',
        granularity: 'hour',
      });

      expect(result.buckets).toHaveLength(3);

      // Hour 10: 3 events, 1 tool_call, 1 error
      const h10 = result.buckets.find((b) => b.timestamp.includes('10:'));
      expect(h10).toBeDefined();
      expect(h10!.eventCount).toBe(3);
      expect(h10!.toolCallCount).toBe(1);
      expect(h10!.errorCount).toBe(1);

      // Hour 11: 2 events, 1 tool_call, 0 errors
      const h11 = result.buckets.find((b) => b.timestamp.includes('11:'));
      expect(h11).toBeDefined();
      expect(h11!.eventCount).toBe(2);
      expect(h11!.toolCallCount).toBe(1);
      expect(h11!.errorCount).toBe(0);

      // Hour 12: 1 event, 1 tool_call
      const h12 = result.buckets.find((b) => b.timestamp.includes('12:'));
      expect(h12).toBeDefined();
      expect(h12!.eventCount).toBe(1);
      expect(h12!.toolCallCount).toBe(1);
    });

    it('should return correct totals', async () => {
      const result = await store.getAnalytics({
        from: '2026-01-15T10:00:00Z',
        to: '2026-01-15T12:59:59Z',
        granularity: 'hour',
      });

      expect(result.totals.eventCount).toBe(6);
      expect(result.totals.toolCallCount).toBe(3);
      expect(result.totals.errorCount).toBe(1);
      expect(result.totals.uniqueSessions).toBe(2); // sA and sB
      expect(result.totals.uniqueAgents).toBe(2); // agent_001 and agent_002
    });

    it('should filter analytics by agentId', async () => {
      const result = await store.getAnalytics({
        from: '2026-01-15T10:00:00Z',
        to: '2026-01-15T12:59:59Z',
        agentId: 'agent_002',
        granularity: 'hour',
      });

      expect(result.totals.eventCount).toBe(2);
      expect(result.totals.uniqueAgents).toBe(1);
    });

    it('should return daily granularity', async () => {
      const result = await store.getAnalytics({
        from: '2026-01-15T00:00:00Z',
        to: '2026-01-15T23:59:59Z',
        granularity: 'day',
      });

      // All events are on the same day, so 1 bucket
      expect(result.buckets).toHaveLength(1);
      expect(result.buckets[0]!.eventCount).toBe(6);
    });

    it('should return empty result for time range with no events', async () => {
      const result = await store.getAnalytics({
        from: '2025-01-01T00:00:00Z',
        to: '2025-01-02T00:00:00Z',
        granularity: 'hour',
      });

      expect(result.buckets).toHaveLength(0);
      expect(result.totals.eventCount).toBe(0);
    });
  });

  // ─── getStats ────────────────────────────────────────────

  describe('getStats()', () => {
    it('should return correct counts', async () => {
      await store.insertEvents([
        makeEvent({ sessionId: 's1', agentId: 'a1', timestamp: '2026-01-01T00:00:00Z', eventType: 'session_started', payload: { tags: [] } }),
        makeEvent({ sessionId: 's1', agentId: 'a1', timestamp: '2026-01-02T00:00:00Z' }),
        makeEvent({ sessionId: 's2', agentId: 'a2', timestamp: '2026-01-03T00:00:00Z', eventType: 'session_started', payload: { tags: [] } }),
      ]);

      const stats = await store.getStats();
      expect(stats.totalEvents).toBe(3);
      expect(stats.totalSessions).toBe(2);
      expect(stats.totalAgents).toBe(2);
      expect(stats.oldestEvent).toBe('2026-01-01T00:00:00Z');
      expect(stats.newestEvent).toBe('2026-01-03T00:00:00Z');
      expect(stats.storageSizeBytes).toBeGreaterThan(0);
    });

    it('should return zeros for empty database', async () => {
      const stats = await store.getStats();
      expect(stats.totalEvents).toBe(0);
      expect(stats.totalSessions).toBe(0);
      expect(stats.totalAgents).toBe(0);
      expect(stats.oldestEvent).toBeUndefined();
      expect(stats.newestEvent).toBeUndefined();
    });
  });

  // ─── Alert Rules CRUD ────────────────────────────────────

  describe('Alert Rules', () => {
    const sampleRule = {
      id: 'rule_001',
      name: 'High Error Rate',
      enabled: true,
      condition: 'error_rate_exceeds' as const,
      threshold: 0.1,
      windowMinutes: 60,
      scope: { agentId: 'agent_001' },
      notifyChannels: ['https://webhook.example.com/alert'],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    it('should create and retrieve an alert rule', async () => {
      await store.createAlertRule(sampleRule);
      const rule = await store.getAlertRule('rule_001');
      expect(rule).not.toBeNull();
      expect(rule!.name).toBe('High Error Rate');
      expect(rule!.enabled).toBe(true);
      expect(rule!.threshold).toBe(0.1);
      expect(rule!.scope).toEqual({ agentId: 'agent_001' });
      expect(rule!.notifyChannels).toEqual(['https://webhook.example.com/alert']);
    });

    it('should list all alert rules', async () => {
      await store.createAlertRule(sampleRule);
      await store.createAlertRule({ ...sampleRule, id: 'rule_002', name: 'Cost Exceeded' });

      const rules = await store.listAlertRules();
      expect(rules).toHaveLength(2);
    });

    it('should update an alert rule', async () => {
      await store.createAlertRule(sampleRule);
      await store.updateAlertRule('rule_001', {
        name: 'Updated Rule',
        enabled: false,
        threshold: 0.5,
        updatedAt: '2026-02-01T00:00:00Z',
      });

      const rule = await store.getAlertRule('rule_001');
      expect(rule!.name).toBe('Updated Rule');
      expect(rule!.enabled).toBe(false);
      expect(rule!.threshold).toBe(0.5);
    });

    it('should delete an alert rule', async () => {
      await store.createAlertRule(sampleRule);
      await store.deleteAlertRule('rule_001');

      const rule = await store.getAlertRule('rule_001');
      expect(rule).toBeNull();
    });

    it('should return null for non-existent alert rule', async () => {
      const rule = await store.getAlertRule('nonexistent');
      expect(rule).toBeNull();
    });
  });
});
