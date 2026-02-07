import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentLensEvent } from '@agentlens/core';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { SqliteEventStore } from '../sqlite-store.js';

function makeEvent(overrides: Partial<AgentLensEvent> = {}): AgentLensEvent {
  const id = `evt_${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    timestamp: new Date().toISOString(),
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

describe('SqliteEventStore — Write Operations (Story 3.4)', () => {
  let db: SqliteDb;
  let store: SqliteEventStore;

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
  });

  describe('insertEvents()', () => {
    it('should insert a single event', async () => {
      const event = makeEvent();
      await store.insertEvents([event]);

      const retrieved = await store.getEvent(event.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(event.id);
      expect(retrieved!.sessionId).toBe('sess_001');
      expect(retrieved!.agentId).toBe('agent_001');
      expect(retrieved!.eventType).toBe('custom');
      expect(retrieved!.severity).toBe('info');
      expect(retrieved!.payload).toEqual({ type: 'test', data: {} });
    });

    it('should insert a batch of events in a single transaction', async () => {
      const events = Array.from({ length: 50 }, (_, i) =>
        makeEvent({
          id: `evt_batch_${i}`,
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
        }),
      );

      await store.insertEvents(events);

      const stats = await store.getStats();
      expect(stats.totalEvents).toBe(50);
    });

    it('should handle empty event array without error', async () => {
      await expect(store.insertEvents([])).resolves.not.toThrow();
    });

    it('should insert 100 events performantly (< 500ms)', async () => {
      const events = Array.from({ length: 100 }, (_, i) =>
        makeEvent({
          id: `evt_perf_${i}`,
          timestamp: new Date(Date.now() + i).toISOString(),
        }),
      );

      const start = performance.now();
      await store.insertEvents(events);
      const elapsed = performance.now() - start;

      // Should be well under 500ms for in-memory SQLite
      expect(elapsed).toBeLessThan(500);
    });
  });

  describe('Session auto-management', () => {
    it('should create a session on session_started event', async () => {
      const event = makeEvent({
        eventType: 'session_started',
        payload: {
          agentName: 'Test Agent',
          tags: ['test', 'dev'],
        },
      });

      await store.insertEvents([event]);

      const session = await store.getSession('sess_001');
      expect(session).not.toBeNull();
      expect(session!.id).toBe('sess_001');
      expect(session!.agentId).toBe('agent_001');
      expect(session!.agentName).toBe('Test Agent');
      expect(session!.status).toBe('active');
      expect(session!.eventCount).toBe(1);
      expect(session!.tags).toEqual(['test', 'dev']);
    });

    it('should update session on session_ended event', async () => {
      // Start session
      await store.insertEvents([
        makeEvent({
          id: 'evt_start',
          eventType: 'session_started',
          timestamp: '2026-01-01T00:00:00Z',
          payload: { agentName: 'Test Agent', tags: [] },
        }),
      ]);

      // End session
      await store.insertEvents([
        makeEvent({
          id: 'evt_end',
          eventType: 'session_ended',
          timestamp: '2026-01-01T01:00:00Z',
          payload: { reason: 'completed', summary: 'Done' },
        }),
      ]);

      const session = await store.getSession('sess_001');
      expect(session).not.toBeNull();
      expect(session!.status).toBe('completed');
      expect(session!.endedAt).toBe('2026-01-01T01:00:00Z');
      expect(session!.eventCount).toBe(2);
    });

    it('should set session status to error when reason is error', async () => {
      await store.insertEvents([
        makeEvent({
          id: 'evt_start',
          eventType: 'session_started',
          payload: { tags: [] },
        }),
      ]);

      await store.insertEvents([
        makeEvent({
          id: 'evt_end',
          eventType: 'session_ended',
          payload: { reason: 'error' },
        }),
      ]);

      const session = await store.getSession('sess_001');
      expect(session!.status).toBe('error');
    });

    it('should increment eventCount on each event', async () => {
      await store.insertEvents([
        makeEvent({ id: 'evt_1', eventType: 'session_started', payload: { tags: [] } }),
      ]);
      await store.insertEvents([
        makeEvent({ id: 'evt_2', eventType: 'tool_call', payload: { toolName: 'search', arguments: {}, callId: 'c1' } }),
        makeEvent({ id: 'evt_3', eventType: 'tool_call', payload: { toolName: 'read', arguments: {}, callId: 'c2' } }),
      ]);

      const session = await store.getSession('sess_001');
      expect(session!.eventCount).toBe(3);
      expect(session!.toolCallCount).toBe(2);
    });

    it('should increment errorCount on error events', async () => {
      await store.insertEvents([
        makeEvent({ id: 'evt_1', eventType: 'session_started', payload: { tags: [] } }),
        makeEvent({ id: 'evt_2', eventType: 'tool_error', severity: 'error', payload: { callId: 'c1', toolName: 'test', error: 'fail', durationMs: 100 } }),
        makeEvent({ id: 'evt_3', severity: 'critical', payload: { type: 'crash', data: {} } }),
      ]);

      const session = await store.getSession('sess_001');
      expect(session!.errorCount).toBe(2);
    });

    it('should auto-create session for events without session_started', async () => {
      // Insert a regular event without a preceding session_started
      await store.insertEvents([
        makeEvent({ eventType: 'tool_call', payload: { toolName: 'test', arguments: {}, callId: 'c1' } }),
      ]);

      const session = await store.getSession('sess_001');
      expect(session).not.toBeNull();
      expect(session!.status).toBe('active');
    });

    it('should track cost in session totalCostUsd', async () => {
      await store.insertEvents([
        makeEvent({
          id: 'evt_start',
          eventType: 'session_started',
          payload: { tags: [] },
        }),
        makeEvent({
          id: 'evt_cost1',
          eventType: 'cost_tracked',
          payload: {
            provider: 'openai',
            model: 'gpt-4',
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            costUsd: 0.05,
          },
        }),
        makeEvent({
          id: 'evt_cost2',
          eventType: 'cost_tracked',
          payload: {
            provider: 'openai',
            model: 'gpt-4',
            inputTokens: 200,
            outputTokens: 100,
            totalTokens: 300,
            costUsd: 0.10,
          },
        }),
      ]);

      const session = await store.getSession('sess_001');
      expect(session!.totalCostUsd).toBeCloseTo(0.15, 2);
    });
  });

  describe('Agent auto-creation', () => {
    it('should auto-create agent on first event', async () => {
      await store.insertEvents([
        makeEvent({
          eventType: 'session_started',
          payload: { agentName: 'My Agent', tags: [] },
        }),
      ]);

      const agent = await store.getAgent('agent_001');
      expect(agent).not.toBeNull();
      expect(agent!.id).toBe('agent_001');
      expect(agent!.name).toBe('My Agent');
      expect(agent!.sessionCount).toBe(1);
    });

    it('should increment agent sessionCount on new sessions', async () => {
      await store.insertEvents([
        makeEvent({
          id: 'evt_1',
          sessionId: 'sess_001',
          eventType: 'session_started',
          payload: { agentName: 'My Agent', tags: [] },
        }),
      ]);
      await store.insertEvents([
        makeEvent({
          id: 'evt_2',
          sessionId: 'sess_002',
          eventType: 'session_started',
          payload: { tags: [] },
        }),
      ]);

      const agent = await store.getAgent('agent_001');
      expect(agent!.sessionCount).toBe(2);
    });

    it('should update agent lastSeenAt on each event', async () => {
      await store.insertEvents([
        makeEvent({
          id: 'evt_1',
          timestamp: '2026-01-01T00:00:00Z',
          eventType: 'session_started',
          payload: { tags: [] },
        }),
      ]);
      await store.insertEvents([
        makeEvent({
          id: 'evt_2',
          timestamp: '2026-01-02T00:00:00Z',
        }),
      ]);

      const agent = await store.getAgent('agent_001');
      expect(agent!.lastSeenAt).toBe('2026-01-02T00:00:00Z');
    });
  });

  describe('upsertSession()', () => {
    it('should create a new session via upsert', async () => {
      await store.upsertSession({
        id: 'sess_100',
        agentId: 'agent_x',
        startedAt: '2026-01-01T00:00:00Z',
        status: 'active',
        tags: ['upsert-test'],
      });

      const session = await store.getSession('sess_100');
      expect(session).not.toBeNull();
      expect(session!.agentId).toBe('agent_x');
      expect(session!.tags).toEqual(['upsert-test']);
    });

    it('should update an existing session via upsert', async () => {
      await store.upsertSession({
        id: 'sess_100',
        agentId: 'agent_x',
        startedAt: '2026-01-01T00:00:00Z',
        status: 'active',
      });

      await store.upsertSession({
        id: 'sess_100',
        status: 'completed',
        endedAt: '2026-01-01T01:00:00Z',
      });

      const session = await store.getSession('sess_100');
      expect(session!.status).toBe('completed');
      expect(session!.endedAt).toBe('2026-01-01T01:00:00Z');
    });
  });

  describe('upsertAgent()', () => {
    it('should create a new agent via upsert', async () => {
      await store.upsertAgent({
        id: 'agent_new',
        name: 'New Agent',
        firstSeenAt: '2026-01-01T00:00:00Z',
        lastSeenAt: '2026-01-01T00:00:00Z',
        sessionCount: 0,
      });

      const agent = await store.getAgent('agent_new');
      expect(agent).not.toBeNull();
      expect(agent!.name).toBe('New Agent');
    });

    it('should update an existing agent via upsert', async () => {
      await store.upsertAgent({
        id: 'agent_upd',
        name: 'Agent',
        firstSeenAt: '2026-01-01T00:00:00Z',
        lastSeenAt: '2026-01-01T00:00:00Z',
      });

      await store.upsertAgent({
        id: 'agent_upd',
        name: 'Updated Agent',
        lastSeenAt: '2026-02-01T00:00:00Z',
      });

      const agent = await store.getAgent('agent_upd');
      expect(agent!.name).toBe('Updated Agent');
      expect(agent!.lastSeenAt).toBe('2026-02-01T00:00:00Z');
    });
  });
});
