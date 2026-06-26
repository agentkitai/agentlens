/**
 * GET /api/internal/agent-eval-status — latest completed eval pass-rate for one
 * agent, for AgentGate's per-agent eval gate (#7). Service-token gated; fails to
 * {found:false} rather than 500 so the gate can fail open.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { internalRoutes } from '../internal.js';
import { createTestDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SqliteEventStore } from '../../db/sqlite-store.js';
import { EvalStore } from '../../db/eval-store.js';

const SVC = 'svc-eval-status-token';

describe('GET /api/internal/agent-eval-status (#7)', () => {
  let db: any;
  let app: any;

  const get = (qs: string, token: string | null = SVC) => {
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return app.request(`/api/internal/agent-eval-status${qs}`, { headers });
  };

  function seedCompletedRun(agentId: string, total: number, passed: number) {
    const es = new EvalStore(db);
    const ds = es.createDataset('default', { name: `suite-${agentId}`, agentId });
    const run = es.createRun('default', { datasetId: ds.id, agentId, webhookUrl: 'http://x', config: {} });
    es.updateRunStatus(run.id, 'completed', { totalCases: total, passedCases: passed });
    return run.id;
  }

  beforeEach(() => {
    process.env['AGENTGATE_SERVICE_TOKEN'] = SVC;
    db = createTestDb();
    runMigrations(db);
    const store = new SqliteEventStore(db);
    app = new Hono();
    app.route('/api/internal', internalRoutes(store, db));
  });
  afterEach(() => {
    delete process.env['AGENTGATE_SERVICE_TOKEN'];
  });

  it('returns the latest completed run pass-rate for the agent', async () => {
    // An older run (lower pass-rate) then a newer one — newest must win.
    seedCompletedRun('agt_eval', 4, 1);
    await new Promise((r) => setTimeout(r, 5)); // ensure a later created_at
    seedCompletedRun('agt_eval', 4, 3);

    const res = await get('?agentId=agt_eval&tenantId=default');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.totalCases).toBe(4);
    expect(body.passedCases).toBe(3);
    expect(body.passRate).toBeCloseTo(0.75);
  });

  it('returns found:false for an agent with no completed runs', async () => {
    const res = await get('?agentId=agt_none&tenantId=default');
    expect(res.status).toBe(200);
    expect((await res.json()).found).toBe(false);
  });

  it('is tenant-scoped (another tenant sees no run)', async () => {
    seedCompletedRun('agt_eval', 2, 2);
    const res = await get('?agentId=agt_eval&tenantId=other');
    expect((await res.json()).found).toBe(false);
  });

  it('401 without the service token; 400 without agentId', async () => {
    expect((await get('?agentId=agt_eval&tenantId=default', null)).status).toBe(401);
    expect((await get('?tenantId=default')).status).toBe(400);
  });
});
