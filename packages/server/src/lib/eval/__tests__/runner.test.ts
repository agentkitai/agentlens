/**
 * Tests for EvalRunner (Feature 15 — Story 7)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, type SqliteDb } from '../../../db/index.js';
import { runMigrations } from '../../../db/migrate.js';
import { EvalStore } from '../../../db/eval-store.js';
import { EvalRunner } from '../runner.js';
import { ScorerRegistry } from '../scorers/index.js';
import { ExactMatchScorer } from '../scorers/exact-match.js';
import { ContainsScorer } from '../scorers/contains.js';

let db: SqliteDb;
let evalStore: EvalStore;

beforeEach(() => {
  db = createTestDb();
  runMigrations(db);
  evalStore = new EvalStore(db);
});

function createRegistry(): ScorerRegistry {
  const registry = new ScorerRegistry();
  registry.register(new ExactMatchScorer());
  registry.register(new ContainsScorer());
  return registry;
}

function createDatasetAndRun(webhookUrl = 'http://localhost/eval') {
  const ds = evalStore.createDataset('t1', {
    name: 'Test',
    testCases: [
      { input: { prompt: 'Q1' }, expectedOutput: 'A1' },
      { input: { prompt: 'Q2' }, expectedOutput: 'A2' },
    ],
  });

  const run = evalStore.createRun('t1', {
    datasetId: ds.id,
    agentId: 'agent-1',
    webhookUrl,
    config: {
      scorers: [{ type: 'exact_match' }],
      passThreshold: 0.7,
      concurrency: 2,
    },
  });

  return { ds, run };
}

describe('EvalRunner', () => {
  it('executes a successful run', async () => {
    const { run } = createDatasetAndRun();

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ output: 'A1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ output: 'A2' }),
      });

    const runner = new EvalRunner({
      evalStore,
      scorerRegistry: createRegistry(),
      fetch: mockFetch as any,
    });

    await runner.execute(run.id, 't1');

    const completed = evalStore.getRun('t1', run.id);
    expect(completed!.status).toBe('completed');
    expect(completed!.totalCases).toBe(2);
    expect(completed!.passedCases).toBe(2);
    expect(completed!.failedCases).toBe(0);
    expect(completed!.avgScore).toBe(1.0);

    const results = evalStore.getResults(run.id);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('handles partial failures', async () => {
    const { run } = createDatasetAndRun();

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ output: 'A1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ output: 'WRONG' }),
      });

    const runner = new EvalRunner({
      evalStore,
      scorerRegistry: createRegistry(),
      fetch: mockFetch as any,
    });

    await runner.execute(run.id, 't1');

    const completed = evalStore.getRun('t1', run.id);
    expect(completed!.status).toBe('completed');
    expect(completed!.passedCases).toBe(1);
    expect(completed!.failedCases).toBe(1);
  });

  it('handles webhook timeout', async () => {
    const { run } = createDatasetAndRun();

    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('Aborted'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ output: 'A2' }),
      });

    const runner = new EvalRunner({
      evalStore,
      scorerRegistry: createRegistry(),
      fetch: mockFetch as any,
    });

    await runner.execute(run.id, 't1');

    const completed = evalStore.getRun('t1', run.id);
    expect(completed!.status).toBe('completed');
    // One failed (timeout), one passed
    expect(completed!.failedCases).toBe(1);

    const results = evalStore.getResults(run.id);
    const failed = results.find((r) => !r.passed);
    expect(failed!.error).toContain('Webhook error');
  });

  it('handles all cases failing — run still completes', async () => {
    const { run } = createDatasetAndRun();

    const mockFetch = vi.fn().mockRejectedValue(new Error('Server down'));

    const runner = new EvalRunner({
      evalStore,
      scorerRegistry: createRegistry(),
      fetch: mockFetch as any,
    });

    await runner.execute(run.id, 't1');

    const completed = evalStore.getRun('t1', run.id);
    expect(completed!.status).toBe('completed');
    expect(completed!.passedCases).toBe(0);
    expect(completed!.failedCases).toBe(2);
  });

  it('handles empty dataset', async () => {
    const ds = evalStore.createDataset('t1', { name: 'Empty', testCases: [] });
    const run = evalStore.createRun('t1', {
      datasetId: ds.id,
      agentId: 'agent-1',
      webhookUrl: 'http://localhost/eval',
      config: { scorers: [{ type: 'exact_match' }], passThreshold: 0.7, concurrency: 5 },
    });

    const runner = new EvalRunner({
      evalStore,
      scorerRegistry: createRegistry(),
      fetch: vi.fn() as any,
    });

    await runner.execute(run.id, 't1');

    const completed = evalStore.getRun('t1', run.id);
    expect(completed!.status).toBe('completed');
    expect(completed!.totalCases).toBe(0);
  });

  it('includes sessionId from webhook response', async () => {
    const { run } = createDatasetAndRun();

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ output: 'A1', sessionId: 'sess-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ output: 'A2' }),
      });

    const runner = new EvalRunner({
      evalStore,
      scorerRegistry: createRegistry(),
      fetch: mockFetch as any,
    });

    await runner.execute(run.id, 't1');

    const results = evalStore.getResults(run.id);
    const withSession = results.find((r) => r.sessionId === 'sess-123');
    expect(withSession).toBeDefined();
  });

  it('retries webhook failures', async () => {
    const ds = evalStore.createDataset('t1', {
      name: 'Test',
      testCases: [{ input: { prompt: 'Q1' }, expectedOutput: 'A1' }],
    });
    const run = evalStore.createRun('t1', {
      datasetId: ds.id,
      agentId: 'agent-1',
      webhookUrl: 'http://localhost/eval',
      config: { scorers: [{ type: 'exact_match' }], passThreshold: 0.7, concurrency: 1, retries: 1 },
    });

    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('Temporary'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ output: 'A1' }),
      });

    const runner = new EvalRunner({
      evalStore,
      scorerRegistry: createRegistry(),
      fetch: mockFetch as any,
    });

    await runner.execute(run.id, 't1');

    const completed = evalStore.getRun('t1', run.id);
    expect(completed!.passedCases).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
