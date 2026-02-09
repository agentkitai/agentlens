/**
 * Analytics Query Tests (S-4.3)
 *
 * Tests for cost analytics, health score analytics, token usage analytics,
 * and general analytics. Runs against SQLite (always) and Postgres (when available).
 *
 * ~10 tests covering all analytics query types.
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
    const id = overrides.id ?? `evt_an_${String(counter).padStart(6, '0')}`;
    const base = {
      id,
      timestamp: overrides.timestamp ?? new Date(Date.UTC(2026, 0, 15, 10, 0, counter)).toISOString(),
      sessionId: overrides.sessionId ?? 'sess_an_001',
      agentId: overrides.agentId ?? 'agent_an_001',
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

const ORG_ID = 'default';

describe('S-4.3: Analytics Queries — SQLite', () => {
  let adapter: StorageAdapter;
  let store: SqliteEventStore;

  beforeEach(() => {
    counter = 0;
    const db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    adapter = new SqliteStorageAdapter(store);
  });

  it('getCostAnalytics returns empty for no data', async () => {
    const result = await adapter.getCostAnalytics(ORG_ID, {
      from: '2026-01-01T00:00:00Z', to: '2026-12-31T23:59:59Z', granularity: 'day',
    });
    expect(result.buckets).toEqual([]);
    expect(result.totalCostUsd).toBe(0);
    expect(result.totalEvents).toBe(0);
  });

  it('getCostAnalytics aggregates cost_tracked events', async () => {
    const events = makeChain([
      { eventType: 'session_started', payload: { agentName: 'a1', tags: [] }, timestamp: '2026-01-15T10:00:00.000Z' },
      { eventType: 'cost_tracked', payload: { costUsd: 0.05, model: 'gpt-4' }, timestamp: '2026-01-15T11:00:00.000Z' },
      { eventType: 'cost_tracked', payload: { costUsd: 0.10, model: 'gpt-4' }, timestamp: '2026-01-15T12:00:00.000Z' },
    ]);
    await store.insertEvents(events.map((e) => ({ ...e, tenantId: ORG_ID })));

    const result = await adapter.getCostAnalytics(ORG_ID, {
      from: '2026-01-01T00:00:00Z', to: '2026-12-31T23:59:59Z', granularity: 'day',
    });
    expect(result.totalCostUsd).toBeCloseTo(0.15, 4);
  });

  it('getTokenUsage returns result shape', async () => {
    const result = await adapter.getTokenUsage(ORG_ID, {
      from: '2026-01-01T00:00:00Z', to: '2026-12-31T23:59:59Z', granularity: 'day',
    });
    expect(result).toHaveProperty('buckets');
    expect(result).toHaveProperty('totals');
    expect(result.totals).toHaveProperty('inputTokens');
    expect(result.totals).toHaveProperty('outputTokens');
    expect(result.totals).toHaveProperty('totalTokens');
    expect(result.totals).toHaveProperty('llmCallCount');
  });

  it('getHealthAnalytics returns empty snapshots for SQLite', async () => {
    const result = await adapter.getHealthAnalytics(ORG_ID, {
      from: '2026-01-01T00:00:00Z', to: '2026-12-31T23:59:59Z', granularity: 'day',
    });
    expect(result.snapshots).toEqual([]);
  });

  it('getAnalytics returns bucketed results with totals', async () => {
    const events = makeChain([
      { eventType: 'session_started', payload: { agentName: 'a1', tags: [] }, timestamp: '2026-01-15T10:00:00.000Z' },
      { eventType: 'tool_call', payload: { toolName: 'search' }, timestamp: '2026-01-15T11:00:00.000Z' },
      { eventType: 'custom', severity: 'error', payload: { message: 'fail' }, timestamp: '2026-01-15T12:00:00.000Z' },
    ]);
    await store.insertEvents(events.map((e) => ({ ...e, tenantId: ORG_ID })));

    const result = await adapter.getAnalytics(ORG_ID, {
      from: '2026-01-01T00:00:00Z', to: '2026-12-31T23:59:59Z', granularity: 'day',
    });
    expect(result.totals.eventCount).toBe(3);
    expect(result.totals.toolCallCount).toBe(1);
    expect(result.totals.errorCount).toBe(1);
    expect(result.buckets.length).toBeGreaterThanOrEqual(1);
  });

  it('getAnalytics filters by agentId', async () => {
    const chainA = makeChain([
      { agentId: 'agent_A', eventType: 'session_started', sessionId: 'sess_A', payload: { agentName: 'A', tags: [] }, timestamp: '2026-01-15T10:00:00.000Z' },
      { agentId: 'agent_A', eventType: 'custom', sessionId: 'sess_A', timestamp: '2026-01-15T11:00:00.000Z' },
    ]);
    await store.insertEvents(chainA.map((e) => ({ ...e, tenantId: ORG_ID })));

    const chainB = makeChain([
      { agentId: 'agent_B', eventType: 'session_started', sessionId: 'sess_B', payload: { agentName: 'B', tags: [] }, timestamp: '2026-01-15T12:00:00.000Z' },
    ]);
    await store.insertEvents(chainB.map((e) => ({ ...e, tenantId: ORG_ID })));

    const result = await adapter.getAnalytics(ORG_ID, {
      from: '2026-01-01T00:00:00Z', to: '2026-12-31T23:59:59Z', granularity: 'day', agentId: 'agent_A',
    });
    expect(result.totals.eventCount).toBe(2);
  });

  it('getAnalytics respects time range boundaries', async () => {
    const chain1 = makeChain([
      { eventType: 'session_started', sessionId: 'sess_early', payload: { agentName: 'a1', tags: [] }, timestamp: '2026-01-10T10:00:00.000Z' },
    ]);
    await store.insertEvents(chain1.map((e) => ({ ...e, tenantId: ORG_ID })));

    const chain2 = makeChain([
      { eventType: 'session_started', sessionId: 'sess_late', payload: { agentName: 'a2', tags: [] }, timestamp: '2026-01-20T10:00:00.000Z' },
    ]);
    await store.insertEvents(chain2.map((e) => ({ ...e, tenantId: ORG_ID })));

    const result = await adapter.getAnalytics(ORG_ID, {
      from: '2026-01-15T00:00:00Z', to: '2026-01-25T23:59:59Z', granularity: 'day',
    });
    expect(result.totals.eventCount).toBe(1);
  });

  it('getCostAnalytics with hourly granularity returns correct shape', async () => {
    const events = makeChain([
      { eventType: 'session_started', payload: { agentName: 'a1', tags: [] }, timestamp: '2026-01-15T10:00:00.000Z' },
      { eventType: 'cost_tracked', payload: { costUsd: 0.01 }, timestamp: '2026-01-15T10:30:00.000Z' },
      { eventType: 'cost_tracked', payload: { costUsd: 0.02 }, timestamp: '2026-01-15T11:30:00.000Z' },
    ]);
    await store.insertEvents(events.map((e) => ({ ...e, tenantId: ORG_ID })));

    const result = await adapter.getCostAnalytics(ORG_ID, {
      from: '2026-01-15T00:00:00Z', to: '2026-01-15T23:59:59Z', granularity: 'hour',
    });
    expect(result.totalCostUsd).toBeCloseTo(0.03, 4);
    expect(result.buckets.length).toBeGreaterThanOrEqual(1);
  });

  it('analytics tenant isolation — different orgs see different data', async () => {
    const orgA = 'org_analytics_a';
    const orgB = 'org_analytics_b';

    const chainA = makeChain([
      { eventType: 'session_started', sessionId: 'sess_A', payload: { agentName: 'A', tags: [] }, timestamp: '2026-01-15T10:00:00.000Z' },
      { eventType: 'custom', sessionId: 'sess_A', timestamp: '2026-01-15T11:00:00.000Z' },
    ]);
    await store.insertEvents(chainA.map((e) => ({ ...e, tenantId: orgA })));

    const chainB = makeChain([
      { eventType: 'session_started', sessionId: 'sess_B', payload: { agentName: 'B', tags: [] }, timestamp: '2026-01-15T10:00:00.000Z' },
    ]);
    await store.insertEvents(chainB.map((e) => ({ ...e, tenantId: orgB })));

    const resultA = await adapter.getAnalytics(orgA, {
      from: '2026-01-01T00:00:00Z', to: '2026-12-31T23:59:59Z', granularity: 'day',
    });
    const resultB = await adapter.getAnalytics(orgB, {
      from: '2026-01-01T00:00:00Z', to: '2026-12-31T23:59:59Z', granularity: 'day',
    });

    expect(resultA.totals.eventCount).toBe(2);
    expect(resultB.totals.eventCount).toBe(1);
  });
});
