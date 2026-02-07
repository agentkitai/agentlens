import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentLensEvent } from '@agentlens/core';
import { createTestDb, type SqliteDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SqliteEventStore } from '../../db/sqlite-store.js';
import { applyRetention } from '../retention.js';

let counter = 0;
function makeEvent(overrides: Partial<AgentLensEvent> = {}): AgentLensEvent {
  counter++;
  const id = `evt_${String(counter).padStart(6, '0')}`;
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
      await store.insertEvents([
        makeEvent({
          id: 'old_1',
          sessionId: 'sess_old',
          timestamp: daysAgo(100),
          eventType: 'session_started',
          payload: { tags: [] },
        }),
        makeEvent({
          id: 'old_2',
          sessionId: 'sess_old',
          timestamp: daysAgo(95),
        }),
        makeEvent({
          id: 'recent_1',
          sessionId: 'sess_new',
          timestamp: daysAgo(10),
          eventType: 'session_started',
          payload: { tags: [] },
        }),
        makeEvent({
          id: 'recent_2',
          sessionId: 'sess_new',
          timestamp: daysAgo(5),
        }),
      ]);

      const result = await applyRetention(store, { retentionDays: 90 });

      expect(result.deletedCount).toBe(2);
      expect(result.skipped).toBe(false);

      // Verify old events are gone
      const old1 = await store.getEvent('old_1');
      expect(old1).toBeNull();
      const old2 = await store.getEvent('old_2');
      expect(old2).toBeNull();

      // Verify recent events remain
      const recent1 = await store.getEvent('recent_1');
      expect(recent1).not.toBeNull();
      const recent2 = await store.getEvent('recent_2');
      expect(recent2).not.toBeNull();
    });

    it('should clean up sessions with no remaining events', async () => {
      await store.insertEvents([
        makeEvent({
          id: 'old_evt',
          sessionId: 'sess_old',
          timestamp: daysAgo(100),
          eventType: 'session_started',
          payload: { tags: [] },
        }),
        makeEvent({
          id: 'new_evt',
          sessionId: 'sess_new',
          timestamp: daysAgo(5),
          eventType: 'session_started',
          payload: { tags: [] },
        }),
      ]);

      // Before retention: 2 sessions
      const beforeStats = await store.getStats();
      expect(beforeStats.totalSessions).toBe(2);

      await applyRetention(store, { retentionDays: 90 });

      // After retention: only sess_new remains
      const afterStats = await store.getStats();
      expect(afterStats.totalSessions).toBe(1);

      const oldSession = await store.getSession('sess_old');
      expect(oldSession).toBeNull();

      const newSession = await store.getSession('sess_new');
      expect(newSession).not.toBeNull();
    });

    it('should return deletedCount of 0 when no events are old enough', async () => {
      await store.insertEvents([
        makeEvent({
          timestamp: daysAgo(10),
          eventType: 'session_started',
          payload: { tags: [] },
        }),
        makeEvent({ timestamp: daysAgo(5) }),
      ]);

      const result = await applyRetention(store, { retentionDays: 90 });
      expect(result.deletedCount).toBe(0);
      expect(result.skipped).toBe(false);

      const stats = await store.getStats();
      expect(stats.totalEvents).toBe(2);
    });

    it('should skip deletion when RETENTION_DAYS=0 (keep forever)', async () => {
      await store.insertEvents([
        makeEvent({
          timestamp: daysAgo(365),
          eventType: 'session_started',
          payload: { tags: [] },
        }),
        makeEvent({ timestamp: daysAgo(300) }),
      ]);

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
      // 5 events: 3 old, 2 recent
      await store.insertEvents([
        makeEvent({ id: 'e1', sessionId: 'sA', timestamp: daysAgo(200), eventType: 'session_started', payload: { tags: [] } }),
        makeEvent({ id: 'e2', sessionId: 'sA', timestamp: daysAgo(150) }),
        makeEvent({ id: 'e3', sessionId: 'sA', timestamp: daysAgo(100) }),
        makeEvent({ id: 'e4', sessionId: 'sA', timestamp: daysAgo(30) }),
        makeEvent({ id: 'e5', sessionId: 'sA', timestamp: daysAgo(1) }),
      ]);

      const result = await applyRetention(store, { retentionDays: 90 });
      expect(result.deletedCount).toBe(3);

      const stats = await store.getStats();
      expect(stats.totalEvents).toBe(2);
      // Session still exists because it has remaining events
      expect(stats.totalSessions).toBe(1);
    });

    it('should work with the IEventStore.applyRetention() directly', async () => {
      await store.insertEvents([
        makeEvent({
          id: 'old',
          sessionId: 'sess_direct',
          timestamp: '2020-01-01T00:00:00Z',
          eventType: 'session_started',
          payload: { tags: [] },
        }),
        makeEvent({
          id: 'new',
          sessionId: 'sess_direct',
          timestamp: new Date().toISOString(),
        }),
      ]);

      // Call the store method directly with an explicit cutoff
      const result = await store.applyRetention('2023-01-01T00:00:00Z');
      expect(result.deletedCount).toBe(1);
    });

    it('should handle empty database without error', async () => {
      const result = await applyRetention(store, { retentionDays: 90 });
      expect(result.deletedCount).toBe(0);
      expect(result.skipped).toBe(false);
    });

    it('should delete all events when all are old enough', async () => {
      await store.insertEvents([
        makeEvent({ id: 'e1', sessionId: 's1', timestamp: daysAgo(365), eventType: 'session_started', payload: { tags: [] } }),
        makeEvent({ id: 'e2', sessionId: 's1', timestamp: daysAgo(200) }),
        makeEvent({ id: 'e3', sessionId: 's2', timestamp: daysAgo(100), eventType: 'session_started', payload: { tags: [] } }),
      ]);

      const result = await applyRetention(store, { retentionDays: 90 });
      expect(result.deletedCount).toBe(3);

      const stats = await store.getStats();
      expect(stats.totalEvents).toBe(0);
      expect(stats.totalSessions).toBe(0);
    });
  });
});
