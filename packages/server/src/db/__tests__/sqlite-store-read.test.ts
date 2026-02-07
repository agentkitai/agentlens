import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentLensEvent } from '@agentlens/core';
import { computeEventHash } from '@agentlens/core';
import { sql } from 'drizzle-orm';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { SqliteEventStore } from '../sqlite-store.js';
import { NotFoundError } from '../errors.js';
import { safeJsonParse } from '../sqlite-store.js';

let counter = 0;

/**
 * Create a valid event with correct hash. For chains within a batch, use makeChain().
 */
function makeEvent(overrides: Partial<AgentLensEvent> = {}): AgentLensEvent {
  counter++;
  const id = overrides.id ?? `evt_${String(counter).padStart(6, '0')}`;
  const base = {
    id,
    timestamp: overrides.timestamp ?? new Date(Date.UTC(2026, 0, 15, 10, 0, counter)).toISOString(),
    sessionId: overrides.sessionId ?? 'sess_001',
    agentId: overrides.agentId ?? 'agent_001',
    eventType: overrides.eventType ?? 'custom',
    severity: overrides.severity ?? 'info',
    payload: overrides.payload ?? { type: 'test', data: {} },
    metadata: overrides.metadata ?? {},
    prevHash: overrides.prevHash ?? null,
  };
  const hash = computeEventHash({
    id: base.id,
    timestamp: base.timestamp,
    sessionId: base.sessionId,
    agentId: base.agentId,
    eventType: base.eventType,
    severity: base.severity,
    payload: base.payload,
    metadata: base.metadata,
    prevHash: base.prevHash,
  });
  return { ...base, hash } as AgentLensEvent;
}

/**
 * Build a chain of events for a session, correctly linking hashes.
 */
