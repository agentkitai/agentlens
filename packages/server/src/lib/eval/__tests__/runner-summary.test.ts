/**
 * Run-level chained eval_result summary on dataset-run completion (#121).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, type SqliteDb } from '../../../db/index.js';
import { runMigrations } from '../../../db/migrate.js';
import { EvalStore } from '../../../db/eval-store.js';
import { SqliteEventStore } from '../../../db/sqlite-store.js';
import { EvalRunner } from '../runner.js';
import { ScorerRegistry } from '../scorers/index.js';
import { ExactMatchScorer } from '../scorers/exact-match.js';

let db: SqliteDb;
let evalStore: EvalStore;
let eventStore: SqliteEventStore;

beforeEach(async () => {
  db = createTestDb();
  runMigrations(db);
  evalStore = new EvalStore(db);
  eventStore = new SqliteEventStore(db);
});

function registry(): ScorerRegistry {
  const r = new ScorerRegistry();
  r.register(new ExactMatchScorer());
  return r;
}

async function eventsFor(runId: string) {
  return (await eventStore.queryEvents({ sessionId: `eval_run_${runId}` })).events;
}

describe('EvalRunner run-level chained summary (#121)', async () => {
  it('appends a hash-chained eval_result with per-agent cost split + variant attribution', async () => {
    const ds = await evalStore.createDataset('t1', {
      name: 'D',
      testCases: [
        { input: { prompt: 'Q1' }, expectedOutput: 'A1' },
        { input: { prompt: 'Q2' }, expectedOutput: 'A2' },
      ],
    });
    const run = await evalStore.createRun('t1', {
      datasetId: ds.id,
      agentId: 'agent-1',
      webhookUrl: 'http://x',
      config: { scorers: [{ type: 'exact_match' }], passThreshold: 0.7, concurrency: 2 },
      promptVersionId: 'ver_1',
      modelId: 'claude-haiku-4-5',
      triggeredBy: 'user-7',
      triggeredByMethod: 'api_key',
    });

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ output: 'A1', metadata: { costUsd: 0.01 } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ output: 'WRONG', metadata: { costUsd: 0.02 } }) });

    const runner = new EvalRunner({ evalStore, scorerRegistry: registry(), eventStore, fetch: mockFetch as never });
    await runner.execute(run.id, 't1');

    const events = await eventsFor(run.id);
    const summary = events.find((e) => e.eventType === 'eval_result');
    expect(summary).toBeDefined();
    const p = summary!.payload as {
      scorerType: string;
      method: string;
      passed: boolean;
      evalRunId: string;
      violations?: unknown[];
    };
    expect(p.scorerType).toBe('dataset_run');
    expect(p.method).toBe('deterministic'); // exact_match only, no judge
    expect(p.passed).toBe(false); // one case failed
    expect(p.evalRunId).toBe(run.id);
    expect(p.violations).toHaveLength(1);
    // Cost split: agent-under-test spend distinct from judge spend.
    expect(summary!.metadata.agentCostUsd).toBeCloseTo(0.03);
    expect(summary!.metadata.judgeCostUsd).toBe(0);
    expect(summary!.metadata.promptVersionId).toBe('ver_1');
    expect(summary!.metadata.modelId).toBe('claude-haiku-4-5');
    expect(summary!.metadata.triggeredBy).toBe('user-7');
    // Chained: first event in the synthetic per-run session → prevHash null, hash present.
    expect(summary!.prevHash).toBeNull();
    expect(summary!.hash).toBeTruthy();
  });

  it('emits no summary when no event store is wired', async () => {
    const ds = await evalStore.createDataset('t1', { name: 'D', testCases: [{ input: { prompt: 'Q1' }, expectedOutput: 'A1' }] });
    const run = await evalStore.createRun('t1', {
      datasetId: ds.id,
      agentId: 'a',
      webhookUrl: 'http://x',
      config: { scorers: [{ type: 'exact_match' }], passThreshold: 0.7, concurrency: 1 },
    });
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ output: 'A1' }) });
    const runner = new EvalRunner({ evalStore, scorerRegistry: registry(), fetch: mockFetch as never });
    await runner.execute(run.id, 't1');
    expect((await eventsFor(run.id)).filter((e) => e.eventType === 'eval_result')).toHaveLength(0);
  });
});
