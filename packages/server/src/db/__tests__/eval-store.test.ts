/**
 * Tests for EvalStore (Feature 15 — Stories 2 & 3)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { EvalStore, type CreateDatasetInput, type CreateTestCaseInput } from '../eval-store.js';

let db: SqliteDb;
let store: EvalStore;

beforeEach(() => {
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

describe('EvalStore — Dataset CRUD', () => {
  it('creates dataset with inline test cases', () => {
    const ds = store.createDataset('t1', makeDatasetInput());
    expect(ds.id).toBeDefined();
    expect(ds.tenantId).toBe('t1');
    expect(ds.name).toBe('Test Dataset');
    expect(ds.version).toBe(1);
    expect(ds.testCaseCount).toBe(1);
  });

  it('creates dataset without test cases', () => {
    const ds = store.createDataset('t1', makeDatasetInput({ testCases: [] }));
    expect(ds.testCaseCount).toBe(0);
  });

  it('gets dataset by id', () => {
    const created = store.createDataset('t1', makeDatasetInput());
    const fetched = store.getDataset('t1', created.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.testCaseCount).toBe(1);
  });

  it('returns undefined for nonexistent dataset', () => {
    expect(store.getDataset('t1', 'nonexistent')).toBeUndefined();
  });

  it('lists datasets with agentId filter', () => {
    store.createDataset('t1', makeDatasetInput({ name: 'DS1', agentId: 'a1' }));
    store.createDataset('t1', makeDatasetInput({ name: 'DS2', agentId: 'a2' }));

    const { datasets, total } = store.listDatasets('t1', { agentId: 'a1' });
    expect(datasets).toHaveLength(1);
    expect(total).toBe(1);
    expect(datasets[0]!.name).toBe('DS1');
  });

  it('lists datasets with pagination', () => {
    for (let i = 0; i < 5; i++) {
      store.createDataset('t1', makeDatasetInput({ name: `DS${i}` }));
    }
    const page1 = store.listDatasets('t1', { limit: 2, offset: 0 });
    expect(page1.datasets).toHaveLength(2);
    expect(page1.total).toBe(5);
  });

  it('updates dataset metadata', () => {
    const ds = store.createDataset('t1', makeDatasetInput());
    const updated = store.updateDataset('t1', ds.id, { name: 'Updated Name' });
    expect(updated!.name).toBe('Updated Name');
  });

  it('enforces tenant isolation', () => {
    const ds = store.createDataset('t1', makeDatasetInput());
    expect(store.getDataset('t2', ds.id)).toBeUndefined();
  });
});

// ─── Test Case CRUD ────────────────────────────────────────

describe('EvalStore — Test Case CRUD', () => {
  it('gets test cases for dataset', () => {
    const ds = store.createDataset('t1', makeDatasetInput());
    const cases = store.getTestCases(ds.id);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.input.prompt).toBe('Hello');
    expect(cases[0]!.expectedOutput).toBe('Hi there');
    expect(cases[0]!.tags).toEqual(['greeting']);
  });

  it('adds test cases', () => {
    const ds = store.createDataset('t1', makeDatasetInput({ testCases: [] }));
    const added = store.addTestCases(ds.id, 't1', [
      { input: { prompt: 'Q1' }, expectedOutput: 'A1' },
      { input: { prompt: 'Q2' }, expectedOutput: 'A2' },
    ]);
    expect(added).toHaveLength(2);
    expect(store.getTestCases(ds.id)).toHaveLength(2);
  });

  it('updates test case', () => {
    const ds = store.createDataset('t1', makeDatasetInput());
    const cases = store.getTestCases(ds.id);
    const updated = store.updateTestCase('t1', cases[0]!.id, {
      input: { prompt: 'Updated prompt' },
    });
    expect(updated!.input.prompt).toBe('Updated prompt');
  });

  it('deletes test case', () => {
    const ds = store.createDataset('t1', makeDatasetInput());
    const cases = store.getTestCases(ds.id);
    const deleted = store.deleteTestCase('t1', cases[0]!.id);
    expect(deleted).toBe(true);
    expect(store.getTestCases(ds.id)).toHaveLength(0);
  });

  it('throws when modifying immutable dataset', () => {
    const ds = store.createDataset('t1', makeDatasetInput());
    store.createVersion('t1', ds.id); // Makes ds immutable

    expect(() => store.addTestCases(ds.id, 't1', [{ input: { prompt: 'Q' } }])).toThrow('immutable');
    const cases = store.getTestCases(ds.id);
    expect(() => store.updateTestCase('t1', cases[0]!.id, { input: { prompt: 'X' } })).toThrow('immutable');
    expect(() => store.deleteTestCase('t1', cases[0]!.id)).toThrow('immutable');
  });
});

// ─── Versioning ────────────────────────────────────────────

describe('EvalStore — Versioning', () => {
  it('creates a new version with copied test cases', () => {
    const ds = store.createDataset('t1', makeDatasetInput());
    const v2 = store.createVersion('t1', ds.id);

    expect(v2.version).toBe(2);
    expect(v2.parentId).toBe(ds.id);
    expect(v2.testCaseCount).toBe(1);

    // Original is now immutable
    const original = store.getDataset('t1', ds.id);
    expect(original!.immutable).toBe(true);

    // New version has separate test cases
    const v2Cases = store.getTestCases(v2.id);
    expect(v2Cases).toHaveLength(1);
    expect(v2Cases[0]!.id).not.toBe(store.getTestCases(ds.id)[0]!.id);
  });

  it('new version is editable', () => {
    const ds = store.createDataset('t1', makeDatasetInput());
    const v2 = store.createVersion('t1', ds.id);
    const cases = store.getTestCases(v2.id);

    // Should not throw
    store.updateTestCase('t1', cases[0]!.id, { input: { prompt: 'Modified' } });
  });

  it('throws for nonexistent dataset', () => {
    expect(() => store.createVersion('t1', 'nonexistent')).toThrow('not found');
  });
});

// ─── Run CRUD ──────────────────────────────────────────────

describe('EvalStore — Run CRUD', () => {
  let datasetId: string;

  beforeEach(() => {
    const ds = store.createDataset('t1', makeDatasetInput());
    datasetId = ds.id;
  });

  it('creates run with pending status', () => {
    const run = store.createRun('t1', {
      datasetId,
      agentId: 'agent-1',
      webhookUrl: 'http://localhost/eval',
      config: { scorers: [{ type: 'exact_match' }], passThreshold: 0.7, concurrency: 5 },
    });
    expect(run.id).toBeDefined();
    expect(run.status).toBe('pending');
    expect(run.datasetVersion).toBe(1);
  });

  it('gets run by id', () => {
    const run = store.createRun('t1', {
      datasetId,
      agentId: 'agent-1',
      webhookUrl: 'http://localhost/eval',
      config: { scorers: [{ type: 'exact_match' }], passThreshold: 0.7, concurrency: 5 },
    });
    const fetched = store.getRun('t1', run.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(run.id);
  });

  it('lists runs with filters', () => {
    store.createRun('t1', {
      datasetId,
      agentId: 'agent-1',
      webhookUrl: 'http://localhost/eval',
      config: { scorers: [{ type: 'exact_match' }], passThreshold: 0.7, concurrency: 5 },
    });
    store.createRun('t1', {
      datasetId,
      agentId: 'agent-2',
      webhookUrl: 'http://localhost/eval',
      config: { scorers: [{ type: 'exact_match' }], passThreshold: 0.7, concurrency: 5 },
    });

    const { runs } = store.listRuns('t1', { agentId: 'agent-1' });
    expect(runs).toHaveLength(1);
  });

  it('updates run status with aggregates', () => {
    const run = store.createRun('t1', {
      datasetId,
      agentId: 'agent-1',
      webhookUrl: 'http://localhost/eval',
      config: { scorers: [{ type: 'exact_match' }], passThreshold: 0.7, concurrency: 5 },
    });

    store.updateRunStatus(run.id, 'running', { startedAt: new Date().toISOString() });
    const running = store.getRun('t1', run.id);
    expect(running!.status).toBe('running');

    store.updateRunStatus(run.id, 'completed', {
      totalCases: 10,
      passedCases: 8,
      failedCases: 2,
      avgScore: 0.85,
      completedAt: new Date().toISOString(),
    });
    const completed = store.getRun('t1', run.id);
    expect(completed!.status).toBe('completed');
    expect(completed!.totalCases).toBe(10);
    expect(completed!.passedCases).toBe(8);
  });

  it('cancels a run', () => {
    const run = store.createRun('t1', {
      datasetId,
      agentId: 'agent-1',
      webhookUrl: 'http://localhost/eval',
      config: { scorers: [{ type: 'exact_match' }], passThreshold: 0.7, concurrency: 5 },
    });
    store.cancelRun(run.id);
    const cancelled = store.getRun('t1', run.id);
    expect(cancelled!.status).toBe('cancelled');
  });

  it('enforces tenant isolation on runs', () => {
    const run = store.createRun('t1', {
      datasetId,
      agentId: 'agent-1',
      webhookUrl: 'http://localhost/eval',
      config: { scorers: [{ type: 'exact_match' }], passThreshold: 0.7, concurrency: 5 },
    });
    expect(store.getRun('t2', run.id)).toBeUndefined();
  });
});

// ─── Result CRUD ───────────────────────────────────────────

describe('EvalStore — Result CRUD', () => {
  let runId: string;
  let testCaseId: string;

  beforeEach(() => {
    const ds = store.createDataset('t1', makeDatasetInput());
    const cases = store.getTestCases(ds.id);
    testCaseId = cases[0]!.id;
    const run = store.createRun('t1', {
      datasetId: ds.id,
      agentId: 'agent-1',
      webhookUrl: 'http://localhost/eval',
      config: { scorers: [{ type: 'exact_match' }], passThreshold: 0.7, concurrency: 5 },
    });
    runId = run.id;
  });

  it('saves and retrieves results', () => {
    const result = store.saveResult({
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

    const results = store.getResults(runId);
    expect(results).toHaveLength(1);
  });

  it('gets result for specific case', () => {
    store.saveResult({
      runId,
      testCaseId,
      tenantId: 't1',
      actualOutput: 'answer',
      score: 0.5,
      passed: false,
      scorerType: 'exact_match',
      scorerDetails: { score: 0.5, passed: false, scorerType: 'exact_match' },
    });

    const result = store.getResultForCase(runId, testCaseId);
    expect(result).toBeDefined();
    expect(result!.score).toBe(0.5);
  });

  it('returns undefined for nonexistent result', () => {
    expect(store.getResultForCase(runId, 'nonexistent')).toBeUndefined();
  });
});
