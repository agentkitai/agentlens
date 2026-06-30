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

beforeEach(async () => {
  db = createTestDb();
  runMigrations(db);
  store = new EvaluatorStore(db);
});

describe('EvaluatorStore CRUD', async () => {
  it('creates a draft, non-builtin evaluator', async () => {
    const ev = await store.create(T, { name: 'My PII check', scorerType: 'compliance', configTemplate: complianceCfg, tags: ['pii'] });
    expect(ev.status).toBe('draft');
    expect(ev.builtin).toBe(false);
    expect(ev.scorerType).toBe('compliance');
    expect((await store.get(T, ev.id))?.name).toBe('My PII check');
  });

  it('updates metadata but a different tenant cannot see/edit it', async () => {
    const ev = await store.create(T, { name: 'A', scorerType: 'compliance', configTemplate: complianceCfg });
    expect((await store.update(T, ev.id, { name: 'A2', tags: ['x'] }))?.name).toBe('A2');
    expect(await store.get('tenant-b', ev.id)).toBeNull(); // tenant isolation
    expect(await store.update('tenant-b', ev.id, { name: 'hack' })).toBeNull();
  });

  it('publish sets status+publishedAt; verify sets verifiedAt', async () => {
    const ev = await store.create(T, { name: 'A', scorerType: 'compliance', configTemplate: complianceCfg });
    const pub = await store.publish(T, ev.id, 'user-1')!;
    expect(pub.status).toBe('published');
    expect(pub.publishedAt).toBeDefined();
    expect(pub.publishedBy).toBe('user-1');
    const ver = await store.verify(T, ev.id)!;
    expect(ver.verifiedAt).toBeDefined();
  });

  it('delete removes a tenant-owned evaluator', async () => {
    const ev = await store.create(T, { name: 'A', scorerType: 'compliance', configTemplate: complianceCfg });
    expect(await store.delete(T, ev.id)).toBe(true);
    expect(await store.get(T, ev.id)).toBeNull();
    expect(await store.delete(T, ev.id)).toBe(false); // already gone
  });
});

describe('EvaluatorStore built-ins', async () => {
  beforeEach(async () => { await store.seedBuiltins(BUILTIN_EVALUATORS); });

  it('seeds global, read-only, published+verified built-ins visible to ANY tenant', async () => {
    const fromA = await store.list('tenant-a', { builtin: true });
    const fromB = await store.list('tenant-b', { builtin: true });
    expect(fromA.length).toBe(BUILTIN_EVALUATORS.length);
    expect(fromB.length).toBe(BUILTIN_EVALUATORS.length); // global
    const pii = await store.get('tenant-z', 'builtin:pii-no-exfil')!;
    expect(pii.builtin).toBe(true);
    expect(pii.status).toBe('published');
    expect(pii.verifiedAt).toBeDefined();
  });

  it('re-seeding is idempotent (updates in place, no duplicates)', async () => {
    await store.seedBuiltins(BUILTIN_EVALUATORS);
    await store.seedBuiltins(BUILTIN_EVALUATORS);
    expect((await store.list(T, { builtin: true })).length).toBe(BUILTIN_EVALUATORS.length);
  });

  it('refuses to edit/delete a built-in (tenant scope never matches __system__)', async () => {
    expect(await store.update(T, 'builtin:pii-no-exfil', { name: 'hijack' })).toBeNull();
    expect(await store.delete(T, 'builtin:pii-no-exfil')).toBe(false);
    expect((await store.get(T, 'builtin:pii-no-exfil'))?.name).toBe('PII — no exfiltration');
  });

  it('filters by scorerType and tag (own + built-ins)', async () => {
    await store.create(T, { name: 'mine', scorerType: 'llm_judge', configTemplate: { type: 'llm_judge', rubric: 'r' }, tags: ['custom'] });
    const judges = await store.list(T, { scorerType: 'llm_judge' });
    expect(judges.every((e) => e.scorerType === 'llm_judge')).toBe(true);
    expect(judges.some((e) => e.id === 'builtin:pii-leak-judge')).toBe(true); // built-in judge included
    expect((await store.list(T, { tag: 'custom' })).map((e) => e.name)).toEqual(['mine']);
  });
});
