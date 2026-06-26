/**
 * EvaluatorStore (#55 Phase 4 — evaluator catalog).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { EvaluatorStore } from '../evaluator-store.js';
import { BUILTIN_EVALUATORS } from '../../lib/eval/builtin-evaluators.js';
import type { ScorerConfig } from '@agentkitai/agentlens-core';

let db: SqliteDb;
let store: EvaluatorStore;
const T = 'tenant-a';

const complianceCfg: ScorerConfig = { type: 'compliance', rules: [{ id: 'r1', type: 'tool_denylist', tools: ['delete_*'] }] };

beforeEach(() => {
  db = createTestDb();
  runMigrations(db);
  store = new EvaluatorStore(db);
});

describe('EvaluatorStore CRUD', () => {
  it('creates a draft, non-builtin evaluator', () => {
    const ev = store.create(T, { name: 'My PII check', scorerType: 'compliance', configTemplate: complianceCfg, tags: ['pii'] });
    expect(ev.status).toBe('draft');
    expect(ev.builtin).toBe(false);
    expect(ev.scorerType).toBe('compliance');
    expect(store.get(T, ev.id)?.name).toBe('My PII check');
  });

  it('updates metadata but a different tenant cannot see/edit it', () => {
    const ev = store.create(T, { name: 'A', scorerType: 'compliance', configTemplate: complianceCfg });
    expect(store.update(T, ev.id, { name: 'A2', tags: ['x'] })?.name).toBe('A2');
    expect(store.get('tenant-b', ev.id)).toBeNull(); // tenant isolation
    expect(store.update('tenant-b', ev.id, { name: 'hack' })).toBeNull();
  });

  it('publish sets status+publishedAt; verify sets verifiedAt', () => {
    const ev = store.create(T, { name: 'A', scorerType: 'compliance', configTemplate: complianceCfg });
    const pub = store.publish(T, ev.id, 'user-1')!;
    expect(pub.status).toBe('published');
    expect(pub.publishedAt).toBeDefined();
    expect(pub.publishedBy).toBe('user-1');
    const ver = store.verify(T, ev.id)!;
    expect(ver.verifiedAt).toBeDefined();
  });

  it('delete removes a tenant-owned evaluator', () => {
    const ev = store.create(T, { name: 'A', scorerType: 'compliance', configTemplate: complianceCfg });
    expect(store.delete(T, ev.id)).toBe(true);
    expect(store.get(T, ev.id)).toBeNull();
    expect(store.delete(T, ev.id)).toBe(false); // already gone
  });
});

describe('EvaluatorStore built-ins', () => {
  beforeEach(() => store.seedBuiltins(BUILTIN_EVALUATORS));

  it('seeds global, read-only, published+verified built-ins visible to ANY tenant', () => {
    const fromA = store.list('tenant-a', { builtin: true });
    const fromB = store.list('tenant-b', { builtin: true });
    expect(fromA.length).toBe(BUILTIN_EVALUATORS.length);
    expect(fromB.length).toBe(BUILTIN_EVALUATORS.length); // global
    const pii = store.get('tenant-z', 'builtin:pii-no-exfil')!;
    expect(pii.builtin).toBe(true);
    expect(pii.status).toBe('published');
    expect(pii.verifiedAt).toBeDefined();
  });

  it('re-seeding is idempotent (updates in place, no duplicates)', () => {
    store.seedBuiltins(BUILTIN_EVALUATORS);
    store.seedBuiltins(BUILTIN_EVALUATORS);
    expect(store.list(T, { builtin: true }).length).toBe(BUILTIN_EVALUATORS.length);
  });

  it('refuses to edit/delete a built-in (tenant scope never matches __system__)', () => {
    expect(store.update(T, 'builtin:pii-no-exfil', { name: 'hijack' })).toBeNull();
    expect(store.delete(T, 'builtin:pii-no-exfil')).toBe(false);
    expect(store.get(T, 'builtin:pii-no-exfil')?.name).toBe('PII — no exfiltration');
  });

  it('filters by scorerType and tag (own + built-ins)', () => {
    store.create(T, { name: 'mine', scorerType: 'llm_judge', configTemplate: { type: 'llm_judge', rubric: 'r' }, tags: ['custom'] });
    const judges = store.list(T, { scorerType: 'llm_judge' });
    expect(judges.every((e) => e.scorerType === 'llm_judge')).toBe(true);
    expect(judges.some((e) => e.id === 'builtin:pii-leak-judge')).toBe(true); // built-in judge included
    expect(store.list(T, { tag: 'custom' }).map((e) => e.name)).toEqual(['mine']);
  });
});
