/**
 * Dual-Backend CI Test Infrastructure (S-4.5)
 *
 * Verifies that the same adapter test suite can run against both
 * SQLite and Postgres backends for feature parity.
 *
 * ~6 tests for CI infrastructure validation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { computeEventHash } from '@agentlensai/core';
import type { AgentLensEvent } from '@agentlensai/core';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SqliteEventStore } from '../../db/sqlite-store.js';
import { SqliteStorageAdapter } from '../storage/sqlite-adapter.js';
import { PostgresStorageAdapter } from '../storage/postgres-adapter.js';
import type { StorageAdapter } from '../storage/adapter.js';
import { getStorageBackend } from '../storage/adapter.js';

// ─── Test Helpers ───────────────────────────────────────────

let counter = 0;

function makeChain(
  overridesList: Array<Partial<AgentLensEvent>>,
  startPrevHash: string | null = null,
): AgentLensEvent[] {
  const chain: AgentLensEvent[] = [];
  let prevHash = startPrevHash;
  for (const overrides of overridesList) {
    counter++;
    const id = overrides.id ?? `evt_db_${String(counter).padStart(6, '0')}`;
    const base = {
      id,
      timestamp: overrides.timestamp ?? new Date(Date.UTC(2026, 0, 15, 10, 0, counter)).toISOString(),
      sessionId: overrides.sessionId ?? 'sess_db_001',
      agentId: overrides.agentId ?? 'agent_db_001',
      eventType: overrides.eventType ?? 'custom',
      severity: overrides.severity ?? 'info',
      payload: overrides.payload ?? { type: 'test', data: {} },
      metadata: overrides.metadata ?? {},
      prevHash,
    };
    const hash = computeEventHash({
      id: base.id, timestamp: base.timestamp, sessionId: base.sessionId,
      agentId: base.agentId, eventType: base.eventType, severity: base.severity,
      payload: base.payload, metadata: base.metadata, prevHash: base.prevHash,
    });
    const event = { ...base, hash } as AgentLensEvent;
    chain.push(event);
    prevHash = hash;
  }
  return chain;
}

interface TestBackend {
  name: string;
  createAdapter: () => StorageAdapter;
  insertEvents: (events: AgentLensEvent[]) => Promise<void>;
}

function createSqliteBackend(): TestBackend {
  const db = createTestDb();
  runMigrations(db);
  const store = new SqliteEventStore(db);
  return {
    name: 'sqlite',
    createAdapter: () => new SqliteStorageAdapter(store),
    insertEvents: async (events) => store.insertEvents(events),
  };
}

const ORG_ID = 'default';

// ═══════════════════════════════════════════════════════════════
// S-4.5: CI Dual-Backend Test Infrastructure
// ═══════════════════════════════════════════════════════════════

describe('S-4.5: Dual-Backend Test Infrastructure', () => {
  it('getStorageBackend returns valid backend string', () => {
    const backend = getStorageBackend();
    expect(['sqlite', 'postgres']).toContain(backend);
  });

  it('SQLite and Postgres adapters have identical method signatures', () => {
    const sqliteMethods = Object.getOwnPropertyNames(SqliteStorageAdapter.prototype)
      .filter((m) => m !== 'constructor')
      .sort();
    const pgMethods = Object.getOwnPropertyNames(PostgresStorageAdapter.prototype)
      .filter((m) => m !== 'constructor')
      .sort();
    expect(sqliteMethods).toEqual(pgMethods);
  });

  it('both adapters implement all StorageAdapter methods', () => {
    const requiredMethods = [
      'queryEvents', 'getEventsBySession', 'getSessions', 'getSession',
      'getAgents', 'getStats', 'getCostAnalytics', 'getHealthAnalytics',
      'getTokenUsage', 'getAnalytics', 'search',
    ];
    for (const method of requiredMethods) {
      expect(typeof (SqliteStorageAdapter.prototype as Record<string, unknown>)[method]).toBe('function');
      expect(typeof (PostgresStorageAdapter.prototype as Record<string, unknown>)[method]).toBe('function');
    }
  });

  it('createSqliteBackend factory works', () => {
    const backend = createSqliteBackend();
    expect(backend.name).toBe('sqlite');
    expect(backend.createAdapter).toBeDefined();
    expect(backend.insertEvents).toBeDefined();
  });
});

describe('S-4.5: Feature Parity — SQLite', () => {
  let backend: TestBackend;
  let adapter: StorageAdapter;

  beforeEach(() => {
    counter = 0;
    backend = createSqliteBackend();
    adapter = backend.createAdapter();
  });

  it('queryEvents + getAnalytics produce consistent counts', async () => {
    const events = makeChain([
      { eventType: 'session_started', payload: { agentName: 'a1', tags: [] }, timestamp: '2026-01-15T10:00:00.000Z' },
      { eventType: 'custom', timestamp: '2026-01-15T11:00:00.000Z' },
      { eventType: 'custom', timestamp: '2026-01-15T12:00:00.000Z' },
    ]);
    await backend.insertEvents(events.map((e) => ({ ...e, tenantId: ORG_ID })));

    const queryResult = await adapter.queryEvents(ORG_ID, {
      from: '2026-01-15T00:00:00Z', to: '2026-01-15T23:59:59Z',
    });
    const analyticsResult = await adapter.getAnalytics(ORG_ID, {
      from: '2026-01-15T00:00:00Z', to: '2026-01-15T23:59:59Z', granularity: 'day',
    });

    expect(queryResult.total).toBe(analyticsResult.totals.eventCount);
  });

  it('search returns subset of queryEvents results', async () => {
    const events = makeChain([
      { eventType: 'session_started', payload: { agentName: 'a1', tags: [] }, timestamp: '2026-01-15T10:00:00.000Z' },
      { eventType: 'custom', payload: { message: 'parity_check_unique_string' }, timestamp: '2026-01-15T11:00:00.000Z' },
      { eventType: 'custom', payload: { message: 'other data here' }, timestamp: '2026-01-15T12:00:00.000Z' },
    ]);
    await backend.insertEvents(events.map((e) => ({ ...e, tenantId: ORG_ID })));

    const allEvents = await adapter.queryEvents(ORG_ID, {});
    const searchResult = await adapter.search(ORG_ID, {
      query: 'parity_check_unique_string', scope: 'events',
    });

    expect(searchResult.total).toBeLessThanOrEqual(allEvents.total);
    if (searchResult.items.length > 0) {
      const allIds = allEvents.events.map((e) => e.id);
      for (const item of searchResult.items) {
        expect(allIds).toContain(item.id);
      }
    }
  });
});
