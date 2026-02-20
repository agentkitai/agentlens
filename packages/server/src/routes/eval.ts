/**
 * Eval REST API Routes (Feature 15 — Story 8)
 *
 * POST   /api/eval/datasets              — Create dataset
 * GET    /api/eval/datasets              — List datasets
 * GET    /api/eval/datasets/:id          — Get dataset + test cases
 * PUT    /api/eval/datasets/:id          — Update dataset metadata
 * POST   /api/eval/datasets/:id/cases    — Add test cases
 * PUT    /api/eval/datasets/:id/cases/:caseId — Update test case
 * DELETE /api/eval/datasets/:id/cases/:caseId — Delete test case
 * POST   /api/eval/datasets/:id/versions — Create new version
 * POST   /api/eval/runs                  — Trigger eval run (202)
 * GET    /api/eval/runs                  — List runs
 * GET    /api/eval/runs/:id              — Get run
 * GET    /api/eval/runs/:id/results      — Get per-case results
 * POST   /api/eval/runs/:id/cancel       — Cancel run
 */

import { Hono } from 'hono';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantId } from './tenant-helper.js';
import { EvalStore } from '../db/eval-store.js';
import { EvalRunner } from '../lib/eval/runner.js';
import { createDefaultRegistry } from '../lib/eval/index.js';
import type { SqliteDb } from '../db/index.js';