function makeChain(overridesList: Array<Partial<AgentLensEvent>>, startPrevHash: string | null = null): AgentLensEvent[] {
  const chain: AgentLensEvent[] = [];
  let prevHash = startPrevHash;
  for (const overrides of overridesList) {
    counter++;
    const id = overrides.id ?? `evt_${String(counter).padStart(6, '0')}`;
    const base = {
      id,
      timestamp: overrides.timestamp ?? new Date(Date.UTC(2026, 0, 15, 10, 0, counter)).toISOString(),
      sessionId: overrides.sessionId ?? 'sess_001',
      agentId: overrides.agentId ?? 'agent_001',
      eventType: overrides.eventType ?? 'custom',
      severity: overrides.severity ?? 'info',
      payload: overrides.payload ?? { type: 'test', data: {} },
      metadata: overrides.metadata ?? {},
      prevHash,
    };
    const hash = computeEventHash({
      id: base.id,
      timestamp: base.timestamp,
      sessionId: base.sessionId,
      agentId: base.agentId,
      eventType: base.eventType,
      severity: base.severity,
      payload: base.payload,
      metadata: base.metadata,
      prevHash: base.prevHash,
    });
    const event = { ...base, hash } as AgentLensEvent;
    chain.push(event);
    prevHash = hash;
  }
  return chain;
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
      // Two separate sessions — each starts its own chain
      const chainA = makeChain([
        { sessionId: 'sess_A', eventType: 'session_started', payload: { tags: [] } },
        { sessionId: 'sess_A' },
      ]);
      const chainB = makeChain([
        { sessionId: 'sess_B', eventType: 'session_started', payload: { tags: [] } },
        { sessionId: 'sess_B' },
      ]);

      await store.insertEvents(chainA);
      await store.insertEvents(chainB);

      const result = await store.queryEvents({ sessionId: 'sess_A' });
      expect(result.events).toHaveLength(2);
      expect(result.events.every((e) => e.sessionId === 'sess_A')).toBe(true);
      expect(result.total).toBe(2);
    });

    it('should return events filtered by eventType', async () => {
      const chain = makeChain([
        { eventType: 'session_started', payload: { tags: [] } },
        { eventType: 'tool_call', payload: { toolName: 'search', arguments: {}, callId: 'c1' } },
        { eventType: 'tool_call', payload: { toolName: 'read', arguments: {}, callId: 'c2' } },
        { eventType: 'tool_response', payload: { callId: 'c1', toolName: 'search', result: {}, durationMs: 100 } },
      ]);

      await store.insertEvents(chain);

      const result = await store.queryEvents({ eventType: 'tool_call' });
      expect(result.events).toHaveLength(2);
      expect(result.events.every((e) => e.eventType === 'tool_call')).toBe(true);
    });

    it('should return events filtered by multiple eventTypes (array)', async () => {
      const chain = makeChain([
        { eventType: 'session_started', payload: { tags: [] } },
        { eventType: 'tool_call', payload: { toolName: 'a', arguments: {}, callId: 'c1' } },
        { eventType: 'tool_error', severity: 'error', payload: { callId: 'c1', toolName: 'a', error: 'fail', durationMs: 100 } },
        { eventType: 'custom' },
      ]);

      await store.insertEvents(chain);

      const result = await store.queryEvents({ eventType: ['tool_call', 'tool_error'] });
      expect(result.events).toHaveLength(2);
    });

    it('should return events filtered by severity', async () => {
      const chain = makeChain([
        { eventType: 'session_started', payload: { tags: [] } },
        { severity: 'info' },
        { severity: 'error' },
        { severity: 'warn' },
        { severity: 'error' },
      ]);

      await store.insertEvents(chain);

      const result = await store.queryEvents({ severity: 'error' });
      expect(result.events).toHaveLength(2);
      expect(result.events.every((e) => e.severity === 'error')).toBe(true);
    });

    it('should return events filtered by multiple severities (array)', async () => {
      const chain = makeChain([
        { eventType: 'session_started', payload: { tags: [] } },
        { severity: 'info' },
        { severity: 'error' },
        { severity: 'critical' },
        { severity: 'warn' },
      ]);

      await store.insertEvents(chain);

      const result = await store.queryEvents({ severity: ['error', 'critical'] });
      expect(result.events).toHaveLength(2);
    });

    it('should filter events by eventType AND severity combined', async () => {
      const chain = makeChain([
        { eventType: 'session_started', payload: { tags: [] } },
        { eventType: 'tool_call', severity: 'info', payload: { toolName: 'a', arguments: {}, callId: 'c1' } },
        { eventType: 'tool_call', severity: 'error', payload: { toolName: 'b', arguments: {}, callId: 'c2' } },
        { eventType: 'custom', severity: 'error' },
      ]);

      await store.insertEvents(chain);

      const result = await store.queryEvents({ eventType: 'tool_call', severity: 'error' });
      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.eventType).toBe('tool_call');
      expect(result.events[0]!.severity).toBe('error');
    });

    it('should filter events by time range (from/to)', async () => {
      const chain = makeChain([
        { id: 'e1', timestamp: '2026-01-01T00:00:00Z', eventType: 'session_started', payload: { tags: [] } },
        { id: 'e2', timestamp: '2026-01-02T00:00:00Z' },
        { id: 'e3', timestamp: '2026-01-03T00:00:00Z' },
        { id: 'e4', timestamp: '2026-01-04T00:00:00Z' },
        { id: 'e5', timestamp: '2026-01-05T00:00:00Z' },
      ]);

      await store.insertEvents(chain);

      const result = await store.queryEvents({
        from: '2026-01-02T00:00:00Z',
        to: '2026-01-04T00:00:00Z',
      });
      expect(result.events).toHaveLength(3);
      expect(result.events.map((e) => e.id).sort()).toEqual(['e2', 'e3', 'e4']);
    });

    it('should return events ordered by timestamp descending by default', async () => {
      const chain = makeChain([
        { id: 'e1', timestamp: '2026-01-01T00:00:00Z', eventType: 'session_started', payload: { tags: [] } },
        { id: 'e2', timestamp: '2026-01-02T00:00:00Z' },
        { id: 'e3', timestamp: '2026-01-03T00:00:00Z' },
      ]);

      await store.insertEvents(chain);

      const result = await store.queryEvents({});
      expect(result.events[0]!.id).toBe('e3');
      expect(result.events[2]!.id).toBe('e1');
    });

    it('should return events ordered ascending when requested', async () => {
      const chain = makeChain([
        { id: 'e1', timestamp: '2026-01-01T00:00:00Z', eventType: 'session_started', payload: { tags: [] } },
        { id: 'e2', timestamp: '2026-01-02T00:00:00Z' },
        { id: 'e3', timestamp: '2026-01-03T00:00:00Z' },
      ]);

      await store.insertEvents(chain);

      const result = await store.queryEvents({ order: 'asc' });
      expect(result.events[0]!.id).toBe('e1');
      expect(result.events[2]!.id).toBe('e3');
    });

    it('should respect limit and offset for pagination', async () => {
      const chain = makeChain(
        Array.from({ length: 10 }, (_, i) => ({
          id: `e${String(i + 1).padStart(2, '0')}`,
          timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
          ...(i === 0
            ? { eventType: 'session_started' as const, payload: { tags: [] } }
            : {}),
        })),
      );
      await store.insertEvents(chain);

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
      await store.insertEvents([
        makeEvent({ eventType: 'session_started', payload: { tags: [] } }),
      ]);

      const result = await store.queryEvents({ limit: 9999 });
      expect(result.events.length).toBeLessThanOrEqual(500);
    });

    it('should default limit to 50', async () => {
      const chain = makeChain(
        Array.from({ length: 60 }, (_, i) => ({
          id: `e${String(i + 1).padStart(3, '0')}`,
          timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
          ...(i === 0
            ? { eventType: 'session_started' as const, payload: { tags: [] } }
            : {}),
        })),
      );
      await store.insertEvents(chain);

      const result = await store.queryEvents({});
      expect(result.events).toHaveLength(50);
      expect(result.total).toBe(60);
    });

    it('should search payload text', async () => {
      const chain = makeChain([
        { eventType: 'session_started', payload: { tags: [] } },
        { id: 'e_search1', eventType: 'tool_call', payload: { toolName: 'web_search', arguments: { query: 'weather' }, callId: 'c1' } },
        { id: 'e_search2', eventType: 'tool_call', payload: { toolName: 'file_read', arguments: {}, callId: 'c2' } },
      ]);

      await store.insertEvents(chain);

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
      const chainTimeline = makeChain([
        { id: 'e1', sessionId: 'sess_timeline', timestamp: '2026-01-01T10:00:00Z', eventType: 'session_started', payload: { tags: [] } },
        { id: 'e2', sessionId: 'sess_timeline', timestamp: '2026-01-01T10:01:00Z', eventType: 'tool_call', payload: { toolName: 'a', arguments: {}, callId: 'c1' } },
        { id: 'e3', sessionId: 'sess_timeline', timestamp: '2026-01-01T10:02:00Z', eventType: 'tool_response', payload: { callId: 'c1', toolName: 'a', result: {}, durationMs: 50 } },
        { id: 'e4', sessionId: 'sess_timeline', timestamp: '2026-01-01T10:03:00Z', eventType: 'session_ended', payload: { reason: 'completed' } },
      ]);
      const chainOther = makeChain([
        { id: 'e5', sessionId: 'sess_other', timestamp: '2026-01-01T10:00:30Z', eventType: 'session_started', payload: { tags: [] } },
      ]);

      await store.insertEvents(chainTimeline);
      await store.insertEvents(chainOther);

      const timeline = await store.getSessionTimeline('sess_timeline');
      expect(timeline).toHaveLength(4);
      expect(timeline[0]!.id).toBe('e1');
      expect(timeline[1]!.id).toBe('e2');
      expect(timeline[2]!.id).toBe('e3');
      expect(timeline[3]!.id).toBe('e4');
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
      const chain = makeChain([
        { eventType: 'session_started', payload: { tags: [] } },
        {},
        {},
      ]);

      await store.insertEvents(chain);

      const count = await store.countEvents({});
      expect(count).toBe(3);
    });

    it('should count events matching filters', async () => {
      const chain = makeChain([
        { eventType: 'session_started', payload: { tags: [] } },
        { severity: 'error' },
        { severity: 'error' },
        { severity: 'info' },
      ]);

      await store.insertEvents(chain);

      const count = await store.countEvents({ severity: 'error' });
      expect(count).toBe(2);
    });
  });

  // ─── querySessions ───────────────────────────────────────

  describe('querySessions()', () => {
    beforeEach(async () => {
      // Create sessions across two agents — each session is its own chain
      const chainA1 = makeChain([
        { id: 'e1', sessionId: 'sess_A1', agentId: 'agent_A', timestamp: '2026-01-01T10:00:00Z', eventType: 'session_started', payload: { agentName: 'Agent A', tags: ['prod'] } },
        { id: 'e2', sessionId: 'sess_A1', agentId: 'agent_A', timestamp: '2026-01-01T10:05:00Z', eventType: 'session_ended', payload: { reason: 'completed' } },
      ]);
      const chainA2 = makeChain([
        { id: 'e3', sessionId: 'sess_A2', agentId: 'agent_A', timestamp: '2026-01-02T10:00:00Z', eventType: 'session_started', payload: { agentName: 'Agent A', tags: ['dev'] } },
      ]);
      const chainB1 = makeChain([
        { id: 'e4', sessionId: 'sess_B1', agentId: 'agent_B', timestamp: '2026-01-03T10:00:00Z', eventType: 'session_started', payload: { agentName: 'Agent B', tags: ['prod'] } },
        { id: 'e5', sessionId: 'sess_B1', agentId: 'agent_B', timestamp: '2026-01-03T10:10:00Z', eventType: 'session_ended', payload: { reason: 'error' } },
      ]);

      await store.insertEvents(chainA1);
      await store.insertEvents(chainA2);
      await store.insertEvents(chainB1);
    });

    it('should return all sessions ordered by startedAt desc', async () => {
      const { sessions, total } = await store.querySessions({});
      expect(total).toBe(3);
      expect(sessions).toHaveLength(3);
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
      const chain = makeChain([
        { sessionId: 'sess_detail', eventType: 'session_started', payload: { agentName: 'DetailAgent', tags: ['test'] } },
        { sessionId: 'sess_detail', eventType: 'tool_call', payload: { toolName: 'x', arguments: {}, callId: 'c1' } },
        { sessionId: 'sess_detail', severity: 'error' },
      ]);

      await store.insertEvents(chain);

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
      const chainOld = makeChain([
        { agentId: 'agent_old', sessionId: 'sess_old', timestamp: '2026-01-01T00:00:00Z', eventType: 'session_started', payload: { agentName: 'Old Agent', tags: [] } },
      ]);
      const chainNew = makeChain([
        { agentId: 'agent_new', sessionId: 'sess_new', timestamp: '2026-01-10T00:00:00Z', eventType: 'session_started', payload: { agentName: 'New Agent', tags: [] } },
      ]);

      // Different agents, different sessions — separate chains
      await store.insertEvents(chainOld);
      await store.insertEvents(chainNew);

      const agentList = await store.listAgents();
      expect(agentList).toHaveLength(2);
      expect(agentList[0]!.id).toBe('agent_new');
      expect(agentList[1]!.id).toBe('agent_old');
    });
  });

  describe('getAgent()', () => {
    it('should return agent with correct fields', async () => {
      const chain1 = makeChain([
        { agentId: 'agent_x', sessionId: 's1', timestamp: '2026-01-01T00:00:00Z', eventType: 'session_started', payload: { agentName: 'Agent X', tags: [] } },
      ]);
      const chain2 = makeChain([
        { agentId: 'agent_x', sessionId: 's2', timestamp: '2026-01-05T00:00:00Z', eventType: 'session_started', payload: { tags: [] } },
      ]);

      await store.insertEvents(chain1);
      await store.insertEvents(chain2);

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
      // Insert events spanning 3 hours — each session has its own chain
      const chainA = makeChain([
        // Hour 1: 10:00–10:59
        { id: 'a1', timestamp: '2026-01-15T10:00:00Z', eventType: 'session_started', sessionId: 'sA', payload: { tags: [] } },
        { id: 'a2', timestamp: '2026-01-15T10:10:00Z', eventType: 'tool_call', sessionId: 'sA', payload: { toolName: 'a', arguments: {}, callId: 'c1' } },
        { id: 'a3', timestamp: '2026-01-15T10:20:00Z', eventType: 'tool_error', sessionId: 'sA', severity: 'error', payload: { callId: 'c1', toolName: 'a', error: 'fail', durationMs: 100 } },
        // Hour 3: 12:00–12:59 (same session sA)
        { id: 'a6', timestamp: '2026-01-15T12:00:00Z', eventType: 'tool_call', sessionId: 'sA', payload: { toolName: 'c', arguments: {}, callId: 'c3' } },
      ]);
      const chainB = makeChain([
        // Hour 2: 11:00–11:59
        { id: 'a4', timestamp: '2026-01-15T11:00:00Z', eventType: 'tool_call', sessionId: 'sB', agentId: 'agent_002', payload: { toolName: 'b', arguments: {}, callId: 'c2' } },
        { id: 'a5', timestamp: '2026-01-15T11:30:00Z', eventType: 'custom', sessionId: 'sB', agentId: 'agent_002', severity: 'info' },
      ]);

      await store.insertEvents(chainA);
      await store.insertEvents(chainB);
    });

    it('should return bucketed counts with hourly granularity', async () => {
      const result = await store.getAnalytics({
        from: '2026-01-15T10:00:00Z',
        to: '2026-01-15T12:59:59Z',
        granularity: 'hour',
      });

      expect(result.buckets).toHaveLength(3);

      const h10 = result.buckets.find((b) => b.timestamp.includes('10:'));
      expect(h10).toBeDefined();
      expect(h10!.eventCount).toBe(3);
      expect(h10!.toolCallCount).toBe(1);
      expect(h10!.errorCount).toBe(1);

      const h11 = result.buckets.find((b) => b.timestamp.includes('11:'));
      expect(h11).toBeDefined();
      expect(h11!.eventCount).toBe(2);
      expect(h11!.toolCallCount).toBe(1);
      expect(h11!.errorCount).toBe(0);

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
      expect(result.totals.uniqueSessions).toBe(2);
      expect(result.totals.uniqueAgents).toBe(2);
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
      // Two separate sessions with different agents
      const chain1 = makeChain([
        { sessionId: 's1', agentId: 'a1', timestamp: '2026-01-01T00:00:00Z', eventType: 'session_started', payload: { tags: [] } },
        { sessionId: 's1', agentId: 'a1', timestamp: '2026-01-02T00:00:00Z' },
      ]);
      const chain2 = makeChain([
        { sessionId: 's2', agentId: 'a2', timestamp: '2026-01-03T00:00:00Z', eventType: 'session_started', payload: { tags: [] } },
      ]);

      await store.insertEvents(chain1);
      await store.insertEvents(chain2);

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

    // HIGH 8: Alert rule update/delete on missing IDs
    it('should throw NotFoundError when updating a non-existent alert rule', async () => {
      await expect(
        store.updateAlertRule('nonexistent', { name: 'foo' }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError when deleting a non-existent alert rule', async () => {
      await expect(
        store.deleteAlertRule('nonexistent'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ─── HIGH 4: Tag filtering exact matching ─────────────────

  describe('Tag filtering (HIGH 4)', () => {
    beforeEach(async () => {
      // Create sessions with various tags
      await store.upsertSession({
        id: 'sess_prod',
        agentId: 'a1',
        startedAt: '2026-01-01T00:00:00Z',
        status: 'active',
        tags: ['production', 'critical'],
      });
      await store.upsertSession({
        id: 'sess_dev',
        agentId: 'a1',
        startedAt: '2026-01-02T00:00:00Z',
        status: 'active',
        tags: ['dev', 'test'],
      });
      await store.upsertSession({
        id: 'sess_prod2',
        agentId: 'a2',
        startedAt: '2026-01-03T00:00:00Z',
        status: 'active',
        tags: ['production'],
      });
    });

    it('should use OR semantics — match sessions with ANY of the tags', async () => {
      const { sessions } = await store.querySessions({ tags: ['production', 'dev'] });
      expect(sessions).toHaveLength(3); // all three match
    });

    it('should not produce false positives with LIKE-style partial matching', async () => {
      // "prod" should NOT match "production" — must be exact
      const { sessions } = await store.querySessions({ tags: ['prod'] });
      expect(sessions).toHaveLength(0);
    });

    it('should match exact tag values only', async () => {
      const { sessions } = await store.querySessions({ tags: ['critical'] });
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.id).toBe('sess_prod');
    });
  });

  // ─── HIGH 5: Week granularity in analytics ─────────────────

  describe('Analytics week granularity (HIGH 5)', () => {
    it('should bucket events by ISO week', async () => {
      // Week 2 of 2026: Jan 5-11; Week 3: Jan 12-18
      const chainW2 = makeChain([
        { id: 'w2_1', sessionId: 'sw2', timestamp: '2026-01-06T10:00:00Z', eventType: 'session_started', payload: { tags: [] } },
        { id: 'w2_2', sessionId: 'sw2', timestamp: '2026-01-07T10:00:00Z' },
      ]);
      const chainW3 = makeChain([
        { id: 'w3_1', sessionId: 'sw3', timestamp: '2026-01-13T10:00:00Z', eventType: 'session_started', payload: { tags: [] } },
      ]);

      await store.insertEvents(chainW2);
      await store.insertEvents(chainW3);

      const result = await store.getAnalytics({
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-20T00:00:00Z',
        granularity: 'week',
      });

      expect(result.buckets.length).toBeGreaterThanOrEqual(2);
      // Different weeks should be in different buckets
      const uniqueBuckets = new Set(result.buckets.map(b => b.timestamp));
      expect(uniqueBuckets.size).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── HIGH 6: Analytics avgLatencyMs and totalCostUsd ───────

  describe('Analytics avgLatencyMs and totalCostUsd (HIGH 6)', () => {
    it('should compute avgLatencyMs from tool_response events', async () => {
      const chain = makeChain([
        { id: 'lat1', sessionId: 'slat', timestamp: '2026-01-15T10:00:00Z', eventType: 'session_started', payload: { tags: [] } },
        { id: 'lat2', sessionId: 'slat', timestamp: '2026-01-15T10:01:00Z', eventType: 'tool_response', payload: { callId: 'c1', toolName: 'a', result: {}, durationMs: 100 } },
        { id: 'lat3', sessionId: 'slat', timestamp: '2026-01-15T10:02:00Z', eventType: 'tool_response', payload: { callId: 'c2', toolName: 'b', result: {}, durationMs: 300 } },
      ]);

      await store.insertEvents(chain);

      const result = await store.getAnalytics({
        from: '2026-01-15T00:00:00Z',
        to: '2026-01-15T23:59:59Z',
        granularity: 'day',
      });

      // Average of 100 and 300 = 200
      expect(result.totals.avgLatencyMs).toBe(200);
      expect(result.buckets[0]!.avgLatencyMs).toBe(200);
    });

    it('should compute totalCostUsd from cost_tracked events', async () => {
      const chain = makeChain([
        { id: 'cost1', sessionId: 'scost', timestamp: '2026-01-15T10:00:00Z', eventType: 'session_started', payload: { tags: [] } },
        { id: 'cost2', sessionId: 'scost', timestamp: '2026-01-15T10:01:00Z', eventType: 'cost_tracked', payload: { provider: 'openai', model: 'gpt-4', inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.05 } },
        { id: 'cost3', sessionId: 'scost', timestamp: '2026-01-15T10:02:00Z', eventType: 'cost_tracked', payload: { provider: 'openai', model: 'gpt-4', inputTokens: 200, outputTokens: 100, totalTokens: 300, costUsd: 0.10 } },
      ]);

      await store.insertEvents(chain);

      const result = await store.getAnalytics({
        from: '2026-01-15T00:00:00Z',
        to: '2026-01-15T23:59:59Z',
        granularity: 'day',
      });

      expect(result.totals.totalCostUsd).toBeCloseTo(0.15, 2);
      expect(result.buckets[0]!.totalCostUsd).toBeCloseTo(0.15, 2);
    });
  });

  // ─── HIGH 7: safeJsonParse ─────────────────────────────────

  describe('safeJsonParse (HIGH 7)', () => {
    it('should parse valid JSON', () => {
      expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
      expect(safeJsonParse('[]', [])).toEqual([]);
      expect(safeJsonParse('"hello"', '')).toBe('hello');
    });

    it('should return fallback for malformed JSON', () => {
      expect(safeJsonParse('not json', {})).toEqual({});
      expect(safeJsonParse('{broken', [])).toEqual([]);
      expect(safeJsonParse('', 'fallback')).toBe('fallback');
    });

    it('should be resilient when reading events with corrupted payload', async () => {
      // Directly insert a row with malformed JSON via raw SQL
      db.run(
        sql`INSERT INTO events (id, timestamp, session_id, agent_id, event_type, severity, payload, metadata, prev_hash, hash)
            VALUES ('corrupt_1', '2026-01-01T00:00:00Z', 'sess_c', 'agent_c', 'custom', 'info', 'NOT_JSON', '{bad}', NULL, 'hash_c')`,
      );

      // Reading should not throw
      const event = await store.getEvent('corrupt_1');
      expect(event).not.toBeNull();
      expect(event!.payload).toEqual({});
      expect(event!.metadata).toEqual({});
    });
  });
});
