import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentLensEvent } from '@agentlens/core';
import { computeEventHash } from '@agentlens/core';
import { createTestDb, type SqliteDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SqliteEventStore } from '../../db/sqlite-store.js';
import { applyRetention } from '../retention.js';

let counter = 0;

function makeEvent(overrides: Partial<AgentLensEvent> & { prevHash?: string | null } = {}): AgentLensEvent {
  counter++;
  const id = overrides.id ?? `evt_${String(counter).padStart(6, '0')}`;
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

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

describe('Retention Policy Engine (Story 3.6)', () => {
  let db: SqliteDb;
  let store: SqliteEventStore;

  beforeEach(() => {
    counter = 0;
    db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
  });

  describe('applyRetention()', () => {
    it('should delete events older than configured retention days', async () => {
      // Old session chain
      const oldChain = makeChain([
        {
          id: 'old_1',
          sessionId: 'sess_old',
          timestamp: daysAgo(100),
          eventType: 'session_started',
          payload: { tags: [] },
        },
        {
          id: 'old_2',
          sessionId: 'sess_old',
          timestamp: daysAgo(95),
        },
      ]);
      // Recent session chain
      const recentChain = makeChain([
        {
          id: 'recent_1',
          sessionId: 'sess_new',
          timestamp: daysAgo(10),
          eventType: 'session_started',
          payload: { tags: [] },
        },
        {
          id: 'recent_2',
          sessionId: 'sess_new',
          timestamp: daysAgo(5),
        },
      ]);

      await store.insertEvents(oldChain);
      await store.insertEvents(recentChain);

      const result = await applyRetention(store, { retentionDays: 90 });

      expect(result.deletedCount).toBe(2);
      expect(result.skipped).toBe(false);

      const old1 = await store.getEvent('old_1');
      expect(old1).toBeNull();
      const old2 = await store.getEvent('old_2');
      expect(old2).toBeNull();

      const recent1 = await store.getEvent('recent_1');
      expect(recent1).not.toBeNull();
      const recent2 = await store.getEvent('recent_2');
      expect(recent2).not.toBeNull();
    });

    it('should clean up sessions with no remaining events', async () => {
      const oldChain = makeChain([
        {
          id: 'old_evt',
          sessionId: 'sess_old',
          timestamp: daysAgo(100),
          eventType: 'session_started',
          payload: { tags: [] },
        },
      ]);
      const newChain = makeChain([
        {
          id: 'new_evt',
          sessionId: 'sess_new',
          timestamp: daysAgo(5),
          eventType: 'session_started',
          payload: { tags: [] },
        },
      ]);

      await store.insertEvents(oldChain);
      await store.insertEvents(newChain);

      const beforeStats = await store.getStats();
      expect(beforeStats.totalSessions).toBe(2);

      await applyRetention(store, { retentionDays: 90 });

      const afterStats = await store.getStats();
      expect(afterStats.totalSessions).toBe(1);

      const oldSession = await store.getSession('sess_old');
      expect(oldSession).toBeNull();

      const newSession = await store.getSession('sess_new');
      expect(newSession).not.toBeNull();
    });

    it('should return deletedCount of 0 when no events are old enough', async () => {
      const chain = makeChain([
        {
          timestamp: daysAgo(10),
          eventType: 'session_started',
          payload: { tags: [] },
        },
        { timestamp: daysAgo(5) },
      ]);

      await store.insertEvents(chain);

      const result = await applyRetention(store, { retentionDays: 90 });
      expect(result.deletedCount).toBe(0);
      expect(result.skipped).toBe(false);

      const stats = await store.getStats();
      expect(stats.totalEvents).toBe(2);
    });

    it('should skip deletion when RETENTION_DAYS=0 (keep forever)', async () => {
      const chain = makeChain([
        {
          timestamp: daysAgo(365),
          eventType: 'session_started',
          payload: { tags: [] },
        },
        { timestamp: daysAgo(300) },
      ]);

      await store.insertEvents(chain);

      const result = await applyRetention(store, { retentionDays: 0 });
      expect(result.deletedCount).toBe(0);
      expect(result.skipped).toBe(true);

      const stats = await store.getStats();
      expect(stats.totalEvents).toBe(2);
    });

    it('should skip deletion when retentionDays is negative', async () => {
      await store.insertEvents([
        makeEvent({
          timestamp: daysAgo(365),
          eventType: 'session_started',
          payload: { tags: [] },
        }),
      ]);

      const result = await applyRetention(store, { retentionDays: -1 });
      expect(result.deletedCount).toBe(0);
      expect(result.skipped).toBe(true);
    });

    it('should handle mixed-age events correctly (partial deletion)', async () => {
      const chain = makeChain([
        { id: 'e1', sessionId: 'sA', timestamp: daysAgo(200), eventType: 'session_started', payload: { tags: [] } },
        { id: 'e2', sessionId: 'sA', timestamp: daysAgo(150) },
        { id: 'e3', sessionId: 'sA', timestamp: daysAgo(100) },
        { id: 'e4', sessionId: 'sA', timestamp: daysAgo(30) },
        { id: 'e5', sessionId: 'sA', timestamp: daysAgo(1) },
      ]);

      await store.insertEvents(chain);

      const result = await applyRetention(store, { retentionDays: 90 });
      expect(result.deletedCount).toBe(3);

      const stats = await store.getStats();
      expect(stats.totalEvents).toBe(2);
      expect(stats.totalSessions).toBe(1);
    });

    it('should work with the IEventStore.applyRetention() directly', async () => {
      const chain = makeChain([
        {
          id: 'old',
          sessionId: 'sess_direct',
          timestamp: '2020-01-01T00:00:00Z',
          eventType: 'session_started',
          payload: { tags: [] },
        },
        {
          id: 'new',
          sessionId: 'sess_direct',
          timestamp: new Date().toISOString(),
        },
      ]);

      await store.insertEvents(chain);

      const result = await store.applyRetention('2023-01-01T00:00:00Z');
      expect(result.deletedCount).toBe(1);
    });

    it('should handle empty database without error', async () => {
      const result = await applyRetention(store, { retentionDays: 90 });
      expect(result.deletedCount).toBe(0);
      expect(result.skipped).toBe(false);
    });

    it('should delete all events when all are old enough', async () => {
      // Each session is its own chain
      const chain1 = makeChain([
        { id: 'e1', sessionId: 's1', timestamp: daysAgo(365), eventType: 'session_started', payload: { tags: [] } },
        { id: 'e2', sessionId: 's1', timestamp: daysAgo(200) },
      ]);
      const chain2 = makeChain([
        { id: 'e3', sessionId: 's2', timestamp: daysAgo(100), eventType: 'session_started', payload: { tags: [] } },
      ]);

      await store.insertEvents(chain1);
      await store.insertEvents(chain2);

      const result = await applyRetention(store, { retentionDays: 90 });
      expect(result.deletedCount).toBe(3);

      const stats = await store.getStats();
      expect(stats.totalEvents).toBe(0);
      expect(stats.totalSessions).toBe(0);
    });
  });
});
