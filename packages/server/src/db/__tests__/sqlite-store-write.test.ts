import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentLensEvent } from '@agentlensai/core';
import { computeEventHash } from '@agentlensai/core';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { SqliteEventStore } from '../sqlite-store.js';
import { HashChainError } from '../errors.js';

/**
 * Create a valid event with a correct hash chain.
 * Pass prevHash from the previous event to build a chain.
 */
function makeEvent(overrides: Partial<AgentLensEvent> & { prevHash?: string | null } = {}): AgentLensEvent {
  const id = overrides.id ?? `evt_${Math.random().toString(36).slice(2, 10)}`;
  const base = {
    id,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
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
 * Build a chain of events for a given session, starting from prevHash=null.
 */
function makeChain(overridesList: Array<Partial<AgentLensEvent>>): AgentLensEvent[] {
  const chain: AgentLensEvent[] = [];
  let prevHash: string | null = null;
  for (const overrides of overridesList) {
    const event = makeEvent({ ...overrides, prevHash });
    chain.push(event);
    prevHash = event.hash;
  }
  return chain;
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
      const events = makeChain(
        Array.from({ length: 50 }, (_, i) => ({
          id: `evt_batch_${i}`,
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
        })),
      );

      await store.insertEvents(events);

      const stats = await store.getStats();
      expect(stats.totalEvents).toBe(50);
    });

    it('should handle empty event array without error', async () => {
      await expect(store.insertEvents([])).resolves.not.toThrow();
    });

    it('should insert 100 events performantly (< 500ms)', async () => {
      const events = makeChain(
        Array.from({ length: 100 }, (_, i) => ({
          id: `evt_perf_${i}`,
          timestamp: new Date(Date.now() + i).toISOString(),
        })),
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
      const chain = makeChain([
        {
          id: 'evt_start',
          eventType: 'session_started',
          timestamp: '2026-01-01T00:00:00Z',
          payload: { agentName: 'Test Agent', tags: [] },
        },
        {
          id: 'evt_end',
          eventType: 'session_ended',
          timestamp: '2026-01-01T01:00:00Z',
          payload: { reason: 'completed', summary: 'Done' },
        },
      ]);

      await store.insertEvents(chain);

      const session = await store.getSession('sess_001');
      expect(session).not.toBeNull();
      expect(session!.status).toBe('completed');
      expect(session!.endedAt).toBe('2026-01-01T01:00:00Z');
      expect(session!.eventCount).toBe(2);
    });

    it('should set session status to error when reason is error', async () => {
      const chain = makeChain([
        {
          id: 'evt_start',
          eventType: 'session_started',
          payload: { tags: [] },
        },
        {
          id: 'evt_end',
          eventType: 'session_ended',
          payload: { reason: 'error' },
        },
      ]);

      await store.insertEvents(chain);

      const session = await store.getSession('sess_001');
      expect(session!.status).toBe('error');
    });

    it('should increment eventCount on each event', async () => {
      const chain = makeChain([
        { id: 'evt_1', eventType: 'session_started', payload: { tags: [] } },
        { id: 'evt_2', eventType: 'tool_call', payload: { toolName: 'search', arguments: {}, callId: 'c1' } },
        { id: 'evt_3', eventType: 'tool_call', payload: { toolName: 'read', arguments: {}, callId: 'c2' } },
      ]);

      await store.insertEvents(chain);

      const session = await store.getSession('sess_001');
      expect(session!.eventCount).toBe(3);
      expect(session!.toolCallCount).toBe(2);
    });

    it('should increment errorCount on error events', async () => {
      const chain = makeChain([
        { id: 'evt_1', eventType: 'session_started', payload: { tags: [] } },
        { id: 'evt_2', eventType: 'tool_error', severity: 'error', payload: { callId: 'c1', toolName: 'test', error: 'fail', durationMs: 100 } },
        { id: 'evt_3', severity: 'critical', payload: { type: 'crash', data: {} } },
      ]);

      await store.insertEvents(chain);

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
      const chain = makeChain([
        {
          id: 'evt_start',
          eventType: 'session_started',
          payload: { tags: [] },
        },
        {
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
        },
        {
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
        },
      ]);

      await store.insertEvents(chain);

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
      // Session 1
      await store.insertEvents([
        makeEvent({
          id: 'evt_1',
          sessionId: 'sess_001',
          eventType: 'session_started',
          payload: { agentName: 'My Agent', tags: [] },
        }),
      ]);
      // Session 2 (different session, new chain)
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
      // Second event in same session (needs to chain from first)
      const firstEvent = await store.getEvent('evt_1');
      await store.insertEvents([
        makeEvent({
          id: 'evt_2',
          timestamp: '2026-01-02T00:00:00Z',
          prevHash: firstEvent!.hash,
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

  // ─── CRITICAL 3: Hash chain validation tests ────────────────

  describe('Hash chain validation (CRITICAL 3)', () => {
    it('should accept a valid hash chain', async () => {
      const chain = makeChain([
        { id: 'e1', eventType: 'session_started', payload: { tags: [] } },
        { id: 'e2', eventType: 'custom' },
        { id: 'e3', eventType: 'custom' },
      ]);

      await expect(store.insertEvents(chain)).resolves.not.toThrow();
      const stats = await store.getStats();
      expect(stats.totalEvents).toBe(3);
    });

    it('should reject a batch with a forged hash', async () => {
      const chain = makeChain([
        { id: 'e1', eventType: 'session_started', payload: { tags: [] } },
        { id: 'e2', eventType: 'custom' },
      ]);

      // Tamper with the hash
      chain[1] = { ...chain[1]!, hash: 'forged_hash_value' };

      await expect(store.insertEvents(chain)).rejects.toThrow(HashChainError);
      // Nothing should have been inserted (transaction rollback)
      const stats = await store.getStats();
      expect(stats.totalEvents).toBe(0);
    });

    it('should reject a batch with broken prevHash continuity', async () => {
      const chain = makeChain([
        { id: 'e1', eventType: 'session_started', payload: { tags: [] } },
        { id: 'e2', eventType: 'custom' },
      ]);

      // Break the chain — second event points to a wrong prevHash
      const brokenEvent = makeEvent({
        id: 'e2_broken',
        sessionId: 'sess_001',
        prevHash: 'wrong_prev_hash',
      });
      chain[1] = brokenEvent;

      await expect(store.insertEvents(chain)).rejects.toThrow(HashChainError);
    });

    it('should validate prevHash against stored events when appending', async () => {
      // Insert first batch
      const batch1 = makeChain([
        { id: 'e1', eventType: 'session_started', payload: { tags: [] } },
      ]);
      await store.insertEvents(batch1);

      // Second batch must chain from batch1's last hash
      const batch2 = [
        makeEvent({
          id: 'e2',
          sessionId: 'sess_001',
          prevHash: batch1[0]!.hash,
        }),
      ];
      await expect(store.insertEvents(batch2)).resolves.not.toThrow();

      // Third batch with wrong prevHash should fail
      const batch3 = [
        makeEvent({
          id: 'e3',
          sessionId: 'sess_001',
          prevHash: 'wrong_hash',
        }),
      ];
      await expect(store.insertEvents(batch3)).rejects.toThrow(HashChainError);
    });
  });

  // ─── CRITICAL 4: Idempotent event insertion tests ──────────

  describe('Idempotent event insertion (CRITICAL 4)', () => {
    it('should silently ignore duplicate event insertion', async () => {
      const chain = makeChain([
        { id: 'e1', eventType: 'session_started', payload: { tags: [] } },
        { id: 'e2', eventType: 'custom' },
      ]);

      await store.insertEvents(chain);
      // Insert the same batch again — should not throw
      await store.insertEvents(chain);

      const stats = await store.getStats();
      expect(stats.totalEvents).toBe(2); // Still 2, not 4
    });
  });
});
