/**
 * Search Query Tests (S-4.4)
 *
 * Full-text search across events and sessions.
 * SQLite: LIKE-based fallback. Postgres: tsvector/to_tsquery.
 *
 * ~8 tests covering search functionality.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { computeEventHash } from '@agentlensai/core';
import type { AgentLensEvent } from '@agentlensai/core';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SqliteEventStore } from '../../db/sqlite-store.js';
import { SqliteStorageAdapter } from '../storage/sqlite-adapter.js';
import type { StorageAdapter } from '../storage/adapter.js';

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
    const id = overrides.id ?? `evt_sr_${String(counter).padStart(6, '0')}`;
    const base = {
      id,
      timestamp: overrides.timestamp ?? new Date(Date.UTC(2026, 0, 15, 10, 0, counter)).toISOString(),
      sessionId: overrides.sessionId ?? 'sess_sr_001',
      agentId: overrides.agentId ?? 'agent_sr_001',
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

const ORG_ID = 'default';

// ═══════════════════════════════════════════════════════════════
// S-4.4: Search Queries — SQLite
// ═══════════════════════════════════════════════════════════════

describe('S-4.4: Search Queries — SQLite', () => {
  let adapter: StorageAdapter;
  let store: SqliteEventStore;

  beforeEach(() => {
    counter = 0;
    const db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    adapter = new SqliteStorageAdapter(store);
  });

  it('search returns empty for no data', async () => {
    const result = await adapter.search(ORG_ID, { query: 'hello' });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('search returns empty for empty query string', async () => {
    const result = await adapter.search(ORG_ID, { query: '   ' });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('search finds events by payload content', async () => {
    const events = makeChain([
      {
        eventType: 'session_started',
        payload: { agentName: 'SearchBot', tags: [] },
        timestamp: '2026-01-15T10:00:00.000Z',
      },
      {
        eventType: 'custom',
        payload: { message: 'The weather is sunny today' },
        timestamp: '2026-01-15T11:00:00.000Z',
      },
      {
        eventType: 'custom',
        payload: { message: 'Database connection failed' },
        timestamp: '2026-01-15T12:00:00.000Z',
      },
    ]);
    await store.insertEvents(events.map((e) => ({ ...e, tenantId: ORG_ID })));

    const result = await adapter.search(ORG_ID, { query: 'sunny', scope: 'events' });
    expect(result.items.length).toBe(1);
    expect(result.items[0]!.type).toBe('event');
    expect(result.items[0]!.headline).toContain('sunny');
  });

  it('search respects scope filter (events only)', async () => {
    const events = makeChain([
      {
        eventType: 'session_started',
        payload: { agentName: 'TestAgent', tags: ['production'] },
        timestamp: '2026-01-15T10:00:00.000Z',
      },
      {
        eventType: 'custom',
        payload: { message: 'production error occurred' },
        timestamp: '2026-01-15T11:00:00.000Z',
      },
    ]);
    await store.insertEvents(events.map((e) => ({ ...e, tenantId: ORG_ID })));

    const eventResult = await adapter.search(ORG_ID, {
      query: 'production',
      scope: 'events',
    });
    expect(eventResult.items.every((i) => i.type === 'event')).toBe(true);
  });

  it('search respects time range filters', async () => {
    // Insert two separate chains for different sessions/times
    const chain1 = makeChain([
      {
        eventType: 'session_started',
        sessionId: 'sess_early',
        payload: { agentName: 'a1', tags: [] },
        timestamp: '2026-01-10T10:00:00.000Z',
      },
      {
        eventType: 'custom',
        sessionId: 'sess_early',
        payload: { message: 'important data here' },
        timestamp: '2026-01-10T11:00:00.000Z',
      },
    ]);
    await store.insertEvents(chain1.map((e) => ({ ...e, tenantId: ORG_ID })));

    const chain2 = makeChain([
      {
        eventType: 'session_started',
        sessionId: 'sess_late',
        payload: { agentName: 'a2', tags: [] },
        timestamp: '2026-01-20T10:00:00.000Z',
      },
      {
        eventType: 'custom',
        sessionId: 'sess_late',
        payload: { message: 'important data there' },
        timestamp: '2026-01-20T11:00:00.000Z',
      },
    ]);
    await store.insertEvents(chain2.map((e) => ({ ...e, tenantId: ORG_ID })));

    const result = await adapter.search(ORG_ID, {
      query: 'important',
      scope: 'events',
      from: '2026-01-15T00:00:00Z',
      to: '2026-01-25T23:59:59Z',
    });

    expect(result.items.length).toBe(1);
  });

  it('search respects limit', async () => {
    const overrides: Array<Partial<AgentLensEvent>> = [
      {
        eventType: 'session_started',
        payload: { agentName: 'a1', tags: [] },
        timestamp: '2026-01-15T10:00:00.000Z',
      },
    ];
    for (let i = 0; i < 5; i++) {
      overrides.push({
        eventType: 'custom',
        payload: { message: `findme item ${i}` },
        timestamp: `2026-01-15T${String(11 + i).padStart(2, '0')}:00:00.000Z`,
      });
    }
    const events = makeChain(overrides);
    await store.insertEvents(events.map((e) => ({ ...e, tenantId: ORG_ID })));

    const result = await adapter.search(ORG_ID, {
      query: 'findme',
      scope: 'events',
      limit: 2,
    });

    expect(result.items.length).toBeLessThanOrEqual(2);
  });

  it('search tenant isolation', async () => {
    const orgA = 'org_search_a';
    const orgB = 'org_search_b';

    const chainA = makeChain([
      {
        eventType: 'session_started',
        sessionId: 'sess_A',
        payload: { agentName: 'a', tags: [] },
        timestamp: '2026-01-15T10:00:00.000Z',
      },
      {
        eventType: 'custom',
        sessionId: 'sess_A',
        payload: { message: 'unique_secret_data' },
        timestamp: '2026-01-15T11:00:00.000Z',
      },
    ]);
    await store.insertEvents(chainA.map((e) => ({ ...e, tenantId: orgA })));

    const chainB = makeChain([
      {
        eventType: 'session_started',
        sessionId: 'sess_B',
        payload: { agentName: 'b', tags: [] },
        timestamp: '2026-01-15T10:00:00.000Z',
      },
    ]);
    await store.insertEvents(chainB.map((e) => ({ ...e, tenantId: orgB })));

    const resultA = await adapter.search(orgA, { query: 'unique_secret_data', scope: 'events' });
    const resultB = await adapter.search(orgB, { query: 'unique_secret_data', scope: 'events' });

    expect(resultA.items.length).toBe(1);
    expect(resultB.items.length).toBe(0);
  });

  it('search result has correct shape', async () => {
    const events = makeChain([
      {
        eventType: 'session_started',
        payload: { agentName: 'a1', tags: [] },
        timestamp: '2026-01-15T10:00:00.000Z',
      },
      {
        eventType: 'custom',
        payload: { message: 'shape_check_test' },
        timestamp: '2026-01-15T11:00:00.000Z',
      },
    ]);
    await store.insertEvents(events.map((e) => ({ ...e, tenantId: ORG_ID })));

    const result = await adapter.search(ORG_ID, { query: 'shape_check_test', scope: 'events' });
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('hasMore');

    if (result.items.length > 0) {
      const item = result.items[0]!;
      expect(item).toHaveProperty('type');
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('score');
      expect(item).toHaveProperty('headline');
      expect(item).toHaveProperty('timestamp');
    }
  });
});
