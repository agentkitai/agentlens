/**
 * Tests for BenchmarkStore (Story 3.1)
 *
 * CRUD operations, status transitions, tenant isolation, results caching.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { BenchmarkStore, type CreateBenchmarkInput } from '../benchmark-store.js';
import type { BenchmarkResults, MetricComparison, VariantMetrics } from '@agentlensai/core';

let db: SqliteDb;
let store: BenchmarkStore;

beforeEach(() => {
  db = createTestDb();
  runMigrations(db);
  store = new BenchmarkStore(db);
});

function makeInput(overrides: Partial<CreateBenchmarkInput> = {}): CreateBenchmarkInput {
  return {
    name: 'Test Benchmark',
    description: 'A test benchmark',
    metrics: ['avg_cost', 'error_rate'],
    minSessionsPerVariant: 5,
    variants: [
      { name: 'Variant A', tag: 'tag-a', description: 'First variant' },
      { name: 'Variant B', tag: 'tag-b', description: 'Second variant' },
    ],
    ...overrides,
  };
}

function makeResults(benchmarkId: string, tenantId: string): BenchmarkResults {
  return {
    benchmarkId,
    tenantId,
    variants: [
      {
        variantId: 'v1',
        variantName: 'A',
        sessionCount: 10,
        metrics: {} as any,
      },
    ] as VariantMetrics[],
    comparisons: [] as MetricComparison[],
    summary: 'Test results summary',
    computedAt: new Date().toISOString(),
  };
}

// ─── Create ────────────────────────────────────────────────

describe('BenchmarkStore — create', () => {
  it('creates a benchmark with variants', () => {
    const result = store.create('tenant-1', makeInput());

    expect(result.id).toBeDefined();
    expect(result.tenantId).toBe('tenant-1');
    expect(result.name).toBe('Test Benchmark');
    expect(result.description).toBe('A test benchmark');
    expect(result.status).toBe('draft');
    expect(result.metrics).toEqual(['avg_cost', 'error_rate']);
    expect(result.minSessionsPerVariant).toBe(5);
    expect(result.variants).toHaveLength(2);
    expect(result.variants[0]!.name).toBe('Variant A');
    expect(result.variants[0]!.tag).toBe('tag-a');
    expect(result.variants[0]!.sortOrder).toBe(0);
    expect(result.variants[1]!.name).toBe('Variant B');
    expect(result.variants[1]!.sortOrder).toBe(1);
    expect(result.createdAt).toBeDefined();
    expect(result.updatedAt).toBeDefined();
  });

  it('validates minimum 2 variants', () => {
    expect(() =>
      store.create('tenant-1', makeInput({ variants: [{ name: 'Solo', tag: 'solo' }] })),
    ).toThrow('Benchmark must have between 2 and 10 variants');
  });

  it('validates maximum 10 variants', () => {
    const variants = Array.from({ length: 11 }, (_, i) => ({
      name: `Variant ${i}`,
      tag: `tag-${i}`,
    }));
    expect(() => store.create('tenant-1', makeInput({ variants }))).toThrow(
      'Benchmark must have between 2 and 10 variants',
    );
  });

  it('accepts exactly 10 variants', () => {
    const variants = Array.from({ length: 10 }, (_, i) => ({
      name: `Variant ${i}`,
      tag: `tag-${i}`,
    }));
    const result = store.create('tenant-1', makeInput({ variants }));
    expect(result.variants).toHaveLength(10);
  });
});

// ─── Get By ID ─────────────────────────────────────────────

describe('BenchmarkStore — getById', () => {
  it('returns benchmark with variants when found', () => {
    const created = store.create('tenant-1', makeInput());
    const fetched = store.getById('tenant-1', created.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.name).toBe('Test Benchmark');
    expect(fetched!.variants).toHaveLength(2);
  });

  it('returns null when not found', () => {
    expect(store.getById('tenant-1', 'nonexistent')).toBeNull();
  });
});

// ─── List ──────────────────────────────────────────────────

describe('BenchmarkStore — list', () => {
  it('lists benchmarks with status filter', () => {
    store.create('tenant-1', makeInput({ name: 'Draft One' }));
    store.create('tenant-1', makeInput({ name: 'Draft Two' }));
    const b3 = store.create('tenant-1', makeInput({ name: 'Running One' }));
    store.updateStatus('tenant-1', b3.id, 'running');

    const drafts = store.list('tenant-1', { status: 'draft' });
    expect(drafts.benchmarks).toHaveLength(2);
    expect(drafts.total).toBe(2);

    const running = store.list('tenant-1', { status: 'running' });
    expect(running.benchmarks).toHaveLength(1);
    expect(running.total).toBe(1);
  });

  it('lists benchmarks with agentId filter', () => {
    store.create('tenant-1', makeInput({ name: 'Agent X', agentId: 'agent-x' }));
    store.create('tenant-1', makeInput({ name: 'Agent Y', agentId: 'agent-y' }));
    store.create('tenant-1', makeInput({ name: 'No Agent' }));

    const result = store.list('tenant-1', { agentId: 'agent-x' });
    expect(result.benchmarks).toHaveLength(1);
    expect(result.benchmarks[0]!.name).toBe('Agent X');
  });

  it('supports pagination', () => {
    for (let i = 0; i < 5; i++) {
      store.create('tenant-1', makeInput({ name: `Benchmark ${i}` }));
    }

    const page1 = store.list('tenant-1', { limit: 2, offset: 0 });
    expect(page1.benchmarks).toHaveLength(2);
    expect(page1.total).toBe(5);

    const page2 = store.list('tenant-1', { limit: 2, offset: 2 });
    expect(page2.benchmarks).toHaveLength(2);

    const page3 = store.list('tenant-1', { limit: 2, offset: 4 });
    expect(page3.benchmarks).toHaveLength(1);
  });
});

// ─── Status Transitions ───────────────────────────────────

describe('BenchmarkStore — updateStatus', () => {
  it('allows draft → running', () => {
    const created = store.create('tenant-1', makeInput());
    const updated = store.updateStatus('tenant-1', created.id, 'running');
    expect(updated.status).toBe('running');
  });

  it('allows draft → cancelled', () => {
    const created = store.create('tenant-1', makeInput());
    const updated = store.updateStatus('tenant-1', created.id, 'cancelled');
    expect(updated.status).toBe('cancelled');
  });

  it('allows running → completed and sets completedAt', () => {
    const created = store.create('tenant-1', makeInput());
    store.updateStatus('tenant-1', created.id, 'running');
    const completed = store.updateStatus('tenant-1', created.id, 'completed');
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBeDefined();
  });

  it('allows running → cancelled', () => {
    const created = store.create('tenant-1', makeInput());
    store.updateStatus('tenant-1', created.id, 'running');
    const cancelled = store.updateStatus('tenant-1', created.id, 'cancelled');
    expect(cancelled.status).toBe('cancelled');
  });

  it('rejects invalid transition draft → completed', () => {
    const created = store.create('tenant-1', makeInput());
    expect(() => store.updateStatus('tenant-1', created.id, 'completed')).toThrow(
      'Invalid status transition',
    );
  });

  it('rejects invalid transition completed → running', () => {
    const created = store.create('tenant-1', makeInput());
    store.updateStatus('tenant-1', created.id, 'running');
    store.updateStatus('tenant-1', created.id, 'completed');
    expect(() => store.updateStatus('tenant-1', created.id, 'running')).toThrow(
      'Invalid status transition',
    );
  });

  it('throws for non-existent benchmark', () => {
    expect(() => store.updateStatus('tenant-1', 'nonexistent', 'running')).toThrow(
      'not found',
    );
  });
});

// ─── Delete ────────────────────────────────────────────────

describe('BenchmarkStore — delete', () => {
  it('deletes draft benchmarks', () => {
    const created = store.create('tenant-1', makeInput());
    const deleted = store.delete('tenant-1', created.id);
    expect(deleted).toBe(true);
    expect(store.getById('tenant-1', created.id)).toBeNull();
  });

  it('deletes cancelled benchmarks', () => {
    const created = store.create('tenant-1', makeInput());
    store.updateStatus('tenant-1', created.id, 'cancelled');
    expect(store.delete('tenant-1', created.id)).toBe(true);
  });

  it('refuses to delete running benchmarks', () => {
    const created = store.create('tenant-1', makeInput());
    store.updateStatus('tenant-1', created.id, 'running');
    expect(store.delete('tenant-1', created.id)).toBe(false);
  });

  it('refuses to delete completed benchmarks', () => {
    const created = store.create('tenant-1', makeInput());
    store.updateStatus('tenant-1', created.id, 'running');
    store.updateStatus('tenant-1', created.id, 'completed');
    expect(store.delete('tenant-1', created.id)).toBe(false);
  });
});

// ─── Results ───────────────────────────────────────────────

describe('BenchmarkStore — results', () => {
  it('saves and retrieves results', () => {
    const created = store.create('tenant-1', makeInput());
    const results = makeResults(created.id, 'tenant-1');
    store.saveResults('tenant-1', created.id, results);

    const fetched = store.getResults('tenant-1', created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.benchmarkId).toBe(created.id);
    expect(fetched!.summary).toBe('Test results summary');
    expect(fetched!.variants).toHaveLength(1);
  });

  it('returns null when no results exist', () => {
    const created = store.create('tenant-1', makeInput());
    expect(store.getResults('tenant-1', created.id)).toBeNull();
  });

  it('upserts results (replaces existing)', () => {
    const created = store.create('tenant-1', makeInput());

    const results1 = makeResults(created.id, 'tenant-1');
    results1.summary = 'First';
    store.saveResults('tenant-1', created.id, results1);

    const results2 = makeResults(created.id, 'tenant-1');
    results2.summary = 'Second';
    store.saveResults('tenant-1', created.id, results2);

    const fetched = store.getResults('tenant-1', created.id);
    expect(fetched!.summary).toBe('Second');
  });
});

// ─── Tenant Isolation ──────────────────────────────────────

describe('BenchmarkStore — tenant isolation', () => {
  it('isolates benchmarks by tenant', () => {
    store.create('tenant-1', makeInput({ name: 'Tenant 1 Benchmark' }));
    store.create('tenant-2', makeInput({ name: 'Tenant 2 Benchmark' }));

    const t1List = store.list('tenant-1');
    expect(t1List.benchmarks).toHaveLength(1);
    expect(t1List.benchmarks[0]!.name).toBe('Tenant 1 Benchmark');

    const t2List = store.list('tenant-2');
    expect(t2List.benchmarks).toHaveLength(1);
    expect(t2List.benchmarks[0]!.name).toBe('Tenant 2 Benchmark');
  });

  it('cannot access another tenant benchmark by id', () => {
    const created = store.create('tenant-1', makeInput());
    expect(store.getById('tenant-2', created.id)).toBeNull();
  });

  it('isolates results by tenant', () => {
    const b1 = store.create('tenant-1', makeInput());
    const results = makeResults(b1.id, 'tenant-1');
    store.saveResults('tenant-1', b1.id, results);

    expect(store.getResults('tenant-2', b1.id)).toBeNull();
  });
});
