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
import {
  complianceScoreRequestSchema,
  judgeScoreRequestSchema,
  createEvaluatorRequestSchema,
  updateEvaluatorRequestSchema,
} from '@agentkitai/agentlens-core';
import type { AgentLensEvent, ComplianceRule, EvalResultPayload, IEventStore } from '@agentkitai/agentlens-core';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantId, getTenantStore } from './tenant-helper.js';
import { EvalStore } from '../db/eval-store.js';
import { EvaluatorStore } from '../db/evaluator-store.js';
import { PromptStore } from '../db/prompt-store.js';
import { EvalRunner } from '../lib/eval/runner.js';
import { computeRegression } from '../lib/eval/regression.js';
import { createDefaultRegistry, evaluateCompliance, judgeWithLlm, judgeProviderFromEnv } from '../lib/eval/index.js';
import { appendEventToSession } from '../lib/append-event.js';
import { verifyAgentTokenWithMethod } from '../lib/agent-identity.js';
import type { SqliteDb } from '../db/index.js';

/**
 * Compact a session's events into a linear transcript for the LLM judge.
 * ponytail: flat transcript capped at 200 events; summarize/paginate if sessions
 * ever grow huge enough to blow the judge's context window.
 */
function buildSessionTranscript(events: AgentLensEvent[], maxEvents = 200): string {
  const slice = events.slice(0, maxEvents);
  const lines = slice.map((e) => {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const detail = p['toolName'] ?? p['message'] ?? p['model'] ?? p['output'] ?? '';
    const detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail);
    return `[${e.eventType}/${e.severity}] ${detailStr}`.trim();
  });
  if (events.length > maxEvents) lines.push(`… (${events.length - maxEvents} more events truncated)`);
  return lines.join('\n');
}