export function evalRoutes(db?: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const registry = createDefaultRegistry();

  function getStore(): EvalStore | null {
    if (!db) return null;
    return new EvalStore(db);
  }

  // ─── Dataset Routes ────────────────────────────────────

  app.post('/datasets', async (c) => {
    const store = getStore();
    if (!store) return c.json({ error: 'Database not available' }, 500);

    const tenantId = getTenantId(c);
    const body = await c.req.json().catch(() => null);
    if (!body || !body.name) {
      return c.json({ error: 'name is required' }, 400);
    }

    try {
      const dataset = store.createDataset(tenantId, {
        name: body.name,
        description: body.description,
        agentId: body.agentId,
        testCases: body.testCases,
      });
      return c.json(dataset, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.get('/datasets', async (c) => {
    const store = getStore();
    if (!store) return c.json({ error: 'Database not available' }, 500);

    const tenantId = getTenantId(c);
    const agentId = c.req.query('agentId') || undefined;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined;
    const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!, 10) : undefined;

    const { datasets, total } = store.listDatasets(tenantId, { agentId, limit, offset });
    return c.json({ datasets, total, hasMore: (offset ?? 0) + datasets.length < total });
  });

  app.get('/datasets/:id', async (c) => {
    const store = getStore();
    if (!store) return c.json({ error: 'Database not available' }, 500);

    const tenantId = getTenantId(c);
    const id = c.req.param('id');
    const dataset = store.getDataset(tenantId, id);
    if (!dataset) return c.json({ error: 'Dataset not found' }, 404);

    const testCases = store.getTestCases(id);
    return c.json({ ...dataset, testCases });
  });

  app.put('/datasets/:id', async (c) => {
    const store = getStore();
    if (!store) return c.json({ error: 'Database not available' }, 500);

    const tenantId = getTenantId(c);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Request body required' }, 400);

    const updated = store.updateDataset(tenantId, id, body);
    if (!updated) return c.json({ error: 'Dataset not found' }, 404);
    return c.json(updated);
  });

  app.post('/datasets/:id/cases', async (c) => {
    const store = getStore();
    if (!store) return c.json({ error: 'Database not available' }, 500);

    const tenantId = getTenantId(c);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body || !Array.isArray(body.testCases)) {
      return c.json({ error: 'testCases array is required' }, 400);
    }

    try {
      const cases = store.addTestCases(id, tenantId, body.testCases);
      return c.json({ testCases: cases }, 201);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('not found')) return c.json({ error: msg }, 404);
      if (msg.includes('immutable')) return c.json({ error: msg }, 409);
      return c.json({ error: msg }, 400);
    }
  });

  app.put('/datasets/:id/cases/:caseId', async (c) => {
    const store = getStore();
    if (!store) return c.json({ error: 'Database not available' }, 500);

    const tenantId = getTenantId(c);
    const caseId = c.req.param('caseId');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Request body required' }, 400);

    try {
      const updated = store.updateTestCase(tenantId, caseId, body);
      if (!updated) return c.json({ error: 'Test case not found' }, 404);
      return c.json(updated);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('immutable')) return c.json({ error: msg }, 409);
      return c.json({ error: msg }, 400);
    }
  });

  app.delete('/datasets/:id/cases/:caseId', async (c) => {
    const store = getStore();
    if (!store) return c.json({ error: 'Database not available' }, 500);

    const tenantId = getTenantId(c);
    const caseId = c.req.param('caseId');

    try {
      const deleted = store.deleteTestCase(tenantId, caseId);
      if (!deleted) return c.json({ error: 'Test case not found' }, 404);
      return c.body(null, 204);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('immutable')) return c.json({ error: msg }, 409);
      return c.json({ error: msg }, 400);
    }
  });

  app.post('/datasets/:id/versions', async (c) => {
    const store = getStore();
    if (!store) return c.json({ error: 'Database not available' }, 500);

    const tenantId = getTenantId(c);
    const id = c.req.param('id');

    try {
      const newVersion = store.createVersion(tenantId, id);
      return c.json(newVersion, 201);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('not found')) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 400);
    }
  });

  // ─── Run Routes ────────────────────────────────────────

  app.post('/runs', async (c) => {
    const store = getStore();
    if (!store) return c.json({ error: 'Database not available' }, 500);

    const tenantId = getTenantId(c);
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Request body required' }, 400);

    if (!body.datasetId) return c.json({ error: 'datasetId is required' }, 400);
    if (!body.agentId) return c.json({ error: 'agentId is required' }, 400);
    if (!body.webhookUrl) return c.json({ error: 'webhookUrl is required' }, 400);

    const config = {
      scorers: body.config?.scorers ?? [{ type: 'exact_match' as const }],
      passThreshold: body.config?.passThreshold ?? 0.7,
      concurrency: body.config?.concurrency ?? 5,
      rateLimitPerSec: body.config?.rateLimitPerSec,
      timeoutMs: body.config?.timeoutMs,
      retries: body.config?.retries,
      baselineRunId: body.config?.baselineRunId,
    };

    try {
      const run = store.createRun(tenantId, {
        datasetId: body.datasetId,
        agentId: body.agentId,
        webhookUrl: body.webhookUrl,
        config,
        baselineRunId: body.config?.baselineRunId,
      });

      // Spawn async execution
      const runner = new EvalRunner({ evalStore: store, scorerRegistry: registry });
      runner.execute(run.id, tenantId).catch((err) => {
        console.error(`[eval] Run ${run.id} failed:`, err);
      });

      return c.json({ id: run.id, status: run.status }, 202);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('not found')) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 400);
    }
  });

  app.get('/runs', async (c) => {
    const store = getStore();
    if (!store) return c.json({ error: 'Database not available' }, 500);

    const tenantId = getTenantId(c);
    const datasetId = c.req.query('datasetId') || undefined;
    const agentId = c.req.query('agentId') || undefined;
    const status = c.req.query('status') as any || undefined;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined;
    const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!, 10) : undefined;

    const { runs, total } = store.listRuns(tenantId, { datasetId, agentId, status, limit, offset });
    return c.json({ runs, total, hasMore: (offset ?? 0) + runs.length < total });
  });

  app.get('/runs/:id', async (c) => {
    const store = getStore();
    if (!store) return c.json({ error: 'Database not available' }, 500);

    const tenantId = getTenantId(c);
    const id = c.req.param('id');
    const run = store.getRun(tenantId, id);
    if (!run) return c.json({ error: 'Run not found' }, 404);
    return c.json(run);
  });

  app.get('/runs/:id/results', async (c) => {
    const store = getStore();
    if (!store) return c.json({ error: 'Database not available' }, 500);

    const tenantId = getTenantId(c);
    const id = c.req.param('id');
    const run = store.getRun(tenantId, id);
    if (!run) return c.json({ error: 'Run not found' }, 404);

    let results = store.getResults(id);

    // Filter by passed
    const passedFilter = c.req.query('passed');
    if (passedFilter !== undefined) {
      const passed = passedFilter === 'true';
      results = results.filter((r) => r.passed === passed);
    }

    // Filter by tag
    const tagFilter = c.req.query('tag');
    if (tagFilter) {
      const testCases = store.getTestCases(run.datasetId);
      const caseIdsWithTag = new Set(
        testCases.filter((tc) => tc.tags.includes(tagFilter)).map((tc) => tc.id),
      );
      results = results.filter((r) => caseIdsWithTag.has(r.testCaseId));
    }

    return c.json({ results });
  });

  app.post('/runs/:id/cancel', async (c) => {
    const store = getStore();
    if (!store) return c.json({ error: 'Database not available' }, 500);

    const tenantId = getTenantId(c);
    const id = c.req.param('id');
    const run = store.getRun(tenantId, id);
    if (!run) return c.json({ error: 'Run not found' }, 404);

    store.cancelRun(id);
    return c.json({ id, status: 'cancelled' });
  });

  return app;
}
