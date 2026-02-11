/**
 * Tests for batch query methods: countEventsBatch and sumSessionCost (Story S-2.1)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentLensEvent } from '@agentlensai/core';
import { computeEventHash } from '@agentlensai/core';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { SqliteEventStore } from '../sqlite-store.js';

let counter = 0;

function makeEvent(overrides: Partial<AgentLensEvent> = {}): AgentLensEvent {
  counter++;
  const id = overrides.id ?? `evt_batch_${String(counter).padStart(6, '0')}`;
  const base = {
    id,
    timestamp: overrides.timestamp ?? new Date(Date.UTC(2026, 0, 15, 10, 0, counter)).toISOString(),
    sessionId: overrides.sessionId ?? `sess_batch_${counter}`,
    agentId: overrides.agentId ?? 'agent_001',
    eventType: overrides.eventType ?? 'custom',
    severity: overrides.severity ?? 'info',
    payload: overrides.payload ?? { type: 'test', data: {} },
    metadata: overrides.metadata ?? {},
    prevHash: overrides.prevHash ?? null,
  };
  const hash = computeEventHash(base);
  return { ...base, hash } as AgentLensEvent;
}

describe('SqliteEventStore batch methods', () => {
  let db: SqliteDb;
  let store: SqliteEventStore;

  beforeEach(() => {
    counter = 0;
    db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
  });

  describe('countEventsBatch', () => {
    const from = '2026-01-15T09:00:00.000Z';
    const to = '2026-01-15T11:00:00.000Z';

    it('returns zeros when no events', async () => {
      const result = await store.countEventsBatch({ agentId: 'agent_001', from, to });
      expect(result).toEqual({ total: 0, error: 0, critical: 0, toolError: 0 });
    });

    it('counts total events correctly', async () => {
      for (const e of [makeEvent(), makeEvent(), makeEvent()]) await store.insertEvents([e]);
      const result = await store.countEventsBatch({ agentId: 'agent_001', from, to });
      expect(result.total).toBe(3);
      expect(result.error).toBe(0);
      expect(result.critical).toBe(0);
      expect(result.toolError).toBe(0);
    });

    it('counts error severity events', async () => {
      for (const e of [
        makeEvent({ severity: 'error' }),
        makeEvent({ severity: 'info' }),
        makeEvent({ severity: 'error' }),
      ]) await store.insertEvents([e]);
      const result = await store.countEventsBatch({ agentId: 'agent_001', from, to });
      expect(result.total).toBe(3);
      expect(result.error).toBe(2);
    });

    it('counts critical severity events', async () => {
      for (const e of [
        makeEvent({ severity: 'critical' }),
        makeEvent({ severity: 'info' }),
      ]) await store.insertEvents([e]);
      const result = await store.countEventsBatch({ agentId: 'agent_001', from, to });
      expect(result.total).toBe(2);
      expect(result.critical).toBe(1);
    });

    it('counts tool_error event types', async () => {
      for (const e of [
        makeEvent({ eventType: 'tool_error' }),
        makeEvent({ eventType: 'tool_call' }),
      ]) await store.insertEvents([e]);
      const result = await store.countEventsBatch({ agentId: 'agent_001', from, to });
      expect(result.total).toBe(2);
      expect(result.toolError).toBe(1);
    });

    it('counts mixed categories correctly in single query', async () => {
      for (const e of [
        makeEvent({ severity: 'error' }),
        makeEvent({ severity: 'critical' }),
        makeEvent({ eventType: 'tool_error' }),
        makeEvent({ severity: 'info' }),
        makeEvent({ severity: 'warning' }),
      ]) await store.insertEvents([e]);
      const result = await store.countEventsBatch({ agentId: 'agent_001', from, to });
      expect(result).toEqual({ total: 5, error: 1, critical: 1, toolError: 1 });
    });

    it('filters by agentId', async () => {
      for (const e of [
        makeEvent({ agentId: 'agent_001', severity: 'error' }),
        makeEvent({ agentId: 'agent_002', severity: 'error' }),
      ]) await store.insertEvents([e]);
      const result = await store.countEventsBatch({ agentId: 'agent_001', from, to });
      expect(result.total).toBe(1);
      expect(result.error).toBe(1);
    });

    it('filters by time window', async () => {
      for (const e of [
        makeEvent({ timestamp: '2026-01-15T10:00:01.000Z', severity: 'error' }),
        makeEvent({ timestamp: '2026-01-15T12:00:00.000Z', severity: 'error' }),
      ]) await store.insertEvents([e]);
      const result = await store.countEventsBatch({ agentId: 'agent_001', from, to });
      expect(result.total).toBe(1);
    });
  });

  describe('sumSessionCost', () => {
    it('returns 0 when no sessions', async () => {
      const result = await store.sumSessionCost({ agentId: 'agent_001', from: '2026-01-15T00:00:00.000Z' });
      expect(result).toBe(0);
    });

    it('sums session costs correctly', async () => {
      await store.upsertSession({ id: 'ses_1', agentId: 'agent_001', totalCostUsd: 1.5, startedAt: '2026-01-15T10:00:00.000Z', status: 'completed' });
      await store.upsertSession({ id: 'ses_2', agentId: 'agent_001', totalCostUsd: 2.5, startedAt: '2026-01-15T11:00:00.000Z', status: 'completed' });
      const result = await store.sumSessionCost({ agentId: 'agent_001', from: '2026-01-15T00:00:00.000Z' });
      expect(result).toBe(4);
    });

    it('filters by agentId', async () => {
      await store.upsertSession({ id: 'ses_1', agentId: 'agent_001', totalCostUsd: 1.0, startedAt: '2026-01-15T10:00:00.000Z', status: 'completed' });
      await store.upsertSession({ id: 'ses_2', agentId: 'agent_002', totalCostUsd: 5.0, startedAt: '2026-01-15T10:00:00.000Z', status: 'completed' });
      const result = await store.sumSessionCost({ agentId: 'agent_001', from: '2026-01-15T00:00:00.000Z' });
      expect(result).toBe(1);
    });

    it('filters by from date', async () => {
      await store.upsertSession({ id: 'ses_1', agentId: 'agent_001', totalCostUsd: 1.0, startedAt: '2026-01-14T10:00:00.000Z', status: 'completed' });
      await store.upsertSession({ id: 'ses_2', agentId: 'agent_001', totalCostUsd: 2.0, startedAt: '2026-01-15T10:00:00.000Z', status: 'completed' });
      const result = await store.sumSessionCost({ agentId: 'agent_001', from: '2026-01-15T00:00:00.000Z' });
      expect(result).toBe(2);
    });
  });
});
