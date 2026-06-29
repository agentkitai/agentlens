/**
 * Time-bucketed rollups (#124): bucketing, batch aggregation, and incremental
 * rollup-on-ingest parity with raw events.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createEvent } from '@agentkitai/agentlens-core';
import { createTestDb, type SqliteDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SqliteEventStore } from '../../db/sqlite-store.js';
import { bucketStartHour, aggregateBatch } from '../rollup.js';

describe('bucketStartHour', () => {
  it('truncates an ISO timestamp to its UTC hour', () => {
    expect(bucketStartHour('2026-03-01T14:37:22.123Z')).toBe('2026-03-01T14:00:00Z');
    expect(bucketStartHour('2026-03-01T00:00:00Z')).toBe('2026-03-01T00:00:00Z');
  });
});

describe('aggregateBatch', () => {
  it('aggregates per (agent, model, hour) with cost/token/latency sums', () => {
    const mk = (over: any) =>
      createEvent({ sessionId: 's', agentId: 'a', tenantId: 't', prevHash: null, metadata: { verifiedAgentId: 'agt_x' }, ...over });
    const events = [
      mk({ eventType: 'llm_call', payload: { model: 'gpt-4o' } as any }),
      mk({ eventType: 'llm_response', payload: { model: 'gpt-4o', costUsd: 0.05, latencyMs: 120, usage: { inputTokens: 100, outputTokens: 50 } } as any }),
    ];
    const buckets = [...aggregateBatch(events, 'pv-1').values()];
    expect(buckets).toHaveLength(1);
    const b = buckets[0];
    expect(b.verifiedAgentId).toBe('agt_x');
    expect(b.model).toBe('gpt-4o');
    expect(b.eventCount).toBe(2);
    expect(b.llmCallCount).toBe(1);
    expect(b.costUsd).toBeCloseTo(0.05);
    expect(b.inputTokens).toBe(100);
    expect(b.outputTokens).toBe(50);
    expect(b.latencySumMs).toBe(120);
    expect(b.latencyCount).toBe(1);
    expect([...b.pricingVersions]).toEqual(['pv-1']); // stamped on the cost-bearing event
  });
});

describe('incremental rollup on ingest', () => {
  let db: SqliteDb;
  let store: SqliteEventStore;

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
  });

  function rollupRows(tenant = 't') {
    return db.all<any>(sql`SELECT * FROM cost_rollups WHERE tenant_id = ${tenant} ORDER BY model`);
  }

  it('writes rollup rows on insert that match the raw events, accumulating across batches', async () => {
    // Explicit, ordered timestamps so the chain-continuity guard is deterministic
    // regardless of suite-wide timer state (same hour bucket → one rollup row).
    const e1 = createEvent({
      sessionId: 's1', agentId: 'a', tenantId: 't', prevHash: null, metadata: { verifiedAgentId: 'agt_x' },
      eventType: 'llm_call', payload: { model: 'gpt-4o' } as any, timestamp: '2026-03-01T10:00:00.000Z',
    });
    const e2 = createEvent({
      sessionId: 's1', agentId: 'a', tenantId: 't', prevHash: e1.hash, metadata: { verifiedAgentId: 'agt_x' },
      eventType: 'llm_response', payload: { model: 'gpt-4o', costUsd: 0.05, latencyMs: 120, usage: { inputTokens: 100, outputTokens: 50 } } as any,
      timestamp: '2026-03-01T10:00:01.000Z',
    });
    await store.insertEvents([e1, e2]);

    let rows = rollupRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].cost_usd).toBeCloseTo(0.05);
    expect(rows[0].event_count).toBe(2);
    expect(rows[0].input_tokens).toBe(100);
    expect(JSON.parse(rows[0].pricing_versions).length).toBeGreaterThan(0); // pricing provenance retained

    // A second batch into the same hour bucket accumulates.
    const e3 = createEvent({
      sessionId: 's1', agentId: 'a', tenantId: 't', prevHash: e2.hash, metadata: { verifiedAgentId: 'agt_x' },
      eventType: 'llm_response', payload: { model: 'gpt-4o', costUsd: 0.03, usage: { inputTokens: 10, outputTokens: 5 } } as any,
      timestamp: '2026-03-01T10:00:02.000Z',
    });
    await store.insertEvents([e3]);

    rows = rollupRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].cost_usd).toBeCloseTo(0.08); // 0.05 + 0.03
    expect(rows[0].input_tokens).toBe(110);
    expect(rows[0].event_count).toBe(3);
  });

  it('keeps per-(verified agent) cost separable', async () => {
    const ev = (agent: string, vid: string, cost: number) =>
      createEvent({ sessionId: `sess-${agent}`, agentId: agent, tenantId: 't', prevHash: null, metadata: { verifiedAgentId: vid },
        eventType: 'cost_tracked', payload: { model: 'm', costUsd: cost } as any });
    await store.insertEvents([ev('a1', 'agt_1', 0.10)]);
    await store.insertEvents([ev('a2', 'agt_2', 0.25)]);

    const byAgent = db.all<any>(sql`SELECT verified_agent_id, cost_usd FROM cost_rollups WHERE tenant_id = 't' ORDER BY verified_agent_id`);
    expect(byAgent).toEqual([
      expect.objectContaining({ verified_agent_id: 'agt_1', cost_usd: 0.1 }),
      expect.objectContaining({ verified_agent_id: 'agt_2', cost_usd: 0.25 }),
    ]);
  });
});
