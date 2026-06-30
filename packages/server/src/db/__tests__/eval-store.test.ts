/**
 * Tests for EvalStore (Feature 15 — Stories 2 & 3)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { EvalStore, type CreateDatasetInput, type CreateTestCaseInput } from '../eval-store.js';

let db: SqliteDb;
let store: EvalStore;

beforeEach(async () => {
  db = createTestDb();
  runMigrations(db);
  store = new EvalStore(db);
});

function makeDatasetInput(overrides: Partial<CreateDatasetInput> = {}): CreateDatasetInput {
  return {
    name: 'Test Dataset',
    description: 'A test dataset',
    agentId: 'agent-1',
    testCases: [
      {
        input: { prompt: 'Hello' },
        expectedOutput: 'Hi there',
        tags: ['greeting'],
        metadata: { category: 'basic' },
      },
    ],
    ...overrides,
  };
}

// ─── Dataset CRUD ──────────────────────────────────────────

describe('EvalStore — Dataset CRUD', async () => {
  it('creates dataset with inline test cases', async () => {
    const ds = await store.createDataset('t1', makeDatasetInput());
    expect(ds.id).toBeDefined();
    expect(ds.tenantId).toBe('t1');
    expect(ds.name).toBe('Test Dataset');
    expect(ds.version).toBe(1);
    expect(ds.testCaseCount).toBe(1);
  });

  it('creates dataset without test cases', async () => {
    const ds = await store.createDataset('t1', makeDatasetInput({ testCases: [] }));
    expect(ds.testCaseCount).toBe(0);
  });

  it('gets dataset by id', async () => {
    const created = await store.createDataset('t1', makeDatasetInput());
    const fetched = await store.getDataset('t1', created.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.testCaseCount).toBe(1);
  });

  it('returns undefined for nonexistent dataset', async () => {
    expect(await store.getDataset('t1', 'nonexistent')).toBeUndefined();
  });

  it('lists datasets with agentId filter', async () => {
    await store.createDataset('t1', makeDatasetInput({ name: 'DS1', agentId: 'a1' }));
    await store.createDataset('t1', makeDatasetInput({ name: 'DS2', agentId: 'a2' }));

    const { datasets, total } = await store.listDatasets('t1', { agentId: 'a1' });
    expect(datasets).toHaveLength(1);
    expect(total).toBe(1);
    expect(datasets[0]!.name).toBe('DS1');
  });

  it('lists datasets with pagination', async () => {
    for (let i = 0; i < 5; i++) {
      await store.createDataset('t1', makeDatasetInput({ name: `DS${i}` }));
    }
    const page1 = await store.listDatasets('t1', { limit: 2, offset: 0 });
    expect(page1.datasets).toHaveLength(2);
    expect(page1.total).toBe(5);
  });

  it('updates dataset metadata', async () => {
    const ds = await store.createDataset('t1', makeDatasetInput());
    const updated = await store.updateDataset('t1', ds.id, { name: 'Updated Name' });
    expect(updated!.name).toBe('Updated Name');
  });

  it('enforces tenant isolation', async () => {
    const ds = await store.createDataset('t1', makeDatasetInput());
    expect(await store.getDataset('t2', ds.id)).toBeUndefined();
  });
});

// ─── Test Case CRUD ────────────────────────────────────────

describe('EvalStore — Test Case CRUD', async () => {
  it('gets test cases for dataset', async () => {
    const ds = await store.createDataset('t1', makeDatasetInput());
    const cases = await store.getTestCases(ds.id);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.input.prompt).toBe('Hello');
    expect(cases[0]!.expectedOutput).toBe('Hi there');
    expect(cases[0]!.tags).toEqual(['greeting']);
  });

  it('adds test cases', async () => {
    const ds = await store.createDataset('t1', makeDatasetInput({ testCases: [] }));
    const added = await store.addTestCases(ds.id, 't1', [
      { input: { prompt: 'Q1' }, expectedOutput: 'A1' },
      { input: { prompt: 'Q2' }, expectedOutput: 'A2' },
    ]);
    expect(added).toHaveLength(2);
    expect(await store.getTestCases(ds.id)).toHaveLength(2);
  });

  it('updates test case', async () => {
    const ds = await store.createDataset('t1', makeDatasetInput());
    const cases = await store.getTestCases(ds.id);
    const updated = await store.updateTestCase('t1', cases[0]!.id, {
      input: { prompt: 'Updated prompt' },
    });
    expect(updated!.input.prompt).toBe('Updated prompt');
  });

  it('deletes test case', async () => {
    const ds = await store.createDataset('t1', makeDatasetInput());
    const cases = await store.getTestCases(ds.id);
    const deleted = await store.deleteTestCase('t1', cases[0]!.id);
    expect(deleted).toBe(true);
    expect(await store.getTestCases(ds.id)).toHaveLength(0);
  });

  it('throws when modifying immutable dataset', async () => {
    const ds = await store.createDataset('t1', makeDatasetInput());
    await store.createVersion('t1', ds.id); // Makes ds immutable

    await expect(store.addTestCases(ds.id, 't1', [{ input: { prompt: 'Q' } }])).rejects.toThrow('immutable');
    const cases = await store.getTestCases(ds.id);
    await expect(store.updateTestCase('t1', cases[0]!.id, { input: { prompt: 'X' } })).rejects.toThrow('immutable');
    await expect(store.deleteTestCase('t1', cases[0]!.id)).rejects.toThrow('immutable');
  });
});

// ─── Versioning ────────────────────────────────────────────

describe('EvalStore — Versioning', async () => {
  it('creates a new version with copied test cases', async () => {
    const ds = await store.createDataset('t1', makeDatasetInput());
    const v2 = await store.createVersion('t1', ds.id);

    expect(v2.version).toBe(2);
    expect(v2.parentId).toBe(ds.id);
    expect(v2.testCaseCount).toBe(1);

    // Original is now immutable
    const original = await store.getDataset('t1', ds.id);
    expect(original!.immutable).toBe(true);

    // New version has separate test cases
    const v2Cases = await store.getTestCases(v2.id);
    expect(v2Cases).toHaveLength(1);
    expect(v2Cases[0]!.id).not.toBe((await store.getTestCases(ds.id))[0]!.id);
  });

  it('new version is editable', async () => {
    const ds = await store.createDataset('t1', makeDatasetInput());
    const v2 = await store.createVersion('t1', ds.id);
    const cases = await store.getTestCases(v2.id);

    // Should not throw
    await store.updateTestCase('t1', cases[0]!.id, { input: { prompt: 'Modified' } });
  });

  it('throws for nonexistent dataset', async () => {
    await expect(store.createVersion('t1', 'nonexistent')).rejects.toThrow('not found');
  });
});

// ─── Run CRUD ──────────────────────────────────────────────

describe('EvalStore — Run CRUD', async () => {
  let datasetId: string;

  beforeEach(async () => {
    const ds = await store.createDataset('t1', makeDatasetInput());
    datasetId = ds.id;
  });

  it('creates run with pending status', async () => {
    const run = await store.createRun('t1', {
      datasetId,
      agentId: 'agent-1',
      webhookUrl: 'http://localhost/eval',
      config: { scorers: [{ type: 'exact_match' }], passThreshold: 0.7, concurrency: 5 },
    });
    expect(run.id).toBeDefined();
    expect(run.status).toBe('pending');
    expect(run.datasetVersion).toBe(1);
  });

  it('gets run by id', async () => {
    const run = await store.createRun('t1', {
      datasetId,
      agentId: 'agent-1',
      webhookUrl: 'http://localhost/eval',
      config: { scorers: [{ type: 'exact_match' }], passThreshold: 0.7, concurrency: 5 },
    });
    const fetched = await store.getRun('t1', run.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(run.id);
  });

  it('lists runs with filters', async () => {
    await store.createRun('t1', {
      datasetId,
      agentId: 'agent-1',
      webhookUrl: 'http://localhost/eval',
      config: { scorers: [{ type: 'exact_match' }], passThreshold: 0.7, concurrency: 5 },
    });
    await store.createRun('t1', {
      datasetId,
      agentId: 'agent-2',
      webhookUrl: 'http://localhost/eval',
      config: { scorers: [{ type: 'exact_match' }], passThreshold: 0.7, concurrency: 5 },
    });

    const { runs } = await store.listRuns('t1', { agentId: 'agent-1' });
    expect(runs).toHaveLength(1);
  });

  it('updates run status with aggregates', async () => {
    const run = await store.createRun('t1', {
      datasetId,
      agentId: 'agent-1',
      webhookUrl: 'http://localhost/eval',
      config: { scorers: [{ type: 'exact_match' }], passThreshold: 0.7, concurrency: 5 },
    });

    await store.updateRunStatus(run.id, 'running', { startedAt: new Date().toISOString() });
    const running = await store.getRun('t1', run.id);
    expect(running!.status).toBe('running');

    await store.updateRunStatus(run.id, 'completed', {
      totalCases: 10,
      passedCases: 8,
      failedCases: 2,
      avgScore: 0.85,
      completedAt: new Date().toISOString(),
    });
    const completed = await store.getRun('t1', run.id);
    expect(completed!.status).toBe('completed');
    expect(completed!.totalCases).toBe(10);
    expect(completed!.passedCases).toBe(8);
  });

  it('cancels a run', async () => {
    const run = await store.createRun('t1', {
      datasetId,
      agentId: 'agent-1',
      webhookUrl: 'http://localhost/eval',
      config: { scorers: [{ type: 'exact_match' }], passThreshold: 0.7, concurrency: 5 },
    });
    await store.cancelRun(run.id);
    const cancelled = await store.getRun('t1', run.id);
    expect(cancelled!.status).toBe('cancelled');
  });

  it('enforces tenant isolation on runs', async () => {
    const run = await store.createRun('t1', {
      datasetId,
      agentId: 'agent-1',
      webhookUrl: 'http://localhost/eval',
      config: { scorers: [{ type: 'exact_match' }], passThreshold: 0.7, concurrency: 5 },
    });
    expect(await store.getRun('t2', run.id)).toBeUndefined();
  });
});

// ─── Result CRUD ───────────────────────────────────────────

describe('EvalStore — Result CRUD', async () => {
  let runId: string;
  let testCaseId: string;

  beforeEach(async () => {
    const ds = await store.createDataset('t1', makeDatasetInput());
    const cases = await store.getTestCases(ds.id);
    testCaseId = cases[0]!.id;
    const run = await store.createRun('t1', {
      datasetId: ds.id,
      agentId: 'agent-1',
      webhookUrl: 'http://localhost/eval',
      config: { scorers: [{ type: 'exact_match' }], passThreshold: 0.7, concurrency: 5 },
    });
    runId = run.id;
  });

  it('saves and retrieves results', async () => {
    const result = await store.saveResult({
      runId,
      testCaseId,
      tenantId: 't1',
      actualOutput: 'Hi there',
      score: 1.0,
      passed: true,
      scorerType: 'exact_match',
      scorerDetails: { score: 1.0, passed: true, scorerType: 'exact_match', reasoning: 'Match' },
    });
    expect(result.id).toBeDefined();
    expect(result.score).toBe(1.0);
    expect(result.passed).toBe(true);

    const results = await store.getResults(runId);
    expect(results).toHaveLength(1);
  });

  it('gets result for specific case', async () => {
    await store.saveResult({
      runId,
      testCaseId,
      tenantId: 't1',
      actualOutput: 'answer',
      score: 0.5,
      passed: false,
      scorerType: 'exact_match',
      scorerDetails: { score: 0.5, passed: false, scorerType: 'exact_match' },
    });

    const result = await store.getResultForCase(runId, testCaseId);
    expect(result).toBeDefined();
    expect(result!.score).toBe(0.5);
  });

  it('returns undefined for nonexistent result', async () => {
    expect(await store.getResultForCase(runId, 'nonexistent')).toBeUndefined();
  });
});

// ─── Create items from a production trace (#214) ───────────

describe('EvalStore — createItemsFromTrace (#214)', () => {
  const tid = 't1';
  function ins(id: string, sessionId: string, type: string, payload: unknown) {
    db.run(sql`
      INSERT INTO events (id, timestamp, session_id, agent_id, event_type, payload, hash, tenant_id)
      VALUES (${id}, '2026-06-15T10:00:00Z', ${sessionId}, 'agt', ${type}, ${JSON.stringify(payload)}, ${'h_' + id}, ${tid})
    `);
  }
  function seedTrace(sessionId: string) {
    ins(`c1_${sessionId}`, sessionId, 'llm_call', { callId: 'k1', model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });
    ins(`r1_${sessionId}`, sessionId, 'llm_response', { callId: 'k1', completion: 'hello' });
    ins(`c2_${sessionId}`, sessionId, 'llm_call', { callId: 'k2', model: 'gpt-4o', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'q2' }] });
    ins(`r2_${sessionId}`, sessionId, 'llm_response', { callId: 'k2', completion: 'a2' });
  }

  it('creates a dataset with one case per paired llm call/response, carrying provenance', async () => {
    seedTrace('sess-1');
    const res = await store.createItemsFromTrace(tid, 'sess-1');
    expect(res.created).toBe(2);

    const cases = await store.getTestCases(res.datasetId);
    expect(cases).toHaveLength(2);
    const c1 = cases.find((c) => c.input.prompt === 'hi');
    expect(c1).toBeDefined();
    expect(c1!.expectedOutput).toBe('hello');
    expect((c1!.metadata as Record<string, unknown>).source).toBe('trace');
    expect((c1!.metadata as Record<string, unknown>).sourceEventId).toBe('c1_sess-1');
  });

  it('adds to an existing dataset and ignores unpaired events', async () => {
    seedTrace('sess-2');
    ins('c3_sess-2', 'sess-2', 'llm_call', { callId: 'k3', messages: [] }); // no matching response
    const ds = await store.createDataset(tid, { name: 'existing' });

    const res = await store.createItemsFromTrace(tid, 'sess-2', { datasetId: ds.id });
    expect(res.datasetId).toBe(ds.id);
    expect(res.created).toBe(2); // k1, k2 paired; k3 unpaired → ignored
    expect(await store.getTestCases(ds.id)).toHaveLength(2);
  });

  it('throws when the target dataset does not exist', async () => {
    await expect(store.createItemsFromTrace(tid, 'sess-x', { datasetId: 'nope' })).rejects.toThrow('not found');
  });
});
