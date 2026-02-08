/**
 * Tests for SessionSummaryStore (Story 5.1)
 *
 * CRUD operations + tenant isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { SessionSummaryStore } from '../session-summary-store.js';

let store: SessionSummaryStore;

beforeEach(() => {
  const db = createTestDb();
  runMigrations(db);
  store = new SessionSummaryStore(db);
});

describe('SessionSummaryStore.save', () => {
  it('creates a new session summary', () => {
    const result = store.save(
      'tenant-a',
      'ses-1',
      'Agent ran for 5m. Used tools: readFile, writeFile. 0 errors.',
      ['readFile', 'writeFile', 'tool_call'],
      ['readFile', 'writeFile'],
      null,
      'success',
    );

    expect(result.sessionId).toBe('ses-1');
    expect(result.tenantId).toBe('tenant-a');
    expect(result.summary).toContain('Agent ran for 5m');
    expect(result.topics).toEqual(['readFile', 'writeFile', 'tool_call']);
    expect(result.toolSequence).toEqual(['readFile', 'writeFile']);
    expect(result.errorSummary).toBeNull();
    expect(result.outcome).toBe('success');
    expect(result.createdAt).toBeTruthy();
    expect(result.updatedAt).toBeTruthy();
  });

  it('upserts on conflict (updates existing)', () => {
    store.save('tenant-a', 'ses-1', 'First summary', ['topic1'], [], null, 'success');
    const updated = store.save('tenant-a', 'ses-1', 'Updated summary', ['topic2'], ['tool1'], 'had errors', 'partial');

    expect(updated.summary).toBe('Updated summary');
    expect(updated.topics).toEqual(['topic2']);
    expect(updated.toolSequence).toEqual(['tool1']);
    expect(updated.errorSummary).toBe('had errors');
    expect(updated.outcome).toBe('partial');
  });

  it('stores error summary and outcome', () => {
    const result = store.save(
      'tenant-a',
      'ses-err',
      'Agent failed with errors.',
      ['error'],
      ['readFile'],
      'readFile: File not found; writeFile: Permission denied',
      'failure',
    );

    expect(result.errorSummary).toBe('readFile: File not found; writeFile: Permission denied');
    expect(result.outcome).toBe('failure');
  });
});

describe('SessionSummaryStore.get', () => {
  it('returns a summary by sessionId', () => {
    store.save('tenant-a', 'ses-1', 'Summary text', ['topic'], [], null, 'success');
    const result = store.get('tenant-a', 'ses-1');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('ses-1');
    expect(result!.summary).toBe('Summary text');
  });

  it('returns null for non-existent session', () => {
    expect(store.get('tenant-a', 'nonexistent')).toBeNull();
  });

  it('returns null for wrong tenant', () => {
    store.save('tenant-a', 'ses-1', 'Summary', [], [], null, null);
    expect(store.get('tenant-b', 'ses-1')).toBeNull();
  });
});

describe('SessionSummaryStore.getByTenant', () => {
  it('returns empty list when no summaries', () => {
    expect(store.getByTenant('tenant-a')).toEqual([]);
  });

  it('returns summaries for tenant only', () => {
    store.save('tenant-a', 'ses-1', 'Summary 1', [], [], null, null);
    store.save('tenant-a', 'ses-2', 'Summary 2', [], [], null, null);
    store.save('tenant-b', 'ses-3', 'Summary 3', [], [], null, null);

    const results = store.getByTenant('tenant-a');
    expect(results).toHaveLength(2);
  });

  it('applies limit and offset', () => {
    for (let i = 0; i < 5; i++) {
      store.save('tenant-a', `ses-${i}`, `Summary ${i}`, [], [], null, null);
    }

    const page1 = store.getByTenant('tenant-a', { limit: 2, offset: 0 });
    expect(page1).toHaveLength(2);

    const page2 = store.getByTenant('tenant-a', { limit: 2, offset: 2 });
    expect(page2).toHaveLength(2);

    const page3 = store.getByTenant('tenant-a', { limit: 2, offset: 4 });
    expect(page3).toHaveLength(1);
  });
});

describe('SessionSummaryStore.search', () => {
  beforeEach(() => {
    store.save('tenant-a', 'ses-1', 'Agent used readFile and writeFile tools successfully', ['readFile', 'writeFile'], ['readFile', 'writeFile'], null, 'success');
    store.save('tenant-a', 'ses-2', 'Agent failed with connection timeout errors', ['error', 'timeout'], ['apiCall'], 'Connection timeout after 30s', 'failure');
    store.save('tenant-a', 'ses-3', 'Agent performed database migration tasks', ['database', 'migration'], ['dbMigrate'], null, 'success');
    store.save('tenant-b', 'ses-4', 'Agent used readFile on tenant B', ['readFile'], ['readFile'], null, 'success');
  });

  it('finds summaries by summary text', () => {
    const results = store.search('tenant-a', 'readFile');
    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe('ses-1');
  });

  it('finds summaries by topics', () => {
    const results = store.search('tenant-a', 'timeout');
    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe('ses-2');
  });

  it('finds summaries by error summary', () => {
    const results = store.search('tenant-a', 'Connection timeout');
    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe('ses-2');
  });

  it('respects tenant isolation', () => {
    const results = store.search('tenant-a', 'tenant B');
    expect(results).toHaveLength(0);
  });

  it('respects limit', () => {
    // Add more matching results
    store.save('tenant-a', 'ses-5', 'Agent also used readFile', ['readFile'], [], null, null);
    const results = store.search('tenant-a', 'Agent', 2);
    expect(results).toHaveLength(2);
  });

  it('returns empty array for no matches', () => {
    const results = store.search('tenant-a', 'xyznonexistent');
    expect(results).toHaveLength(0);
  });
});

describe('Tenant Isolation', () => {
  it('tenant A cannot see tenant B summaries', () => {
    store.save('tenant-a', 'ses-1', 'A summary', [], [], null, null);
    store.save('tenant-b', 'ses-2', 'B summary', [], [], null, null);

    const aResults = store.getByTenant('tenant-a');
    expect(aResults).toHaveLength(1);
    expect(aResults[0].sessionId).toBe('ses-1');

    const bResults = store.getByTenant('tenant-b');
    expect(bResults).toHaveLength(1);
    expect(bResults[0].sessionId).toBe('ses-2');
  });

  it('tenant A cannot get tenant B summary by ID', () => {
    store.save('tenant-b', 'ses-1', 'B only', [], [], null, null);
    expect(store.get('tenant-a', 'ses-1')).toBeNull();
  });

  it('same sessionId in different tenants are independent', () => {
    store.save('tenant-a', 'ses-shared', 'Tenant A version', ['a'], [], null, 'success');
    store.save('tenant-b', 'ses-shared', 'Tenant B version', ['b'], [], null, 'failure');

    const a = store.get('tenant-a', 'ses-shared');
    const b = store.get('tenant-b', 'ses-shared');
    expect(a!.summary).toBe('Tenant A version');
    expect(b!.summary).toBe('Tenant B version');
  });
});
