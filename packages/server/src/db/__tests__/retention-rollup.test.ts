/**
 * Scale & retention (#124): rollup-backed analytics parity, and retention that
 * anchors-and-rolls-up before purge (cost survives; tampered segments aren't purged).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createEvent } from '@agentkitai/agentlens-core';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { SqliteEventStore } from '../sqlite-store.js';
import { RetentionService } from '../services/retention-service.js';
import { AnalyticsRepository } from '../repositories/analytics-repository.js';

let db: SqliteDb;
let store: SqliteEventStore;

beforeEach(() => {
  process.env.AUDIT_SIGNING_KEY = 'test-anchor-key';
  db = createTestDb();
  runMigrations(db);
  store = new SqliteEventStore(db);
});

afterEach(() => {
  delete process.env.AUDIT_SIGNING_KEY;
});

/** Insert a chained session (llm_call → llm_response) at the given timestamps. */
async function seedSession(sessionId: string, costUsd: number, ts = '2020-01-01T00') {
  const e1 = createEvent({
    sessionId, agentId: 'a', tenantId: 't', prevHash: null, eventType: 'llm_call',
    payload: { model: 'gpt-4o', callId: 'c', provider: 'openai', messages: [] } as never,
    metadata: { verifiedAgentId: 'agt_1' }, timestamp: `${ts}:00:00.000Z`,
  });
  const e2 = createEvent({
    sessionId, agentId: 'a', tenantId: 't', prevHash: e1.hash, eventType: 'llm_response',
    payload: { model: 'gpt-4o', callId: 'c', provider: 'openai', completion: 'x', finishReason: 'stop', costUsd, usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, latencyMs: 10 } as never,
    metadata: { verifiedAgentId: 'agt_1' }, timestamp: `${ts}:00:01.000Z`,
  });
  await store.insertEvents([e1, e2]);
  return { e1, e2 };
}

describe('rollup-backed analytics', () => {
  it('totals + per-agent cost match the raw events (parity)', async () => {
    await seedSession('s1', 0.05);
    await seedSession('s2', 0.03);
    const analytics = new AnalyticsRepository(db);
    const r = analytics.getRollupAnalytics({ tenantId: 't', from: '2019-01-01T00:00:00Z', to: '2030-01-01T00:00:00Z' });
    expect(r.totals.costUsd).toBeCloseTo(0.08);
    expect(r.totals.llmCallCount).toBe(2);
    expect(r.totals.inputTokens).toBe(200);
    expect(r.byAgent).toEqual([expect.objectContaining({ verifiedAgentId: 'agt_1', costUsd: expect.closeTo(0.08, 5) })]);
  });
});

describe('rollup-aware retention', () => {
  it('anchors + preserves cost before purging raw events', async () => {
    const { e2 } = await seedSession('s1', 0.05);
    const analytics = new AnalyticsRepository(db);
    const before = analytics.getRollupAnalytics({ tenantId: 't', from: '2019-01-01T00:00:00Z', to: '2030-01-01T00:00:00Z' });
    expect(before.totals.costUsd).toBeCloseTo(0.05);

    const result = await new RetentionService(db).applyRetention('2025-01-01T00:00:00Z');
    expect(result.deletedCount).toBe(2);
    expect(result.anchoredSegments).toBe(1);
    expect(result.skippedSegments).toBe(0);

    // Raw events purged...
    expect((await store.queryEvents({ sessionId: 's1' })).events).toHaveLength(0);
    // ...but a signed anchor was written first, covering the segment...
    const anchors = db.all<any>(sql`SELECT * FROM chain_anchors WHERE session_id = 's1'`);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].event_count).toBe(2);
    expect(anchors[0].last_hash).toBe(e2.hash);
    expect(anchors[0].signature).toBeTruthy();
    // ...and the cost still resolves from rollups after the purge.
    const after = analytics.getRollupAnalytics({ tenantId: 't', from: '2019-01-01T00:00:00Z', to: '2030-01-01T00:00:00Z' });
    expect(after.totals.costUsd).toBeCloseTo(0.05);
  });

  it('refuses to purge a tampered segment (no anchor, events retained)', async () => {
    const { e2 } = await seedSession('s2', 0.05);
    // Tamper the stored payload so the recomputed hash no longer matches.
    db.run(sql`UPDATE events SET payload = '{"tampered":true}' WHERE id = ${e2.id}`);

    const result = await new RetentionService(db).applyRetention('2025-01-01T00:00:00Z');
    expect(result.skippedSegments).toBe(1);
    expect(result.deletedCount).toBe(0);
    expect((await store.queryEvents({ sessionId: 's2' })).events).toHaveLength(2); // not purged
    expect(db.all<any>(sql`SELECT * FROM chain_anchors WHERE session_id = 's2'`)).toHaveLength(0);
  });
});
