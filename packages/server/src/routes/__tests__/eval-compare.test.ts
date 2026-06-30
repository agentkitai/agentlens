/**
 * Run comparison / regression endpoint (#121): GET /api/eval/runs/:id/compare.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { evalRoutes } from '../eval.js';
import { authMiddleware, hashApiKey, type AuthVariables } from '../../middleware/auth.js';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SqliteEventStore } from '../../db/sqlite-store.js';
import { EvalStore, type EvalTestCase } from '../../db/eval-store.js';
import { apiKeys } from '../../db/schema.sqlite.js';

function createApp(db: any, store: SqliteEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('/*', authMiddleware(db, false));
  app.route('/api/eval', evalRoutes(db, store));
  return app;
}

function seedApiKey(db: any, tenantId = 'default', id = 'key1'): string {
  const rawKey = `als_testkey${id}1234567890abcdef1234567890`;
  db.insert(apiKeys).values({
    id,
    keyHash: hashApiKey(rawKey),
    name: id,
    scopes: JSON.stringify(['*']),
    createdAt: Math.floor(Date.now() / 1000),
    tenantId,
    role: 'editor',
  }).run();
  return rawKey;
}

const RUN_CONFIG = { scorers: [{ type: 'exact_match' as const }], passThreshold: 0.7, concurrency: 1 };

describe('GET /api/eval/runs/:id/compare (#121)', async () => {
  let db: any;
  let store: SqliteEventStore;
  let app: any;
  let apiKey: string;
  let evalStore: EvalStore;

  beforeEach(async () => {
    db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    app = createApp(db, store);
    apiKey = seedApiKey(db);
    evalStore = new EvalStore(db);
  });

  const auth = (k = apiKey) => ({ Authorization: `Bearer ${k}` });

  async function seedDataset(tenant: string): Promise<{ datasetId: string; cases: EvalTestCase[] }> {
    const ds = await evalStore.createDataset(tenant, {
      name: 'D',
      testCases: [{ input: { prompt: 'Q1' } }, { input: { prompt: 'Q2' } }],
    });
    return { datasetId: ds.id, cases: await evalStore.getTestCases(ds.id) };
  }

  async function seedRun(tenant: string, datasetId: string, cases: EvalTestCase[], outcomes: boolean[], baselineRunId?: string): Promise<string> {
    const run = await evalStore.createRun(tenant, { datasetId, agentId: 'a', webhookUrl: 'http://x', config: RUN_CONFIG, baselineRunId });
    let passed = 0;
    for (const [i, cse] of cases.entries()) {
      const ok = outcomes[i];
      if (ok) passed++;
      await evalStore.saveResult({
        runId: run.id,
        testCaseId: cse.id,
        tenantId: tenant,
        score: ok ? 1 : 0,
        passed: ok,
        scorerType: 'exact_match',
        scorerDetails: { score: ok ? 1 : 0, passed: ok, scorerType: 'exact_match' },
      });
    }
    await evalStore.updateRunStatus(run.id, 'completed', {
      totalCases: cases.length,
      passedCases: passed,
      failedCases: cases.length - passed,
      avgScore: passed / cases.length,
      completedAt: new Date().toISOString(),
    });
    return run.id;
  }

  it('returns a regression report with a pass→fail flip', async () => {
    const { datasetId, cases } = await seedDataset('default');
    const baseline = await seedRun('default', datasetId, cases, [true, true]);
    const current = await seedRun('default', datasetId, cases, [true, false]);

    const res = await app.request(`/api/eval/runs/${current}/compare?baselineRunId=${baseline}`, { headers: auth() });
    expect(res.status).toBe(200);
    const report = await res.json();
    expect(report.flippedCases).toHaveLength(1);
    expect(report.flippedCases[0].direction).toBe('pass_to_fail');
    expect(report.overallRegression).toBe(true);
    expect(report.passRateDelta).toBeCloseTo(-0.5);
    expect(report.datasetVersionMismatch).toBe(false);
  });

  it("defaults to the run's stored baselineRunId", async () => {
    const { datasetId, cases } = await seedDataset('default');
    const baseline = await seedRun('default', datasetId, cases, [true, true]);
    const current = await seedRun('default', datasetId, cases, [true, true], baseline);

    const res = await app.request(`/api/eval/runs/${current}/compare`, { headers: auth() });
    expect(res.status).toBe(200);
    const report = await res.json();
    expect(report.baselineRunId).toBe(baseline);
    expect(report.overallRegression).toBe(false);
  });

  it('400s when no baseline is available', async () => {
    const { datasetId, cases } = await seedDataset('default');
    const run = await seedRun('default', datasetId, cases, [true, true]);
    const res = await app.request(`/api/eval/runs/${run}/compare`, { headers: auth() });
    expect(res.status).toBe(400);
  });

  it('404s a run from another tenant (isolation)', async () => {
    const { datasetId, cases } = await seedDataset('default');
    const run = await seedRun('default', datasetId, cases, [true, true]);
    const otherKey = seedApiKey(db, 'other-tenant', 'key2');
    const res = await app.request(`/api/eval/runs/${run}/compare?baselineRunId=${run}`, {
      headers: { Authorization: `Bearer ${otherKey}` },
    });
    expect(res.status).toBe(404);
  });
});