export function evalRoutes(db?: SqliteDb, store?: IEventStore) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const registry = createDefaultRegistry();

  function getStore(): EvalStore | null {
    if (!db) return null;
    return new EvalStore(db);
  }

  function getEvaluatorStore(): EvaluatorStore | null {
    if (!db) return null;
    return new EvaluatorStore(db);
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
      const dataset = await store.createDataset(tenantId, {
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

  // POST /api/eval/datasets/from-trace — build test cases from a production trace (#214)
  app.post('/datasets/from-trace', async (c) => {
    const store = getStore();
    if (!store) return c.json({ error: 'Database not available' }, 500);

    const tenantId = getTenantId(c);
    const body = await c.req.json().catch(() => null);
    if (!body || !body.sessionId) {
      return c.json({ error: 'sessionId is required' }, 400);
    }
    try {
      const result = await store.createItemsFromTrace(tenantId, String(body.sessionId), {
        datasetId: body.datasetId ? String(body.datasetId) : undefined,
        name: body.name ? String(body.name) : undefined,
      });
      return c.json(result, 201);
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

    const { datasets, total } = await store.listDatasets(tenantId, { agentId, limit, offset });
    return c.json({ datasets, total, hasMore: (offset ?? 0) + datasets.length < total });
  });

  app.get('/datasets/:id', async (c) => {
    const store = getStore();
    if (!store) return c.json({ error: 'Database not available' }, 500);

    const tenantId = getTenantId(c);
    const id = c.req.param('id');
    const dataset = await store.getDataset(tenantId, id);
    if (!dataset) return c.json({ error: 'Dataset not found' }, 404);

    const testCases = await store.getTestCases(id);
    return c.json({ ...dataset, testCases });
  });

  app.put('/datasets/:id', async (c) => {
    const store = getStore();
    if (!store) return c.json({ error: 'Database not available' }, 500);

    const tenantId = getTenantId(c);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'Request body required' }, 400);

    const updated = await store.updateDataset(tenantId, id, body);
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
      const cases = await store.addTestCases(id, tenantId, body.testCases);
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
      const updated = await store.updateTestCase(tenantId, caseId, body);
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
      const deleted = await store.deleteTestCase(tenantId, caseId);
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
      const newVersion = await store.createVersion(tenantId, id);
      return c.json(newVersion, 201);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('not found')) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 400);
    }
  });

  // ─── Run Routes ────────────────────────────────────────

  app.post('/runs', async (c) => {
    const evalStore = getStore();
    if (!evalStore) return c.json({ error: 'Database not available' }, 500);

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

    // Verified actor that triggered the run (#121): agent token, else API key.
    const verified = await verifyAgentTokenWithMethod(c.req.header('x-agent-token'));
    const apiKey = c.get('apiKey');
    const triggeredBy = verified?.id ?? apiKey?.id;
    const triggeredByMethod = verified?.method ?? (apiKey?.id ? 'api_key' : undefined);

    try {
      const run = await evalStore.createRun(tenantId, {
        datasetId: body.datasetId,
        agentId: body.agentId,
        webhookUrl: body.webhookUrl,
        config,
        baselineRunId: body.config?.baselineRunId,
        promptVersionId: typeof body.promptVersionId === 'string' ? body.promptVersionId : undefined,
        modelId: typeof body.modelId === 'string' ? body.modelId : undefined,
        triggeredBy,
        triggeredByMethod,
      });

      // Spawn async execution. eventStore enables the run-level chained summary;
      // promptStore resolves the prompt-version content for the webhook (#121).
      const runner = new EvalRunner({
        evalStore,
        scorerRegistry: registry,
        eventStore: store,
        promptStore: db ? new PromptStore(db) : undefined,
      });
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

    const { runs, total } = await store.listRuns(tenantId, { datasetId, agentId, status, limit, offset });
    return c.json({ runs, total, hasMore: (offset ?? 0) + runs.length < total });
  });

  app.get('/runs/:id', async (c) => {
    const store = getStore();
    if (!store) return c.json({ error: 'Database not available' }, 500);

    const tenantId = getTenantId(c);
    const id = c.req.param('id');
    const run = await store.getRun(tenantId, id);
    if (!run) return c.json({ error: 'Run not found' }, 404);
    return c.json(run);
  });

  app.get('/runs/:id/results', async (c) => {
    const store = getStore();
    if (!store) return c.json({ error: 'Database not available' }, 500);

    const tenantId = getTenantId(c);
    const id = c.req.param('id');
    const run = await store.getRun(tenantId, id);
    if (!run) return c.json({ error: 'Run not found' }, 404);

    let results = await store.getResults(id);

    // Filter by passed
    const passedFilter = c.req.query('passed');
    if (passedFilter !== undefined) {
      const passed = passedFilter === 'true';
      results = results.filter((r) => r.passed === passed);
    }

    // Filter by tag
    const tagFilter = c.req.query('tag');
    if (tagFilter) {
      const testCases = await store.getTestCases(run.datasetId);
      const caseIdsWithTag = new Set(
        testCases.filter((tc) => tc.tags.includes(tagFilter)).map((tc) => tc.id),
      );
      results = results.filter((r) => caseIdsWithTag.has(r.testCaseId));
    }

    return c.json({ results });
  });

  // GET /runs/:id/compare?baselineRunId=...&maxFlips=&maxScoreDrop= — regression report (#121)
  app.get('/runs/:id/compare', async (c) => {
    const evalStore = getStore();
    if (!evalStore) return c.json({ error: 'Database not available' }, 500);

    const tenantId = getTenantId(c);
    const id = c.req.param('id');
    const current = await evalStore.getRun(tenantId, id);
    if (!current) return c.json({ error: 'Run not found' }, 404);

    const baselineRunId = c.req.query('baselineRunId') || current.baselineRunId;
    if (!baselineRunId) {
      return c.json({ error: 'baselineRunId is required (none stored on the run)' }, 400);
    }
    const baseline = await evalStore.getRun(tenantId, baselineRunId);
    if (!baseline) return c.json({ error: 'Baseline run not found' }, 404);

    const report = computeRegression(
      baseline,
      current,
      await evalStore.getResults(baseline.id),
      await evalStore.getResults(current.id),
      {
        maxScoreDrop: c.req.query('maxScoreDrop') ? parseFloat(c.req.query('maxScoreDrop')!) : undefined,
        maxFlips: c.req.query('maxFlips') ? parseInt(c.req.query('maxFlips')!, 10) : undefined,
      },
    );
    return c.json(report);
  });

  // ─── Compliance Eval (#55 — Phase 1) ───────────────────
  //
  // Score a completed session against deterministic policy rules and record the
  // outcome as a hash-chained `eval_result` event in the session's audit trail —
  // making the eval result itself tamper-evident evidence.
  app.post('/sessions/:sessionId/compliance', async (c) => {
    if (!store) return c.json({ error: 'Event store not available' }, 500);

    const tenantStore = getTenantStore(store, c);
    const tenantId = getTenantId(c);
    const sessionId = c.req.param('sessionId');

    const body = await c.req.json().catch(() => null);
    const parsed = complianceScoreRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
      }, 400);
    }
    const { passThreshold } = parsed.data;

    // Rules come inline OR from a catalog evaluator (#55 Phase 4).
    let rules = parsed.data.rules;
    let evaluatorId: string | undefined;
    if (parsed.data.evaluatorId) {
      const evStore = getEvaluatorStore();
      if (!evStore) return c.json({ error: 'Evaluator catalog unavailable' }, 503);
      const ev = await evStore.get(tenantId, parsed.data.evaluatorId);
      if (!ev) return c.json({ error: 'Evaluator not found' }, 404);
      if (ev.scorerType !== 'compliance') {
        return c.json({ error: `Evaluator '${ev.id}' is a ${ev.scorerType} evaluator, not compliance` }, 400);
      }
      rules = (ev.configTemplate.rules ?? []) as ComplianceRule[];
      if (rules.length === 0) return c.json({ error: 'Evaluator has no compliance rules' }, 400);
      evaluatorId = ev.id;
    }

    const timeline = await tenantStore.getSessionTimeline(sessionId);
    if (timeline.length === 0) {
      return c.json({ error: 'Session not found or has no events' }, 404);
    }

    const result = evaluateCompliance(timeline, rules!);

    // Strict by default (any violation fails); a passThreshold switches to score-based.
    const passed = passThreshold !== undefined ? result.score >= passThreshold : result.passed;
    const agentId = parsed.data.agentId ?? timeline[0]!.agentId;

    const payload: EvalResultPayload = {
      scorerType: 'compliance',
      method: 'deterministic',
      score: result.score,
      passed,
      reasoning: result.reasoning,
      violations: result.violations,
      rulesEvaluated: result.rulesEvaluated,
    };

    let event;
    try {
      event = await appendEventToSession(tenantStore, {
        tenantId,
        sessionId,
        agentId,
        eventType: 'eval_result',
        severity: passed ? 'info' : 'warn',
        payload,
        metadata: { source: 'compliance_eval', ...(evaluatorId ? { evaluatorId } : {}) },
      });
    } catch (err) {
      // Hash-chain continuity error (e.g. concurrent append) → safe to retry.
      return c.json({ error: `Failed to record eval result: ${(err as Error).message}` }, 409);
    }

    return c.json({
      sessionId,
      score: result.score,
      passed,
      violations: result.violations,
      rulesEvaluated: result.rulesEvaluated,
      reasoning: result.reasoning,
      event: { id: event.id, hash: event.hash, prevHash: event.prevHash },
    }, 201);
  });

  // ─── Online LLM-Judge Scoring (#55 — Phase 2) ──────────
  //
  // Score a completed session against a rubric with the LLM judge and chain the
  // result into its audit trail. The judgment is non-deterministic, so it is
  // labelled method:'llm_judge' — the chain proves the judgment was recorded and
  // unaltered, NOT that the agent was compliant (that's the deterministic
  // /compliance endpoint). The judge's own token cost is recorded on the event.
  app.post('/sessions/:sessionId/score', async (c) => {
    if (!store) return c.json({ error: 'Event store not available' }, 500);

    const makeProvider = judgeProviderFromEnv();
    if (!makeProvider) {
      return c.json(
        { error: 'LLM judge not configured: set AGENTLENS_LLM_API_KEY (and AGENTLENS_LLM_PROVIDER=anthropic).' },
        503,
      );
    }

    const tenantStore = getTenantStore(store, c);
    const tenantId = getTenantId(c);
    const sessionId = c.req.param('sessionId');

    const body = await c.req.json().catch(() => null);
    const parsed = judgeScoreRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
      }, 400);
    }
    const { passThreshold, expectedOutput } = parsed.data;

    // Rubric/model come inline OR from a catalog evaluator (#55 Phase 4).
    let rubric = parsed.data.rubric;
    let model = parsed.data.model;
    let evaluatorId: string | undefined;
    if (parsed.data.evaluatorId) {
      const evStore = getEvaluatorStore();
      if (!evStore) return c.json({ error: 'Evaluator catalog unavailable' }, 503);
      const ev = await evStore.get(tenantId, parsed.data.evaluatorId);
      if (!ev) return c.json({ error: 'Evaluator not found' }, 404);
      if (ev.scorerType !== 'llm_judge') {
        return c.json({ error: `Evaluator '${ev.id}' is a ${ev.scorerType} evaluator, not llm_judge` }, 400);
      }
      // The evaluator is authoritative for its config (consistent with /compliance,
      // which takes the evaluator's rules wholesale); inline rubric/model are only a
      // fallback when the evaluator omits them.
      rubric = ev.configTemplate.rubric ?? rubric;
      model = ev.configTemplate.model ?? model;
      if (!rubric) return c.json({ error: 'Evaluator has no rubric' }, 400);
      evaluatorId = ev.id;
    }

    const timeline = await tenantStore.getSessionTimeline(sessionId);
    if (timeline.length === 0) {
      return c.json({ error: 'Session not found or has no events' }, 404);
    }

    const result = await judgeWithLlm({
      makeProvider,
      model,
      rubric: rubric!,
      inputPrompt: 'An AI agent session (the transcript is in Actual Output below).',
      expectedOutput,
      actualOutput: buildSessionTranscript(timeline),
    });

    const passed = passThreshold !== undefined ? result.score >= passThreshold : result.passed;
    const agentId = parsed.data.agentId ?? timeline[0]!.agentId;

    const payload: EvalResultPayload = {
      scorerType: 'llm_judge',
      method: 'llm_judge',
      score: result.score,
      passed,
      reasoning: result.reasoning,
      model: result.model,
      costUsd: result.costUsd,
      tokenCount: result.tokenCount,
    };

    let event;
    try {
      event = await appendEventToSession(tenantStore, {
        tenantId,
        sessionId,
        agentId,
        eventType: 'eval_result',
        severity: passed ? 'info' : 'warn',
        payload,
        metadata: { source: 'llm_judge_eval', ...(evaluatorId ? { evaluatorId } : {}) },
      });
    } catch (err) {
      return c.json({ error: `Failed to record eval result: ${(err as Error).message}` }, 409);
    }

    return c.json({
      sessionId,
      score: result.score,
      passed,
      reasoning: result.reasoning,
      model: result.model,
      costUsd: result.costUsd,
      tokenCount: result.tokenCount,
      event: { id: event.id, hash: event.hash, prevHash: event.prevHash },
    }, 201);
  });

  app.post('/runs/:id/cancel', async (c) => {
    const store = getStore();
    if (!store) return c.json({ error: 'Database not available' }, 500);

    const tenantId = getTenantId(c);
    const id = c.req.param('id');
    const run = await store.getRun(tenantId, id);
    if (!run) return c.json({ error: 'Run not found' }, 404);

    await store.cancelRun(id);
    return c.json({ id, status: 'cancelled' });
  });

  // ─── Evaluator Catalog (#55 — Phase 4) ─────────────────
  //
  // Reusable, named scorer definitions. Built-ins (PII/retention/authz/…) are
  // global + read-only; tenants add/publish/verify their own. Reference one by id
  // from the /compliance and /score endpoints (evaluatorId) instead of inlining
  // the config.

  app.get('/evaluators', async (c) => {
    const evStore = getEvaluatorStore();
    if (!evStore) return c.json({ error: 'Database not available' }, 500);
    const tenantId = getTenantId(c);
    const q = c.req.query();
    const evaluators = await evStore.list(tenantId, {
      scorerType: (q.scorerType as never) || undefined,
      tag: q.tag || undefined,
      status: (q.status as never) || undefined,
      builtin: q.builtin === undefined ? undefined : q.builtin === 'true',
      verified: q.verified === undefined ? undefined : q.verified === 'true',
    });
    return c.json({ evaluators });
  });

  app.get('/evaluators/:id', async (c) => {
    const evStore = getEvaluatorStore();
    if (!evStore) return c.json({ error: 'Database not available' }, 500);
    const ev = await evStore.get(getTenantId(c), c.req.param('id'));
    if (!ev) return c.json({ error: 'Evaluator not found' }, 404);
    return c.json(ev);
  });

  app.post('/evaluators', async (c) => {
    const evStore = getEvaluatorStore();
    if (!evStore) return c.json({ error: 'Database not available' }, 500);
    const parsed = createEvaluatorRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) }, 400);
    }
    const ev = await evStore.create(getTenantId(c), {
      name: parsed.data.name,
      description: parsed.data.description,
      scorerType: parsed.data.scorerType,
      // scorerType wins — spread first so a caller-supplied configTemplate.type
      // can't contradict the declared scorerType.
      configTemplate: { ...parsed.data.configTemplate, type: parsed.data.scorerType },
      tags: parsed.data.tags,
    });
    return c.json(ev, 201);
  });

  app.put('/evaluators/:id', async (c) => {
    const evStore = getEvaluatorStore();
    if (!evStore) return c.json({ error: 'Database not available' }, 500);
    const parsed = updateEvaluatorRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) }, 400);
    }
    const ev = await evStore.update(getTenantId(c), c.req.param('id'), parsed.data);
    if (!ev) return c.json({ error: 'Evaluator not found (or it is a read-only built-in)' }, 404);
    return c.json(ev);
  });

  app.delete('/evaluators/:id', async (c) => {
    const evStore = getEvaluatorStore();
    if (!evStore) return c.json({ error: 'Database not available' }, 500);
    const ok = await evStore.delete(getTenantId(c), c.req.param('id'));
    if (!ok) return c.json({ error: 'Evaluator not found (or it is a read-only built-in)' }, 404);
    return c.body(null, 204);
  });

  app.post('/evaluators/:id/publish', async (c) => {
    const evStore = getEvaluatorStore();
    if (!evStore) return c.json({ error: 'Database not available' }, 500);
    // Attribute the publish to the calling API key (the unified-auth 'auth' var
    // isn't set on this path — the middleware sets 'apiKey').
    const apiKey = c.get('apiKey') as { id?: string; name?: string } | undefined;
    const ev = await evStore.publish(getTenantId(c), c.req.param('id'), apiKey?.name ?? apiKey?.id);
    if (!ev) return c.json({ error: 'Evaluator not found (or it is a read-only built-in)' }, 404);
    return c.json(ev);
  });

  app.post('/evaluators/:id/verify', async (c) => {
    const evStore = getEvaluatorStore();
    if (!evStore) return c.json({ error: 'Database not available' }, 500);
    const ev = await evStore.verify(getTenantId(c), c.req.param('id'));
    if (!ev) return c.json({ error: 'Evaluator not found (or it is a read-only built-in)' }, 404);
    return c.json(ev);
  });

  return app;
}
